import * as vscode from 'vscode';
import type { Issue } from '../core/types';

/**
 * Problems panel entries, owned by the source that produced them. A Sass error can land in a
 * partial that several entries share, so each file's list is the merge of every owner's issues,
 * and a successful run of one entry clears only what that entry reported.
 */
export class Diagnostics implements vscode.Disposable {
  private readonly collection = vscode.languages.createDiagnosticCollection('minify-companion');
  /** owner (source path) → file uri string → diagnostics */
  private readonly owned = new Map<string, Map<string, vscode.Diagnostic[]>>();

  report(owner: string, sourceUri: vscode.Uri, issues: Issue[], severity: vscode.DiagnosticSeverity): void {
    const files = new Map<string, vscode.Diagnostic[]>();
    for (const issue of issues) {
      const uri = issue.file ? vscode.Uri.file(issue.file) : sourceUri;
      const line = Math.max(0, (issue.line ?? 1) - 1);
      const col = Math.max(0, (issue.column ?? 1) - 1);
      const d = new vscode.Diagnostic(new vscode.Range(line, col, line, col), issue.message, severity);
      d.source = 'Minify Companion';
      const key = uri.toString();
      files.set(key, [...(files.get(key) ?? []), d]);
    }
    const before = this.owned.get(owner);
    this.owned.set(owner, files);
    this.refresh(new Set([...(before?.keys() ?? []), ...files.keys()]));
  }

  clear(owner: string): void {
    const before = this.owned.get(owner);
    if (!before) return;
    this.owned.delete(owner);
    this.refresh(new Set(before.keys()));
  }

  private refresh(keys: Set<string>): void {
    for (const key of keys) {
      const all: vscode.Diagnostic[] = [];
      for (const files of this.owned.values()) all.push(...(files.get(key) ?? []));
      this.collection.set(vscode.Uri.parse(key), all.length ? all : undefined);
    }
  }

  dispose(): void {
    this.collection.dispose();
  }
}
