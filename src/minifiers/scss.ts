import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import * as sass from 'sass';
import { expandedCssPath, isInside, relativeFromMap, samePath, toPosix } from '../core/paths';
import { errorMessage, withSourceMapComment } from '../core/issues';
import type { Issue, MinifyInput, MinifyResult, OutputFile } from '../core/types';

export interface ScssOptions {
  /** Absolute folders searched by `@use` / `@import`, after the file's own folder. */
  loadPaths: string[];
}

function fileUrlToPosix(url: URL | string): string | undefined {
  const u = typeof url === 'string' ? new URL(url) : url;
  if (u.protocol !== 'file:') return undefined;
  return toPosix(fileURLToPath(u));
}

function realPosix(p: string): string | undefined {
  try {
    return toPosix(fs.realpathSync.native(p));
  } catch {
    return undefined;
  }
}

/**
 * Sass corrects the spelling of every path it loads to the name on disk, so on Windows an 8.3
 * short folder (`C:/Users/RUNNER~1/...`) comes back long (`C:/Users/runneradmin/...`). Everything
 * else here — the output path, the editor's URIs, the dependency graph — uses the spelling the
 * user opened, so map each reported path back onto the deepest ancestor of the source that
 * resolves to the same place. Paths that already match, or share no ancestor, pass through.
 */
export function toSourceSpelling(reported: string, srcPath: string): string {
  let dir = path.posix.dirname(srcPath);
  if (isInside(reported, dir)) return reported;
  for (;;) {
    const real = realPosix(dir);
    if (real && isInside(reported, real)) {
      return dir.replace(/\/+$/, '') + reported.slice(real.replace(/\/+$/, '').length);
    }
    const parent = path.posix.dirname(dir);
    if (parent === dir) return reported;
    dir = parent;
  }
}

/** Sass reports 0-based spans; the span's url names the file, which may be a partial. */
function issueFromSpan(message: string, span: sass.SourceSpan | undefined, srcPath: string): Issue {
  if (!span) return { message };
  const reported = span.url ? fileUrlToPosix(span.url) : undefined;
  const file = reported ? toSourceSpelling(reported, srcPath) : undefined;
  return {
    message,
    file: file && !samePath(file, srcPath) ? file : undefined,
    line: span.start.line + 1,
    column: span.start.column + 1,
  };
}

/**
 * Compiles from the editor's text (not the file on disk) with the file's URL, so relative
 * `@use` resolves from its folder. `compressed` output is already minified and keeps
 * `/*! … *\/` comments, so clean-css is not run on top — that would mean merging two maps for
 * almost no gain.
 */
export async function minifyScss(input: MinifyInput, options: ScssOptions): Promise<MinifyResult> {
  const { srcPath, outPath, code, config } = input;
  const mapPath = config.sourceMap ? `${outPath}.map` : undefined;
  const warnings: Issue[] = [];
  const common: sass.StringOptions<'sync'> = {
    url: pathToFileURL(srcPath),
    syntax: path.posix.extname(srcPath).toLowerCase() === '.sass' ? 'indented' : 'scss',
    loadPaths: options.loadPaths,
    logger: {
      warn(message, { span, deprecation }) {
        warnings.push(issueFromSpan(deprecation ? `Deprecation: ${message}` : message, span, srcPath));
      },
      debug() {
        // @debug output is for the author's terminal, not for us.
      },
    },
  };

  try {
    const result = sass.compileString(code, {
      ...common,
      style: 'compressed',
      sourceMap: !!mapPath,
      sourceMapIncludeSources: false,
    });

    let css = result.css;
    const outputs: OutputFile[] = [];
    if (mapPath && result.sourceMap) {
      const map = { ...result.sourceMap } as { sources: string[]; sourceRoot?: string; file?: string };
      map.sources = map.sources.map((s) => {
        const file = s.startsWith('file:') ? fileUrlToPosix(s) : undefined;
        return file ? relativeFromMap(mapPath, toSourceSpelling(file, srcPath)) : s;
      });
      delete map.sourceRoot;
      map.file = path.posix.basename(outPath);
      css = withSourceMapComment(css, path.posix.basename(mapPath), 'css');
      outputs.push({ path: outPath, content: css }, { path: mapPath, content: JSON.stringify(map) });
    } else {
      outputs.push({ path: outPath, content: css });
    }

    if (config.scssEmitCss) {
      const expanded = sass.compileString(code, { ...common, style: 'expanded', logger: sass.Logger.silent });
      outputs.push({ path: expandedCssPath(outPath, srcPath), content: expanded.css + '\n' });
    }

    const dependencies = result.loadedUrls
      .map((u) => fileUrlToPosix(u))
      .filter((p): p is string => !!p)
      .map((p) => toSourceSpelling(p, srcPath))
      .filter((p) => !samePath(p, srcPath));

    return { ok: true, outputs, warnings, dependencies };
  } catch (error) {
    if (error instanceof sass.Exception) {
      return { ok: false, errors: [issueFromSpan(error.sassMessage, error.span, srcPath)] };
    }
    return { ok: false, errors: [{ message: errorMessage(error) }] };
  }
}
