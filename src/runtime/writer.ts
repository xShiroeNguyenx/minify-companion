import * as vscode from 'vscode';
import { samePath, toPosix } from '../core/paths';

export type WriteOutcome = 'written' | 'unchanged';

/** Thrown instead of writing over a target the user is editing by hand. */
export class DirtyTargetError extends Error {}

const RENAME_ATTEMPTS = 3;
const RENAME_DELAY_MS = 100;

function isNotFound(error: unknown): boolean {
  return error instanceof vscode.FileSystemError && error.code === 'FileNotFound';
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Writes `content` to `target` unless it already holds exactly that, so an unchanged result does
 * not touch the file (no git noise, no watcher churn). Writes a temp file and renames it over the
 * target, so a crash or a full disk never leaves a half-written .min file behind.
 */
export async function writeIfChanged(target: vscode.Uri, content: string): Promise<WriteOutcome> {
  const open = vscode.workspace.textDocuments.find((d) => d.isDirty && samePath(toPosix(d.uri.fsPath), toPosix(target.fsPath)));
  if (open) {
    throw new DirtyTargetError(
      vscode.l10n.t('{0} has unsaved changes in an editor; it was not overwritten. Save or revert it, then try again.', target.fsPath),
    );
  }

  const bytes = Buffer.from(content, 'utf8');
  try {
    const existing = await vscode.workspace.fs.readFile(target);
    if (Buffer.compare(Buffer.from(existing), bytes) === 0) return 'unchanged';
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }

  await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(target, '..'));
  const temp = target.with({ path: `${target.path}.tmp-${Math.random().toString(36).slice(2, 10)}` });
  await vscode.workspace.fs.writeFile(temp, bytes);

  let lastError: unknown;
  for (let attempt = 1; attempt <= RENAME_ATTEMPTS; attempt++) {
    try {
      await vscode.workspace.fs.rename(temp, target, { overwrite: true });
      lastError = undefined;
      break;
    } catch (error) {
      // Windows refuses to replace a file another process holds open (antivirus, a preview).
      lastError = error;
      if (attempt < RENAME_ATTEMPTS) await sleep(RENAME_DELAY_MS);
    }
  }
  if (lastError) {
    await vscode.workspace.fs.delete(temp).then(undefined, () => undefined);
    const code = lastError instanceof vscode.FileSystemError ? lastError.code : '';
    if (code === 'NoPermissions') {
      throw new Error(vscode.l10n.t('Cannot write {0}: the file is read-only or you lack permission.', target.fsPath));
    }
    throw new Error(
      vscode.l10n.t('Cannot replace {0}: another program may be holding it open. ({1})', target.fsPath, String(lastError)),
    );
  }

  // Some file system providers report success without having written; check rather than trust.
  const stat = await vscode.workspace.fs.stat(target);
  if (stat.size !== bytes.length) {
    throw new Error(vscode.l10n.t('Wrote {0} but it is {1} bytes instead of {2}.', target.fsPath, stat.size, bytes.length));
  }
  return 'written';
}

export async function exists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}
