import * as path from 'path';
import * as vscode from 'vscode';
import { normalizeConfig } from '../core/config';
import { shouldMinify, matchesAny, type SkipReason } from '../core/filter';
import { errorMessage } from '../core/issues';
import { isMinFile, isSassPartial, langFromPath } from '../core/lang';
import { resolveOutputPath, toPosix } from '../core/paths';
import { KeyedQueue } from '../core/queue';
import { ScssGraph } from '../core/scssGraph';
import { byteLength, formatBytes, formatSaving, stripBom } from '../core/stats';
import type { Issue, MinifyConfig, Trigger } from '../core/types';
import { runMinifier } from '../minifiers';
import { Diagnostics } from './diagnostics';
import { StatusBar } from './statusBar';
import { exists, writeIfChanged } from './writer';

export type RunOutcome =
  | { kind: 'skipped'; reason: SkipReason }
  | { kind: 'ok'; outPath: string; before: number; after: number; written: boolean; ms: number }
  | { kind: 'failed'; message: string }
  /** A partial was saved; this many entries were queued for recompiling. */
  | { kind: 'dependents'; count: number }
  /** Another save of the same file came in and its run replaced this one. */
  | { kind: 'superseded' };

const decoder = new TextDecoder('utf-8');

export class Engine implements vscode.Disposable {
  private readonly graph = new ScssGraph();
  private readonly queue: KeyedQueue;
  private readonly configWarningsShown = new Set<string>();

  constructor(
    private readonly log: vscode.LogOutputChannel,
    private readonly status: StatusBar,
    private readonly diagnostics: Diagnostics,
  ) {
    this.queue = new KeyedQueue((key, error) => this.log.error(`${key}: ${errorMessage(error)}`));
  }

  readConfig(uri: vscode.Uri): MinifyConfig {
    const section = vscode.workspace.getConfiguration('minifyCompanion', uri);
    const { config, warnings } = normalizeConfig((key) => section.get(key));
    for (const w of warnings) {
      if (this.configWarningsShown.has(w)) continue;
      this.configWarningsShown.add(w);
      this.log.warn(w);
    }
    return config;
  }

  /** Queues a run; at most one per file at a time, the latest request wins. */
  async run(uri: vscode.Uri, trigger: Trigger, text?: string): Promise<RunOutcome> {
    let outcome: RunOutcome = { kind: 'superseded' };
    await this.queue.schedule(uri.toString(), async () => {
      outcome = await this.process(uri, trigger, text);
    });
    return outcome;
  }

  private async process(uri: vscode.Uri, trigger: Trigger, text?: string): Promise<RunOutcome> {
    const src = toPosix(uri.fsPath);
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    const wsPath = folder ? toPosix(folder.uri.fsPath) : undefined;
    const config = this.readConfig(uri);

    if (isSassPartial(src)) {
      return trigger === 'save' ? this.recompileDependents(src, folder, config) : { kind: 'skipped', reason: 'partial' };
    }
    if (!langFromPath(src)) return { kind: 'skipped', reason: 'unsupported' };
    if (isMinFile(src)) return { kind: 'skipped', reason: 'minFile' };

    const target = resolveOutputPath(src, config.outputPattern, wsPath);
    if (!target.ok) {
      const message = vscode.l10n.t('Invalid minifyCompanion.outputPattern: {0}', target.reason);
      this.log.error(`${src}: ${message}`);
      this.status.failure(src, message);
      return { kind: 'failed', message };
    }
    const outUri = vscode.Uri.file(target.path);

    let sizeBytes: number | undefined;
    if (text !== undefined) sizeBytes = byteLength(text);
    else {
      try {
        sizeBytes = (await vscode.workspace.fs.stat(uri)).size;
      } catch (error) {
        return this.fail(src, uri, [{ message: errorMessage(error) }]);
      }
    }

    const decision = shouldMinify({
      srcPath: src,
      relativePath: wsPath ? path.posix.relative(wsPath, src) : undefined,
      trigger,
      config,
      workspaceTrusted: vscode.workspace.isTrusted,
      outputExists: await exists(outUri),
      sizeBytes,
    });
    if (!decision.ok) {
      if (decision.reason === 'tooLarge') {
        this.log.warn(`${src}: skipped, ${formatBytes(sizeBytes ?? 0)} is over minifyCompanion.maxFileSizeKB (${config.maxFileSizeKB} KB).`);
      } else {
        this.log.debug(`${src}: skipped (${decision.reason}).`);
      }
      return { kind: 'skipped', reason: decision.reason };
    }

    let code = text;
    if (code === undefined) {
      try {
        code = decoder.decode(await vscode.workspace.fs.readFile(uri));
      } catch (error) {
        return this.fail(src, uri, [{ message: errorMessage(error) }]);
      }
    }
    code = stripBom(code);

    const started = Date.now();
    const result = await runMinifier(
      { code, srcPath: src, outPath: target.path, config },
      { loadPaths: this.sassLoadPaths(config, src, wsPath) },
    );
    if (!result.ok) return this.fail(src, uri, result.errors);

    let written = false;
    try {
      for (const out of result.outputs) {
        if ((await writeIfChanged(vscode.Uri.file(out.path), out.content)) === 'written') written = true;
      }
    } catch (error) {
      return this.fail(src, uri, [{ message: errorMessage(error) }], false);
    }
    const ms = Date.now() - started;

    if (result.dependencies) this.graph.setDependencies(src, result.dependencies);
    if (result.warnings.length) {
      this.diagnostics.report(src, uri, result.warnings, vscode.DiagnosticSeverity.Warning);
      for (const w of result.warnings) this.log.warn(`${src}${w.line ? `:${w.line}` : ''}: ${w.message}`);
    } else {
      this.diagnostics.clear(src);
    }

    const before = byteLength(code);
    const after = byteLength(result.outputs[0].content);
    this.status.success(target.path, before, after, ms, written);
    this.log.info(
      `${src} → ${path.posix.basename(target.path)}: ${formatBytes(before)} → ${formatBytes(after)} ` +
        `(${formatSaving(before, after)}) in ${ms} ms${written ? '' : ', unchanged'}`,
    );
    return { kind: 'ok', outPath: target.path, before, after, written, ms };
  }

