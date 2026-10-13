import { langFromPath } from '../core/lang';
import type { MinifyInput, MinifyResult } from '../core/types';
import type { ScssOptions } from './scss';

/**
 * Picks the minifier by extension. Each library is imported on first use, so activating the
 * extension does not evaluate terser, clean-css, html-minifier-terser and sass up front.
 */
export async function runMinifier(input: MinifyInput, scss: ScssOptions): Promise<MinifyResult> {
  switch (langFromPath(input.srcPath)) {
    case 'javascript':
      return (await import('./js')).minifyJs(input);
    case 'css':
      return (await import('./css')).minifyCss(input);
    case 'html':
      return (await import('./html')).minifyHtml(input);
    case 'scss':
      return (await import('./scss')).minifyScss(input, scss);
    default:
      return { ok: false, errors: [{ message: `Unsupported file type: ${input.srcPath}` }] };
  }
}
