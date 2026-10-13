import * as path from 'path';
import * as vscode from 'vscode';
import { formatBytes, formatSaving } from '../core/stats';

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

  success(outPath: string, before: number, after: number, ms: number, written: boolean): void {
    this.item.text = `$(zap) ${path.posix.basename(outPath)} ${formatSaving(before, after)}`;
    this.item.tooltip = written
      ? vscode.l10n.t('{0} → {1} in {2} ms. Click to show the log.', formatBytes(before), formatBytes(after), ms)
      : vscode.l10n.t('{0} → {1}, already up to date. Click to show the log.', formatBytes(before), formatBytes(after));
    this.item.backgroundColor = undefined;
    this.show();
  }

  failure(file: string, message: string): void {
    this.item.text = `$(error) ${vscode.l10n.t('Minify failed')}`;
    this.item.tooltip = `${path.posix.basename(file)}: ${message}`;
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
