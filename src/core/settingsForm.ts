import { FIELD_BY_KEY, VALIDATORS } from './config';
import { isMinFile, isSassPartial, langFromPath } from './lang';
import { isInside, resolveOutputPath, samePath } from './paths';

/**
 * The settings screen, without the UI: which settings it shows, how a raw form value becomes a
 * setting value, and the output-path preview. The webview is untrusted input like any other, so
 * everything it posts goes through parseFieldInput() before reaching the configuration.
 */

export type FieldKind = 'choice' | 'langs' | 'bool' | 'lines' | 'text' | 'number' | 'json';

export interface FieldSpec {
  /** Key under `minifyCompanion.`. */
  key: string;
  kind: FieldKind;
  /** Ignored from workspace settings while the workspace is untrusted (package.json restrictedConfigurations). */
  restricted?: boolean;
}

export const FIELDS: FieldSpec[] = [
  { key: 'onSave', kind: 'choice' },
  { key: 'languages', kind: 'langs' },
  { key: 'exclude', kind: 'lines' },
  { key: 'maxFileSizeKB', kind: 'number' },
  { key: 'outputPattern', kind: 'text', restricted: true },
  { key: 'sourceMap', kind: 'bool' },
  { key: 'preserveLicenseComments', kind: 'bool' },
  { key: 'statusBar', kind: 'bool' },
  { key: 'scss.emitCss', kind: 'bool' },
  { key: 'scss.loadPaths', kind: 'lines', restricted: true },
  { key: 'js.terser', kind: 'json', restricted: true },
  { key: 'css.cleancss', kind: 'json', restricted: true },
  { key: 'html.options', kind: 'json', restricted: true },
];

const FIELD_BY_SETTING = new Map(FIELDS.map((f) => [f.key, f]));

export function fieldSpec(key: string): FieldSpec | undefined {
  return FIELD_BY_SETTING.get(key);
}

export type FieldError =
  | { code: 'unknownSetting' }
  | { code: 'invalid' }
  | { code: 'notNumber' }
  | { code: 'notJson'; detail: string }
  | { code: 'notObject' }
  | { code: 'badPattern'; detail: string };

export type ParseResult = { ok: true; value: unknown } | { ok: false; error: FieldError };

