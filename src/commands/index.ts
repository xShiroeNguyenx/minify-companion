import * as path from 'path';
import * as vscode from 'vscode';
import type { SkipReason } from '../core/filter';
import { isMinFile, isSassPartial, SUPPORTED_GLOB } from '../core/lang';
import { runPool } from '../core/queue';
import { formatBytes, formatSaving } from '../core/stats';
import type { Trigger } from '../core/types';
import { MAX_PARALLEL, type Engine, type RunOutcome } from '../runtime/engine';

/** Asking before a batch this large: it may create a lot of files. */
const CONFIRM_ABOVE = 50;

function skipText(reason: SkipReason): string {
  switch (reason) {
    case 'unsupported':
      return vscode.l10n.t('This file type is not supported. Minify works on .css, .js, .mjs, .cjs, .html, .htm, .scss and .sass.');
    case 'minFile':
      return vscode.l10n.t('This is already a .min file.');
    case 'generatedOutput':
      return vscode.l10n.t('This file is where minifyCompanion.outputPattern writes its output, so it is not minified again.');
    case 'partial':
      return vscode.l10n.t('Sass partials (files starting with _) have no output of their own; they are compiled through the files that @use them.');
    case 'tooLarge':
      return vscode.l10n.t('The file is larger than minifyCompanion.maxFileSizeKB.');
    default:
      return vscode.l10n.t('Skipped ({0}).', reason);
  }
}

async function showOutputOn(message: Thenable<string | undefined>, log: vscode.LogOutputChannel): Promise<void> {
  if ((await message) === vscode.l10n.t('Show Output')) log.show(true);
}

/** Text of an open document (unsaved edits included), else undefined so the engine reads disk. */
function openText(uri: vscode.Uri): string | undefined {
  return vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString())?.getText();
}

export function registerCommands(context: vscode.ExtensionContext, engine: Engine, log: vscode.LogOutputChannel): void {
  const reg = (id: string, fn: Parameters<typeof vscode.commands.registerCommand>[1]) =>
    context.subscriptions.push(vscode.commands.registerCommand(id, fn));

  reg('minifyCompanion.showOutput', () => log.show(true));

  reg('minifyCompanion.minifyCurrent', async (arg?: vscode.Uri) => {
    const uri = arg instanceof vscode.Uri ? arg : vscode.window.activeTextEditor?.document.uri;
    if (!uri) {
      void vscode.window.showInformationMessage(vscode.l10n.t('Open a CSS, JS, HTML or Sass file first.'));
      return;
    }
    if (uri.scheme !== 'file') {
      void vscode.window.showWarningMessage(vscode.l10n.t('Only files on disk can be minified.'));
      return;
    }
    const outcome = await engine.run(uri, 'explicit', openText(uri));
    reportSingle(outcome, log);
  });

  reg('minifyCompanion.minifySelected', async (clicked?: vscode.Uri, selected?: vscode.Uri[]) => {
    const roots = selected?.length ? selected : clicked ? [clicked] : [];
    if (!roots.length) return;
    const jobs: Array<{ uri: vscode.Uri; trigger: Trigger }> = [];
    for (const root of roots) {
      let isDir = false;
      try {
        isDir = (await vscode.workspace.fs.stat(root)).type & vscode.FileType.Directory ? true : false;
      } catch {
        continue;
      }
      if (isDir) {
        // Inside a folder the user did not pick each file, so `exclude` applies.
        for (const uri of await findSources(new vscode.RelativePattern(root, SUPPORTED_GLOB))) jobs.push({ uri, trigger: 'scan' });
      } else {
        jobs.push({ uri: root, trigger: 'explicit' });
      }
    }
    await runBatch(engine, log, jobs);
  });

  reg('minifyCompanion.minifyWorkspace', async () => {
    const folders = vscode.workspace.workspaceFolders ?? [];
    if (!folders.length) {
      void vscode.window.showInformationMessage(vscode.l10n.t('Open a folder first.'));
      return;
    }
    const jobs: Array<{ uri: vscode.Uri; trigger: Trigger }> = [];
    for (const folder of folders) {
      for (const uri of await findSources(new vscode.RelativePattern(folder, SUPPORTED_GLOB))) jobs.push({ uri, trigger: 'scan' });
    }
    if (!jobs.length) {
      void vscode.window.showInformationMessage(vscode.l10n.t('No CSS, JS, HTML or Sass files found.'));
      return;
    }
    if (jobs.length > CONFIRM_ABOVE) {
      const go = vscode.l10n.t('Minify');
      const answer = await vscode.window.showWarningMessage(
        vscode.l10n.t('Minify {0} files? Missing .min files will be created next to them (files matching minifyCompanion.exclude are skipped).', jobs.length),
        { modal: true },
        go,
      );
      if (answer !== go) return;
    }
    await runBatch(engine, log, jobs);
  });

  reg('minifyCompanion.toggleAuto', async () => {
    const section = vscode.workspace.getConfiguration('minifyCompanion', vscode.window.activeTextEditor?.document.uri);
    const target = vscode.workspace.workspaceFolders?.length ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
    const current = section.get<string>('onSave', 'ifMinExists');
    if (current !== 'off') {
      await section.update('onSave', 'off', target);
      void vscode.window.showInformationMessage(vscode.l10n.t('Minify on save is off.'));
      return;
    }
    // Back to the user's own value where there is one; otherwise the default.
    const inspect = section.inspect<string>('onSave');
    const fallback = inspect?.globalValue && inspect.globalValue !== 'off' && target === vscode.ConfigurationTarget.Workspace ? undefined : 'ifMinExists';
    await section.update('onSave', fallback, target);
    const now = vscode.workspace.getConfiguration('minifyCompanion').get<string>('onSave', 'ifMinExists');
    void vscode.window.showInformationMessage(vscode.l10n.t('Minify on save is on ({0}).', now));
  });
}

