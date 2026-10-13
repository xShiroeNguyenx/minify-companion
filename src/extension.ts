import * as path from 'path';
import * as vscode from 'vscode';
import { registerCommands } from './commands';
import { langFromPath } from './core/lang';
import { Diagnostics } from './runtime/diagnostics';
import { Engine } from './runtime/engine';
import { StatusBar } from './runtime/statusBar';

export function activate(context: vscode.ExtensionContext): void {
  const log = vscode.window.createOutputChannel('Minify Companion', { log: true });
  const status = new StatusBar();
  const diagnostics = new Diagnostics();
  const engine = new Engine(log, status, diagnostics, path.join(context.extensionPath, 'dist', 'worker.js'));
  context.subscriptions.push(log, status, diagnostics, engine);

  const applyStatusSetting = () => status.setEnabled(vscode.workspace.getConfiguration('minifyCompanion').get<boolean>('statusBar', true));
  applyStatusSetting();

  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (doc.uri.scheme !== 'file' || !langFromPath(doc.uri.fsPath)) return;
      void engine.run(doc.uri, 'save', doc.getText());
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('minifyCompanion.statusBar')) applyStatusSetting();
    }),
  );

  registerCommands(context, engine, log);

  if (!vscode.workspace.isTrusted) {
    log.info('Workspace is not trusted: minify on save is off until it is. The Minify commands still work.');
  }
}

export function deactivate(): void {
  // Everything is disposed through context.subscriptions.
}