/** One entry per non-empty line, trimmed. */
export function splitLines(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

/**
 * Turns what the form posted into the value to store. Text areas arrive as strings (one glob per
 * line, JSON text), checkboxes as booleans, the language list as an array.
 */
export function parseFieldInput(key: string, raw: unknown, context: PreviewContext = {}): ParseResult {
  const spec = fieldSpec(key);
  if (!spec) return { ok: false, error: { code: 'unknownSetting' } };

  let value: unknown = raw;
  switch (spec.kind) {
    case 'lines':
      if (typeof raw !== 'string') return { ok: false, error: { code: 'invalid' } };
      value = splitLines(raw);
      break;
    case 'number': {
      const text = typeof raw === 'string' ? raw.trim() : raw;
      const n = typeof text === 'number' ? text : text === '' ? NaN : Number(text);
      if (!Number.isFinite(n) || n <= 0) return { ok: false, error: { code: 'notNumber' } };
      value = n;
      break;
    }
    case 'json': {
      if (typeof raw !== 'string') return { ok: false, error: { code: 'invalid' } };
      if (!raw.trim()) {
        value = {};
        break;
      }
      try {
        value = JSON.parse(raw);
      } catch (error) {
        return { ok: false, error: { code: 'notJson', detail: error instanceof Error ? error.message : String(error) } };
      }
      if (typeof value !== 'object' || value === null || Array.isArray(value)) return { ok: false, error: { code: 'notObject' } };
      break;
    }
    case 'text':
      if (typeof raw !== 'string') return { ok: false, error: { code: 'invalid' } };
      value = raw.trim();
      break;
    default:
      break;
  }

  if (key === 'outputPattern' && typeof value === 'string') {
    // Without a real workspace folder, a literal absolute path (`D:/site/public/...`) cannot be
    // judged; the engine still checks it on every run.
    const judged = !!context.workspaceFolder || !isAbsoluteLiteral(value);
    const preview = previewOutputPattern(value, context);
    if (judged && preview.error) return { ok: false, error: { code: 'badPattern', detail: preview.error } };
  }

  return isValidValue(key, value) ? { ok: true, value } : { ok: false, error: { code: 'invalid' } };
}

/** Whether a stored value is one the engine accepts; a wrong one silently falls back to the default. */
export function isValidValue(key: string, value: unknown): boolean {
  const field = FIELD_BY_KEY[key];
  // statusBar is the only setting outside MinifyConfig.
  return field ? VALIDATORS[field](value) : key === 'statusBar' && typeof value === 'boolean';
}

export function isAbsoluteLiteral(pattern: string): boolean {
  return /^(\/|[a-zA-Z]:[\\/])/.test(pattern.trim());
}

/** Sample sources the output-pattern preview is shown for, relative to the workspace folder. */
export const PREVIEW_SOURCES = ['css/style.css', 'js/app.js', 'scss/theme.scss'];
/** Stands in for the workspace folder when none is open. */
const SAMPLE_ROOT = '/workspace';

export interface PreviewContext {
  /** Absolute POSIX-style workspace folder the preview is computed in; a sample one when absent. */
  workspaceFolder?: string;
  /** Absolute POSIX-style path of the file open in the editor, shown first when it is a source. */
  current?: string;
}

export interface PreviewRow {
  /** Relative to the workspace folder when inside it, else absolute. */
  source: string;
  output?: string;
  /** Why this file has no output under the pattern. */
  error?: string;
  /** The file open in the editor, rather than a sample. */
  current?: boolean;
}

export interface PreviewResult {
  rows: PreviewRow[];
  /** Set when the pattern fails for the sample files: wrong whatever file is saved. */
  error?: string;
}

/**
 * Where files would be written under `pattern`: the open file first (when it is a source), then
 * sample files in the workspace folder. A pattern that fails for the samples (unknown variable,
 * output over the source, outside the workspace) is wrong for every file, and `error` says why.
 * The open file can fail on its own, e.g. a ${workspaceFolder} pattern for a file outside any
 * folder; that is reported on its row only.
 */
export function previewOutputPattern(pattern: string, context: PreviewContext = {}): PreviewResult {
  const root = (context.workspaceFolder ?? SAMPLE_ROOT).replace(/\/+$/, '');
  const show = (p: string) => (isInside(p, root) ? p.slice(root.length + 1) : p);
  const explain = (reason: string) => reason.replaceAll(root, '${workspaceFolder}');
  const rows: PreviewRow[] = [];

  const current = context.current;
  if (current && langFromPath(current) && !isMinFile(current) && !isSassPartial(current)) {
    const ws = context.workspaceFolder && isInside(current, root) ? root : undefined;
    const result = resolveOutputPath(current, pattern, ws);
    rows.push(result.ok ? { source: show(current), output: show(result.path), current: true } : { source: show(current), error: explain(result.reason), current: true });
  }

  let error: string | undefined;
  for (const source of PREVIEW_SOURCES) {
    const file = `${root}/${source}`;
    if (current && samePath(file, current)) continue;
    const result = resolveOutputPath(file, pattern, root);
    if (!result.ok) {
      error = explain(result.reason);
      break;
    }
    rows.push({ source, output: show(result.path) });
  }
  return error ? { rows: rows.filter((r) => r.current), error } : { rows };
}

/** How a stored value is shown back in the form: the reverse of parseFieldInput. */
export function formatFieldValue(key: string, value: unknown): unknown {
  const spec = fieldSpec(key);
  if (!spec || value === undefined) return value;
  if (spec.kind === 'lines') return Array.isArray(value) ? value.join('\n') : '';
  if (spec.kind === 'json') return JSON.stringify(value ?? {}, null, 2);
  if (spec.kind === 'number') return typeof value === 'number' ? String(value) : '';
  return value;
}
