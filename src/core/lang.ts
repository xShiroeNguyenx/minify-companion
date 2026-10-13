import * as path from 'path';
import type { Lang } from './types';

const LANG_BY_EXT: Record<string, Lang> = {
  '.css': 'css',
  '.js': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.html': 'html',
  '.htm': 'html',
  '.scss': 'scss',
  '.sass': 'scss',
};

export const SUPPORTED_EXTENSIONS = Object.keys(LANG_BY_EXT);

/** Glob body for every supported extension, e.g. for findFiles: `**\/*.{css,js,...}`. */
export const SUPPORTED_GLOB = `**/*.{${SUPPORTED_EXTENSIONS.map((e) => e.slice(1)).join(',')}}`;

export function langFromPath(file: string): Lang | undefined {
  return LANG_BY_EXT[path.posix.extname(file).toLowerCase()];
}

/** `app.min.js`, `app.min.css`: never a source, whatever the settings say. */
export function isMinFile(file: string): boolean {
  return /\.min\.[^./\\]+$/i.test(file);
}

/** Sass partials (`_vars.scss`) are only ever imported; they never get their own output. */
export function isSassPartial(file: string): boolean {
  return langFromPath(file) === 'scss' && path.posix.basename(file).startsWith('_');
}

/** Extension of the output, without the dot. Sass compiles to CSS; everything else keeps its own. */
export function outputExtension(file: string): string {
  const ext = path.posix.extname(file).slice(1);
  return langFromPath(file) === 'scss' ? 'css' : ext;
}