/** Supported files, minus .min files and Sass partials which are never sources. */
async function findSources(pattern: vscode.RelativePattern): Promise<vscode.Uri[]> {
  const found = await vscode.workspace.findFiles(pattern, '**/node_modules/**');
  return found.filter((u) => !isMinFile(u.fsPath) && !isSassPartial(u.fsPath.replace(/\\/g, '/')));
}

function reportSingle(outcome: RunOutcome, log: vscode.LogOutputChannel): void {
  switch (outcome.kind) {
    case 'ok': {
      const msg = outcome.written
        ? vscode.l10n.t(
            '{0}: {1} → {2} ({3})',
            path.posix.basename(outcome.outPath),
            formatBytes(outcome.before),
            formatBytes(outcome.after),
            formatSaving(outcome.before, outcome.after),
          )
        : vscode.l10n.t('{0} is already up to date.', path.posix.basename(outcome.outPath));
      vscode.window.setStatusBarMessage(`$(check) ${msg}`, 4000);
      break;
    }
    case 'skipped':
      void vscode.window.showInformationMessage(skipText(outcome.reason));
      break;
    case 'failed':
      void showOutputOn(vscode.window.showErrorMessage(vscode.l10n.t('Minify failed: {0}', outcome.message), vscode.l10n.t('Show Output')), log);
      break;
    default:
      break;
  }
}

async function runBatch(engine: Engine, log: vscode.LogOutputChannel, jobs: Array<{ uri: vscode.Uri; trigger: Trigger }>): Promise<void> {
  if (!jobs.length) {
    void vscode.window.showInformationMessage(vscode.l10n.t('No CSS, JS, HTML or Sass files found.'));
    return;
  }
  const counts = { written: 0, unchanged: 0, skipped: 0, failed: 0 };

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: vscode.l10n.t('Minifying'), cancellable: true },
    async (progress, token) => {
      let done = 0;
      await runPool(
        jobs,
        MAX_PARALLEL,
        async ({ uri, trigger }) => {
          const outcome = await engine.run(uri, trigger, openText(uri));
          if (outcome.kind === 'ok') counts[outcome.written ? 'written' : 'unchanged']++;
          else if (outcome.kind === 'failed') counts.failed++;
          else counts.skipped++;
          done++;
          progress.report({ increment: 100 / jobs.length, message: `${done}/${jobs.length}` });
        },
        () => token.isCancellationRequested,
      );
    },
  );

  const summary = vscode.l10n.t(
    'Minify: {0} written, {1} unchanged, {2} skipped, {3} failed.',
    counts.written,
    counts.unchanged,
    counts.skipped,
    counts.failed,
  );
  log.info(summary);
  if (counts.failed) void showOutputOn(vscode.window.showWarningMessage(summary, vscode.l10n.t('Show Output')), log);
  else void vscode.window.showInformationMessage(summary);
}
