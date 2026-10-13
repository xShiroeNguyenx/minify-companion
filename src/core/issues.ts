import type { Issue } from './types';

/**
 * clean-css never throws on broken CSS: it drops what it cannot parse and reports it as a
 * warning such as "Unexpected '}' at 3:12." or "Invalid character(s) 'x' at 1:4. Ignoring.".
 * Writing that output would silently delete rules from the .min file, so those warnings are
 * promoted to errors. Others ("Broken URL", "Ignoring remote @import") stay warnings.
 */
const FATAL_CLEANCSS = /^(Unexpected|Invalid|Missing|Unclosed|Unterminated)\b/i;

export function parseCleanCssMessage(message: string): Issue & { fatal: boolean } {
  // "at 3:12." or, when the input was keyed by path, "at ../../w/a.css:3:12." — the path is
  // relative to the process cwd, which means nothing to the user, so it is dropped.
  const atRe = /\bat (?:\S*?:)?(\d+):(\d+)(?=[.\s]|$)/;
  const at = atRe.exec(message);
  return {
    message: (at ? message.replace(atRe, `at ${at[1]}:${at[2]}`) : message).trim(),
    line: at ? Number(at[1]) : undefined,
    // clean-css columns are 0-based.
    column: at ? Number(at[2]) + 1 : undefined,
    fatal: FATAL_CLEANCSS.test(message.trim()),
  };
}

/** 1-based line and column of a character offset. */
export function positionOf(source: string, offset: number): { line: number; column: number } {
  const before = source.slice(0, Math.max(0, Math.min(offset, source.length)));
  const lines = before.split('\n');
  return { line: lines.length, column: lines[lines.length - 1].length + 1 };
}

/**
 * html-minifier-terser throws `Parse Error: <the rest of the input from the bad tag>` with no
 * position. The quoted text is a suffix of the input, so finding where it starts gives the line.
 */
export function locateHtmlError(message: string, source: string): Issue {
  const m = /^Parse Error:\s*([\s\S]*)$/.exec(message);
  if (!m) return { message };
  const fragment = m[1];
  // Long fragments are truncated by some versions; the first line is enough to find it.
  const needle = fragment.split('\n')[0].slice(0, 200);
  const offset = needle ? source.indexOf(needle) : -1;
  const shown = needle.length > 80 ? needle.slice(0, 80) + '…' : needle;
  const text = `HTML parse error near: ${shown}`;
  return offset >= 0 ? { message: text, ...positionOf(source, offset) } : { message: text };
}

/** Appends the comment that points a browser at the map. */
export function withSourceMapComment(code: string, mapFileName: string, kind: 'js' | 'css'): string {
  const sep = code.endsWith('\n') ? '' : '\n';
  return kind === 'js'
    ? `${code}${sep}//# sourceMappingURL=${mapFileName}`
    : `${code}${sep}/*# sourceMappingURL=${mapFileName} */`;
}

/** Drops an existing sourceMappingURL comment, so we never end up with two. */
export function stripSourceMapComment(code: string): string {
  return code.replace(/\n?(\/\/# sourceMappingURL=[^\n]*|\/\*# sourceMappingURL=[^*]*\*\/)\s*$/, '');
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