  private fail(src: string, uri: vscode.Uri, errors: Issue[], toProblems = true): RunOutcome {
    const first = errors[0]?.message ?? 'Unknown error';
    if (toProblems) this.diagnostics.report(src, uri, errors, vscode.DiagnosticSeverity.Error);
    for (const e of errors) {
      const where = e.file ?? src;
      this.log.error(`${where}${e.line ? `:${e.line}:${e.column ?? 1}` : ''}: ${e.message}`);
    }
    this.log.error(`${src}: the existing output was left untouched.`);
    this.status.failure(src, first);
    return { kind: 'failed', message: first };
  }

  /** The file's own folder is implicit (compileString's url); these come after it. */
  private sassLoadPaths(config: MinifyConfig, src: string, wsPath?: string): string[] {
    const base = wsPath ?? path.posix.dirname(src);
    const paths = config.scssLoadPaths.map((p) => (path.posix.isAbsolute(p) || /^[a-zA-Z]:/.test(p) ? toPosix(p) : path.posix.join(base, p)));
    paths.push(path.posix.join(base, 'node_modules'));
    return paths;
  }

  /**
   * A partial has no output of its own; the entries that use it do. The dependency graph knows
   * them once each entry has been compiled in this session. Before that, every non-partial Sass
   * file in the folder is offered — the usual filter still applies, so with `ifMinExists` only
   * entries that already have a .min file get compiled, and each compile fills in the graph.
   */
  private async recompileDependents(src: string, folder: vscode.WorkspaceFolder | undefined, config: MinifyConfig): Promise<RunOutcome> {
    if (config.onSave === 'off' || !vscode.workspace.isTrusted) return { kind: 'skipped', reason: config.onSave === 'off' ? 'autoOff' : 'untrusted' };

    let entries = this.graph.dependentsOf(src);
    if (!entries.length && !this.graph.knows(src) && folder) {
      const found = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, '**/*.{scss,sass}'), '**/node_modules/**');
      const wsPath = toPosix(folder.uri.fsPath);
      entries = found
        .map((u) => toPosix(u.fsPath))
        .filter((p) => !isSassPartial(p) && !matchesAny(config.exclude, path.posix.relative(wsPath, p)));
    }
    if (!entries.length) {
      this.log.debug(`${src}: partial saved, no entry file uses it.`);
      return { kind: 'dependents', count: 0 };
    }
    this.log.info(`${src}: partial saved, recompiling ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}.`);
    // Not awaited inside this file's queue slot: each entry runs in its own slot.
    void Promise.all(entries.map((e) => this.run(vscode.Uri.file(e), 'save')));
    return { kind: 'dependents', count: entries.length };
  }

  dispose(): void {
    // Nothing held beyond the injected disposables.
  }
}
