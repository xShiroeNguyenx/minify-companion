import * as path from 'path';
import * as vscode from 'vscode';
import { formatBytes, formatSaving } from '../core/stats';

const LINK_COMMANDS = ['minifyCompanion.showOutput', 'minifyCompanion.openSettings'];

/** Plain-text lines, then links to the log and the settings screen. */
function tooltip(lines: string[]): vscode.MarkdownString {
  const md = new vscode.MarkdownString(undefined, true);
  // Only these two commands can run from the links; file names and messages stay plain text.
  md.isTrusted = { enabledCommands: LINK_COMMANDS };
  for (const line of lines) {
    md.appendText(line);
    md.appendMarkdown('\n\n');
  }
  md.appendMarkdown(
    `[$(output) ${vscode.l10n.t('Show log')}](command:minifyCompanion.showOutput) · [$(gear) ${vscode.l10n.t('Settings')}](command:minifyCompanion.openSettings)`,
  );
  return md;
}

/** Last run's result, bottom right. Hidden until something has run; click opens the log. */
export class StatusBar implements vscode.Disposable {
  private readonly item = vscode.window.createStatusBarItem('minifyCompanion.status', vscode.StatusBarAlignment.Right, 100);
  private enabled = true;
  private hasContent = false;

  constructor() {
    this.item.name = 'Minify Companion';
    this.item.command = 'minifyCompanion.showOutput';
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.update();
  }

  success(outPath: string, before: number, after: number, ms: number, written: boolean, gzip?: number): void {
    this.item.text = `$(zap) ${path.posix.basename(outPath)} ${formatSaving(before, after)}`;
    const sizes = written
      ? vscode.l10n.t('{0} → {1} in {2} ms.', formatBytes(before), formatBytes(after), ms)
      : vscode.l10n.t('{0} → {1}, already up to date.', formatBytes(before), formatBytes(after));
    const lines = [sizes];
    if (gzip !== undefined) lines.push(vscode.l10n.t('{0} gzipped, as a web server would usually send it.', formatBytes(gzip)));
    this.item.tooltip = tooltip(lines);
    this.item.backgroundColor = undefined;
    this.show();
  }

  failure(file: string, message: string): void {
    this.item.text = `$(error) ${vscode.l10n.t('Minify failed')}`;
    this.item.tooltip = tooltip([`${path.posix.basename(file)}: ${message}`]);
    this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
    this.show();
  }

  private show(): void {
    this.hasContent = true;
    this.update();
  }

  private update(): void {
    if (this.enabled && this.hasContent) this.item.show();
    else this.item.hide();
  }

  dispose(): void {
    this.item.dispose();
  }
}
