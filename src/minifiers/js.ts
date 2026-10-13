import * as path from 'path';
import { minify, type MinifyOptions } from 'terser';
import { relativeFromMap } from '../core/paths';
import { errorMessage, stripSourceMapComment } from '../core/issues';
import type { MinifyInput, MinifyResult } from '../core/types';

/**
 * Whether to parse as an ES module. `.mjs`/`.cjs` say so themselves; a `.js` is a module when it
 * has a top-level import/export statement. Getting this wrong either fails to parse (`import` in
 * a script) or mangles top-level names another <script> relies on (a script parsed as a module).
 */
export function detectModule(srcPath: string, code: string): boolean {
  const ext = path.posix.extname(srcPath).toLowerCase();
  if (ext === '.mjs') return true;
  if (ext === '.cjs') return false;
  return /^[ \t]*(import\s*[\w{*'"]|export\s+(\{|\*|default\b|const\b|let\b|var\b|function\b|async\b|class\b))/m.test(code);
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/** User options win; nested objects (compress, mangle, format) merge one level deep. */
export function buildTerserOptions(input: MinifyInput, mapPath?: string): MinifyOptions {
  const { config, srcPath, code, outPath } = input;
  const user = config.terser;
  const defaults: Obj = {
    module: detectModule(srcPath, code),
    compress: {},
    mangle: {},
    format: { comments: config.preserveLicenseComments ? 'some' : false },
  };
  const merged: Obj = { ...defaults };
  for (const [k, v] of Object.entries(user)) {
    merged[k] = isObj(v) && isObj(defaults[k]) ? { ...(defaults[k] as Obj), ...v } : v;
  }
  // The map is ours to manage: where it is written and what it points at.
  if (mapPath) {
    merged.sourceMap = {
      filename: path.posix.basename(outPath),
      url: path.posix.basename(mapPath),
    };
  } else {
    delete merged.sourceMap;
  }
  return merged as MinifyOptions;
}

export async function minifyJs(input: MinifyInput): Promise<MinifyResult> {
  const mapPath = input.config.sourceMap ? `${input.outPath}.map` : undefined;
  const options = buildTerserOptions(input, mapPath);
  // Keyed by the path the map should record, relative to where the map sits.
  const sourceName = mapPath ? relativeFromMap(mapPath, input.srcPath) : path.posix.basename(input.srcPath);
  try {
    const result = await minify({ [sourceName]: stripSourceMapComment(input.code) }, options);
    const code = result.code ?? '';
    const outputs = [{ path: input.outPath, content: code }];
    if (mapPath && typeof result.map === 'string') {
      outputs.push({ path: mapPath, content: result.map });
    }
    return { ok: true, outputs, warnings: [] };
  } catch (error) {
    // Terser's parse errors carry a 1-based line and 0-based col.
    const e = error as { line?: number; col?: number };
    return {
      ok: false,
      errors: [
        {
          message: errorMessage(error),
          line: typeof e.line === 'number' ? e.line : undefined,
          column: typeof e.col === 'number' ? e.col + 1 : undefined,
        },
      ],
    };
  }
}
