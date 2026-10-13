import * as path from 'path';
import picomatch from 'picomatch';
import { isMinFile, isSassPartial, langFromPath } from './lang';
import type { MinifyConfig, Trigger } from './types';

export type SkipReason =
  | 'unsupported'
  | 'minFile'
  | 'partial'
  | 'languageDisabled'
  | 'excluded'
  | 'autoOff'
  | 'untrusted'
  | 'noMinYet'
  | 'tooLarge';

export type FilterResult = { ok: true } | { ok: false; reason: SkipReason };

export interface FilterInput {
  /** Absolute POSIX-style path. */
  srcPath: string;
  /** Path relative to its workspace folder, or undefined for a loose file. */
  relativePath?: string;
  trigger: Trigger;
  config: MinifyConfig;
  workspaceTrusted: boolean;
  /** Whether the output already exists. Only consulted for `ifMinExists` saves. */
  outputExists: boolean;
  sizeBytes?: number;
}

export function matchesAny(globs: string[], relativePath: string): boolean {
  if (!globs.length) return false;
  const nocase = process.platform === 'win32';
  return picomatch(globs, { dot: true, nocase })(relativePath);
}

/**
 * Decides whether one file gets minified. Order matters: the checks that hold whatever the
 * trigger come first, so asking explicitly can never minify a `.min` file or a partial.
 *
 * - `explicit` ignores `exclude`, `languages`, `onSave` and trust: the user pointed at this file.
 * - `scan` honours `exclude` and `languages` but creates missing outputs (that is what it is for).
 * - `save` honours everything.
 */
export function shouldMinify(input: FilterInput): FilterResult {
  const { srcPath, trigger, config } = input;
  const lang = langFromPath(srcPath);
  if (!lang) return { ok: false, reason: 'unsupported' };
  if (isMinFile(srcPath)) return { ok: false, reason: 'minFile' };
  if (isSassPartial(srcPath)) return { ok: false, reason: 'partial' };

  if (trigger !== 'explicit') {
    if (!config.languages.includes(lang)) return { ok: false, reason: 'languageDisabled' };
    const rel = input.relativePath ?? path.posix.basename(srcPath);
    if (matchesAny(config.exclude, rel)) return { ok: false, reason: 'excluded' };
  }

  if (trigger === 'save') {
    if (config.onSave === 'off') return { ok: false, reason: 'autoOff' };
    if (!input.workspaceTrusted) return { ok: false, reason: 'untrusted' };
    if (config.onSave === 'ifMinExists' && !input.outputExists) return { ok: false, reason: 'noMinYet' };
  }

  if (input.sizeBytes !== undefined && input.sizeBytes > config.maxFileSizeKB * 1024) {
    return { ok: false, reason: 'tooLarge' };
  }
  return { ok: true };
}
