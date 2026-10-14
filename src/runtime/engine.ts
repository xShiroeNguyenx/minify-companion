import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { normalizeConfig } from '../core/config';
import { shouldMinify, matchesAny, type SkipReason } from '../core/filter';
import { errorMessage } from '../core/issues';
import { isMinFile, isSassPartial, langFromPath } from '../core/lang';
import { looksLikeOutput, resolveOutputPath, toPosix } from '../core/paths';
import { KeyedQueue } from '../core/queue';
import { ScssGraph } from '../core/scssGraph';
import { byteLength, formatBytes, formatSaving, stripBom } from '../core/stats';
import type { Issue, MinifyConfig, MinifyResult, Trigger } from '../core/types';
import { WorkerPool } from '../core/workerPool';
import type { WorkerRequest } from '../worker';
import { Diagnostics } from './diagnostics';
import { StatusBar } from './statusBar';
import { exists, writeIfChanged } from './writer';

export type RunOutcome =
  | { kind: 'skipped'; reason: SkipReason }
  | { kind: 'ok'; outPath: string; before: number; after: number; written: boolean; ms: number; gzip?: number }
  /** `settings`: caused by a setting, so the fix is in the settings screen. */
  | { kind: 'failed'; message: string; settings?: boolean }
  /** A partial was saved; this many entries were queued for recompiling. */
  | { kind: 'dependents'; count: number }
  /** Another save of the same file came in and its run replaced this one. */
  | { kind: 'superseded' };

const decoder = new TextDecoder('utf-8');

/** Minify jobs in parallel, at most; also the folder commands' concurrency. */
export const MAX_PARALLEL = Math.max(1, Math.min(4, (os.availableParallelism?.() ?? os.cpus().length) - 1));

export class Engine implements vscode.Disposable {
  private readonly graph = new ScssGraph();
  private readonly queue: KeyedQueue;
  private readonly configWarningsShown = new Set<string>();
  private readonly pool: WorkerPool<WorkerRequest, MinifyResult>;
  /** A failed save pops up once per session; after that the status bar and Problems carry it. */
  private savePopupShown = false;
  /** Invalid settings pop up once per session too; the log lists each one. */
  private configPopupShown = false;

  constructor(
    private readonly log: vscode.LogOutputChannel,
    private readonly status: StatusBar,
    private readonly diagnostics: Diagnostics,
    workerScript: string,
  ) {
    this.queue = new KeyedQueue((key, error) => this.log.error(`${key}: ${errorMessage(error)}`));
    this.pool = new WorkerPool(workerScript, { size: MAX_PARALLEL, timeoutMs: 60_000, idleMs: 120_000 });
  }

