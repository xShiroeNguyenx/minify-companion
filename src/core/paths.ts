import * as path from 'path';
import { outputExtension } from './lang';

/**
 * Paths in core/ are absolute and POSIX-style (`D:/site/app.js` on Windows, `/srv/site/app.js`
 * elsewhere) so one implementation and one set of tests covers both. The runtime converts at
 * the boundary with toPosix() / Uri.file().
 */
export function toPosix(p: string): string {
  return p.replace(/\\/g, '/');
}

/** Windows paths compare case-insensitively; a drive letter is how we tell. */
function isWindowsPath(p: string): boolean {
  return /^[a-zA-Z]:\//.test(p);
}

export function samePath(a: string, b: string): boolean {
  const na = path.posix.normalize(a);
  const nb = path.posix.normalize(b);
  return isWindowsPath(na) ? na.toLowerCase() === nb.toLowerCase() : na === nb;
}

/** True when `child` is `parent` itself or somewhere below it. */
export function isInside(child: string, parent: string): boolean {
  let c = path.posix.normalize(child);
  let p = path.posix.normalize(parent).replace(/\/+$/, '');
  if (isWindowsPath(c)) {
    c = c.toLowerCase();
    p = p.toLowerCase();
  }
  return c === p || c.startsWith(p + '/');
}

export type ResolveResult = { ok: true; path: string } | { ok: false; reason: string };

/**
 * Expands `minifyCompanion.outputPattern` for one source file.
 *
 * Variables: ${dir} ${name} ${ext} ${workspaceFolder} ${relativeDir}. `name` keeps every dot but
 * the last (`a.module.css` → `a.module`), `ext` is the output's extension (`css` for Sass).
 *
 * Refuses a target equal to the source (it would overwrite the user's code) and one outside the
 * workspace folder, or outside the source's folder when the file is not in a workspace — a
 * pattern from a cloned repo's settings must not be able to write `../../somewhere`.
 */
export function resolveOutputPath(srcPath: string, pattern: string, workspaceFolder?: string): ResolveResult {
  const src = path.posix.normalize(srcPath);
  const dir = path.posix.dirname(src);
  const base = path.posix.basename(src);
  const name = base.slice(0, base.length - path.posix.extname(base).length);
  const ext = outputExtension(src);

  if (!pattern.trim()) return { ok: false, reason: 'outputPattern is empty.' };

  const usesWorkspace = /\$\{(workspaceFolder|relativeDir)\}/.test(pattern);
  if (usesWorkspace && !workspaceFolder) {
    return { ok: false, reason: 'outputPattern uses ${workspaceFolder} or ${relativeDir}, but this file is not in a workspace folder.' };
  }
  const ws = workspaceFolder ? path.posix.normalize(workspaceFolder).replace(/\/+$/, '') : undefined;
  const relativeDir = ws ? path.posix.relative(ws, dir) || '.' : '.';

  const vars: Record<string, string> = {
    dir,
    name,
    ext,
    workspaceFolder: ws ?? '',
    relativeDir,
  };
  const unknown: string[] = [];
  const expanded = pattern.replace(/\$\{([^}]*)\}/g, (_, key: string) => {
    if (key in vars) return vars[key];
    unknown.push(key);
    return '';
  });
  if (unknown.length) {
    return { ok: false, reason: `outputPattern has unknown variable(s): ${unknown.map((k) => '${' + k + '}').join(', ')}.` };
  }

  // A pattern without a leading variable is relative to the source's folder.
  const isAbsolute = path.posix.isAbsolute(expanded) || isWindowsPath(expanded);
  const out = path.posix.normalize(isAbsolute ? expanded : path.posix.join(dir, expanded));

  if (samePath(out, src)) {
    return { ok: false, reason: 'outputPattern resolves to the source file itself; it would be overwritten.' };
  }
  if (out.endsWith('/')) {
    return { ok: false, reason: 'outputPattern resolves to a folder, not a file.' };
  }
  const root = ws ?? dir;
  if (!isInside(out, root)) {
    return {
      ok: false,
      reason: ws
        ? `outputPattern resolves outside the workspace folder (${out}).`
        : `outputPattern resolves outside the file's folder (${out}); only \${dir}-relative targets are allowed for files outside a workspace.`,
    };
  }
  return { ok: true, path: out };
}

/** Sibling of the minified file holding the expanded CSS, for `scss.emitCss`. */
export function expandedCssPath(outPath: string, srcPath: string): string {
  const base = path.posix.basename(srcPath);
  const name = base.slice(0, base.length - path.posix.extname(base).length);
  return path.posix.join(path.posix.dirname(outPath), `${name}.css`);
}

/** Path to write into a .map's `sources`: relative to the map, with forward slashes. */
export function relativeFromMap(mapPath: string, target: string): string {
  return path.posix.relative(path.posix.dirname(mapPath), target) || path.posix.basename(target);
}
