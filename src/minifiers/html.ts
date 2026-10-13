import { minify, type Options } from 'html-minifier-terser';
import { errorMessage, locateHtmlError } from '../core/issues';
import type { MinifyInput, MinifyResult } from '../core/types';

/**
 * Safe defaults: `conservativeCollapse` keeps one space between inline elements so words do not
 * run together, and server-side template tags (PHP, EJS/ERB, mustache) are left untouched.
 */
export const DEFAULT_HTML_OPTIONS: Options = {
  collapseWhitespace: true,
  conservativeCollapse: true,
  removeComments: true,
  minifyCSS: true,
  minifyJS: true,
  removeRedundantAttributes: false,
  keepClosingSlash: true,
  ignoreCustomFragments: [/<%[\s\S]*?%>/, /<\?[\s\S]*?\?>/, /\{\{[\s\S]*?\}\}/],
};

/** `ignoreCustomFragments` can only be strings in settings.json; turn them into regexes. */
function toRegexList(value: unknown): RegExp[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: RegExp[] = [];
  for (const v of value) {
    if (v instanceof RegExp) out.push(v);
    else if (typeof v === 'string') {
      try {
        out.push(new RegExp(v));
      } catch {
        // An invalid pattern is skipped rather than failing every minify.
      }
    }
  }
  return out;
}

/**
 * A whole `<script>` whose type is not JavaScript (`text/template`, `text/x-handlebars-template`,
 * `application/ld+json`…). html-minifier leaves such a script alone by itself, but once
 * `ignoreCustomFragments` protects a `{{ … }}` inside it, the whitespace around that fragment gets
 * collapsed. Protecting the entire block keeps the template exactly as written.
 */
export const NON_JS_SCRIPT =
  /<script\b[^>]*?\btype\s*=\s*["']?(?!(?:text\/javascript|application\/javascript|text\/ecmascript|application\/ecmascript|module)["'\s>])[^"'\s>]+["']?[^>]*>[\s\S]*?<\/script\s*>/i;

export function buildHtmlOptions(input: MinifyInput): Options {
  const user = { ...input.config.html } as Record<string, unknown>;
  const fragments = toRegexList(user.ignoreCustomFragments);
  if (fragments) user.ignoreCustomFragments = fragments;
  const options: Options = { ...DEFAULT_HTML_OPTIONS, ...(user as Options) };
  // First, so a template block wins over the {{ }} fragments inside it.
  options.ignoreCustomFragments = [NON_JS_SCRIPT, ...(options.ignoreCustomFragments ?? [])];
  if (input.config.preserveLicenseComments) {
    // `<!--! … -->` survives removeComments, like `/*! … */` in CSS and JS.
    options.ignoreCustomComments = [/^!/, ...(options.ignoreCustomComments ?? [])];
  }
  return options;
}

export async function minifyHtml(input: MinifyInput): Promise<MinifyResult> {
  try {
    const code = await minify(input.code, buildHtmlOptions(input));
    return { ok: true, outputs: [{ path: input.outPath, content: code }], warnings: [] };
  } catch (error) {
    return { ok: false, errors: [locateHtmlError(errorMessage(error), input.code)] };
  }
}