  readConfig(uri: vscode.Uri): MinifyConfig {
    const section = vscode.workspace.getConfiguration('minifyCompanion', uri);
    const { config, warnings } = normalizeConfig((key) => section.get(key));
    const fresh = warnings.filter((w) => !this.configWarningsShown.has(w));
    for (const w of fresh) {
      this.configWarningsShown.add(w);
      this.log.warn(w);
    }
    if (fresh.length && !this.configPopupShown) {
      // Otherwise a hand-edited "sourceMap": "yes" just quietly does nothing.
      this.configPopupShown = true;
      const keys = fresh.map((w) => /^minifyCompanion.[w.]+/.exec(w)?.[0] ?? w);
      const open = vscode.l10n.t('Open Settings');
      void vscode.window
        .showWarningMessage(vscode.l10n.t('These settings have invalid values, so their defaults are used: {0}.', keys.join(', ')), open)
        .then((answer) => {
          if (answer === open) void vscode.commands.executeCommand('minifyCompanion.openSettings');
        });
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
    // Before resolving: for one of our own outputs the target may be the file itself, which
    // would otherwise surface as an outputPattern error instead of a quiet skip.
    if (looksLikeOutput(src, config.outputPattern, wsPath)) return { kind: 'skipped', reason: 'generatedOutput' };

    const target = resolveOutputPath(src, config.outputPattern, wsPath);
    if (!target.ok) {
      const message = vscode.l10n.t('Invalid minifyCompanion.outputPattern: {0}', target.reason);
      this.log.error(`${src}: ${message}`);
      this.status.failure(src, message);
      this.popupOnFirstSaveFailure(trigger, src, message, true);
      return { kind: 'failed', message, settings: true };
    }
    const outUri = vscode.Uri.file(target.path);

    let sizeBytes: number | undefined;
    if (text !== undefined) sizeBytes = byteLength(text);
    else {
      try {
        sizeBytes = (await vscode.workspace.fs.stat(uri)).size;
      } catch (error) {
        return this.fail(src, uri, trigger, [{ message: errorMessage(error) }]);
      }
    }

    const decision = shouldMinify({
      srcPath: src,
      relativePath: wsPath ? path.posix.relative(wsPath, src) : undefined,
      workspaceFolder: wsPath,
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
        return this.fail(src, uri, trigger, [{ message: errorMessage(error) }]);
      }
    }
    code = stripBom(code);

    const started = Date.now();
    let result: MinifyResult;
    try {
      result = await this.pool.run({
        input: { code, srcPath: src, outPath: target.path, config },
        scss: { loadPaths: this.sassLoadPaths(config, src, wsPath) },
      });
    } catch (error) {
      // The worker crashed or timed out; the job itself never got to report.
      return this.fail(src, uri, trigger, [{ message: errorMessage(error) }], false);
    }
    if (!result.ok) return this.fail(src, uri, trigger, result.errors);

    let written = false;
    try {
      for (const out of result.outputs) {
        if ((await writeIfChanged(vscode.Uri.file(out.path), out.content)) === 'written') written = true;
      }
    } catch (error) {
      return this.fail(src, uri, trigger, [{ message: errorMessage(error) }], false);
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
    const gzip = result.gzipSize;
    this.status.success(target.path, before, after, ms, written, gzip);
    this.log.info(
      `${src} → ${path.posix.basename(target.path)}: ${formatBytes(before)} → ${formatBytes(after)} ` +
        `(${formatSaving(before, after)}${gzip === undefined ? '' : `, gzip ${formatBytes(gzip)}`}) in ${ms} ms${written ? '' : ', unchanged'}`,
    );
    return { kind: 'ok', outPath: target.path, before, after, written, ms, gzip };
  }

  private fail(src: string, uri: vscode.Uri, trigger: Trigger, errors: Issue[], toProblems = true): RunOutcome {
    const first = errors[0]?.message ?? 'Unknown error';
    if (toProblems) this.diagnostics.report(src, uri, errors, vscode.DiagnosticSeverity.Error);
    for (const e of errors) {
      const where = e.file ?? src;
      this.log.error(`${where}${e.line ? `:${e.line}:${e.column ?? 1}` : ''}: ${e.message}`);
    }
    this.log.error(`${src}: the existing output was left untouched.`);
    this.status.failure(src, first);
    this.popupOnFirstSaveFailure(trigger, src, first);
    return { kind: 'failed', message: first };
  }

  /**
   * A failed save is easy to miss in the status bar, so the first one in a session pops up. Later
   * ones do not: a file saved every few seconds while being fixed would otherwise nag. Commands
   * report their own failures.
   */
  private popupOnFirstSaveFailure(trigger: Trigger, src: string, message: string, fromSettings = false): void {
    if (trigger !== 'save' || this.savePopupShown) return;
    this.savePopupShown = true;
    const show = vscode.l10n.t('Show Output');
    const open = vscode.l10n.t('Open Settings');
    const buttons = fromSettings ? [open, show] : [show];
    void vscode.window
      .showErrorMessage(vscode.l10n.t('Minify failed for {0}: {1} The previous output was kept.', path.posix.basename(src), message), ...buttons)
      .then((answer) => {
        if (answer === show) this.log.show(true);
        else if (answer === open) void vscode.commands.executeCommand('minifyCompanion.openSettings');
      });
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
    this.pool.dispose();
  }
}
