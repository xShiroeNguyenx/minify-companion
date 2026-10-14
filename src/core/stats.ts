import { gzipSync } from 'zlib';

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(2)} MB`;
}

/** Size saved, as a whole percentage; negative when the output grew. 0 for an empty source. */
export function savingPercent(before: number, after: number): number {
  if (before <= 0) return 0;
  return Math.round(((before - after) / before) * 100);
}

/** "−67%" when the output shrank, "+12%" when it grew (a source map comment on a tiny file). */
export function formatSaving(before: number, after: number): string {
  const pct = savingPercent(before, after);
  return pct >= 0 ? `−${pct}%` : `+${-pct}%`;
}

/**
 * Size of the text gzipped at the default level (6), roughly what a web server sends. Brotli at
 * its static level (11) would be closer to a CDN's, but takes seconds on a 1 MB file: too slow to
 * run on every save.
 */
export function gzipSize(text: string): number {
  return gzipSync(Buffer.from(text, 'utf8')).length;
}

/** UTF-8 byte length, which is what ends up on disk. */
export function byteLength(text: string): number {
  return Buffer.byteLength(text, 'utf8');
}

export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}
