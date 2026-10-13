// Shared types. Nothing in core/ or minifiers/ imports 'vscode', so all of it runs under vitest.

export type Lang = 'css' | 'javascript' | 'html' | 'scss';

export type OnSaveMode = 'ifMinExists' | 'always' | 'off';

/** What asked for the minify. Each one applies the rules differently (see filter.ts). */
export type Trigger =
  /** A save in the editor. */
  | 'save'
  /** The user picked this very file (command palette, editor menu, explorer file). */
  | 'explicit'
  /** Found by walking a folder or the workspace. */
  | 'scan';

export interface MinifyConfig {
  onSave: OnSaveMode;
  languages: Lang[];
  exclude: string[];
  outputPattern: string;
  sourceMap: boolean;
  preserveLicenseComments: boolean;
  terser: Record<string, unknown>;
  cleancss: Record<string, unknown>;
  html: Record<string, unknown>;
  scssEmitCss: boolean;
  scssLoadPaths: string[];
  maxFileSizeKB: number;
}

/** A problem tied to a position. line and column are 1-based; either may be unknown. */
export interface Issue {
  message: string;
  /** Absolute POSIX-style path the issue is in, when it is not the source itself (a Sass partial). */
  file?: string;
  line?: number;
  column?: number;
}

export interface OutputFile {
  /** Absolute POSIX-style path. */
  path: string;
  content: string;
}

export type MinifyResult =
  | {
      ok: true;
      /** The minified file first, then its .map and any extra output. */
      outputs: OutputFile[];
      warnings: Issue[];
      /** Files the source pulled in (Sass), absolute POSIX-style, the source itself excluded. */
      dependencies?: string[];
    }
  | { ok: false; errors: Issue[] };

export interface MinifyInput {
  code: string;
  /** Absolute POSIX-style path of the source. */
  srcPath: string;
  /** Absolute POSIX-style path of the minified output. */
  outPath: string;
  config: MinifyConfig;
}
