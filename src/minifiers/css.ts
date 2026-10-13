import * as path from 'path';
import CleanCSS from 'clean-css';
import { relativeFromMap, samePath } from '../core/paths';
import { errorMessage, parseCleanCssMessage, stripSourceMapComment, withSourceMapComment } from '../core/issues';
import type { Issue, MinifyInput, MinifyResult } from '../core/types';

type Obj = Record<string, unknown>;

/**
 * clean-css options. `level` may be a number or an object per level; dropping license comments
 * means setting `specialComments: 0` inside level 1, so a numeric level is expanded first.
 */
export function buildCleanCssOptions(input: MinifyInput, withMap: boolean): Obj {
  const { config, srcPath, outPath } = input;
  // `inline: false`: keep `@import` as written. clean-css would otherwise read the imported
  // files from disk and paste them in, which is bundling, not minifying.
  const options: Obj = { inline: false, ...config.cleancss };

  if (!config.preserveLicenseComments) {
    const level = options.level ?? 1;
    let levels: Obj;
    if (typeof level === 'number') {
      levels = { 1: { specialComments: 0 } };
      if (level >= 2) levels[2] = {};
    } else {
      levels = { ...(level as Obj) };
      levels[1] = { ...((levels[1] as Obj) ?? {}), specialComments: 0 };
    }
    options.level = levels;
  }

  // url(...) is relative to the stylesheet; only rewrite it when the output lives elsewhere.
  const outDir = path.posix.dirname(outPath);
  const sameDir = samePath(outDir, path.posix.dirname(srcPath));
  options.rebase = !sameDir;
  // Always set: clean-css rewrites @import paths against rebaseTo even with rebase off, and
  // without it that means the process cwd.
  options.rebaseTo = outDir;

  options.sourceMap = withMap;
  options.returnPromise = false;
  return options;
}

export async function minifyCss(input: MinifyInput): Promise<MinifyResult> {
  const mapPath = input.config.sourceMap ? `${input.outPath}.map` : undefined;
  const options = buildCleanCssOptions(input, !!mapPath);
  try {
    const output = new CleanCSS(options as CleanCSS.OptionsOutput).minify({
      [input.srcPath]: { styles: stripSourceMapComment(input.code) },
    });

    const errors: Issue[] = output.errors.map((m) => parseCleanCssMessage(m));
    const warnings: Issue[] = [];
    for (const w of output.warnings) {
      const parsed = parseCleanCssMessage(w);
      (parsed.fatal ? errors : warnings).push({ message: parsed.message, line: parsed.line, column: parsed.column });
    }
    if (errors.length) return { ok: false, errors };

    let code = output.styles;
    const outputs = [{ path: input.outPath, content: code }];
    if (mapPath && output.sourceMap) {
      const map = JSON.parse(output.sourceMap.toString()) as { sources: string[]; file?: string };
      // clean-css records sources relative to the cwd; point them at the real file instead.
      map.sources = [relativeFromMap(mapPath, input.srcPath)];
      map.file = path.posix.basename(input.outPath);
      code = withSourceMapComment(code, path.posix.basename(mapPath), 'css');
      outputs[0] = { path: input.outPath, content: code };
      outputs.push({ path: mapPath, content: JSON.stringify(map) });
    }
    return { ok: true, outputs, warnings };
  } catch (error) {
    return { ok: false, errors: [{ message: errorMessage(error) }] };
  }
}
