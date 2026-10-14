import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { toPosix } from '../core/paths';
import {
  FIELDS,
  fieldSpec,
  formatFieldValue,
  isValidValue,
  parseFieldInput,
  previewOutputPattern,
  type FieldError,
  type FieldSpec,
  type PreviewContext,
} from '../core/settingsForm';

type Target = 'user' | 'workspace';

/** What the webview shows for one setting. Strings are already localized. */
interface FieldState {
  /** In the form's shape (text areas are strings). */
  value: unknown;
  /** Set at the selected level, so it can be reset. */
  setHere: boolean;
  /** Small lines under the control: where the value comes from, who overrides it. */
  notes: string[];
  /** Ignored right now because the workspace is not trusted. */
  ignored?: string;
}

/** Messages from the webview. Validated here: the page is a separate, untrusted context. */
type Incoming =
  | { type: 'ready' }
  | { type: 'target'; target: Target }
  | { type: 'set'; key: string; raw: unknown }
  | { type: 'reset'; key: string }
  | { type: 'preview'; pattern: string }
  | { type: 'openJson' }
  | { type: 'manageTrust' };

const SECTION = 'minifyCompanion';

/** One settings screen per window; the command reveals it if it is already open. */
export class SettingsPanel implements vscode.Disposable {
  private static current: SettingsPanel | undefined;
  private readonly disposables: vscode.Disposable[] = [];
  private target: Target = vscode.workspace.workspaceFolders?.length ? 'workspace' : 'user';
  /**
   * The last file on disk shown in a text editor, for the output preview. Remembered because
   * activeTextEditor is undefined while the settings screen itself has focus.
   */
  private lastFile: vscode.Uri | undefined = [vscode.window.activeTextEditor, ...vscode.window.visibleTextEditors].find(
    (e) => e?.document.uri.scheme === 'file',
  )?.document.uri;

  static show(context: vscode.ExtensionContext): void {
    if (SettingsPanel.current) {
      SettingsPanel.current.panel.reveal();
      return;
    }
    const panel = vscode.window.createWebviewPanel('minifyCompanion.settings', vscode.l10n.t('Minify Companion Settings'), vscode.ViewColumn.Active, {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'dist')],
    });
    SettingsPanel.current = new SettingsPanel(panel, context.extensionUri);
  }

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
  ) {
    panel.iconPath = vscode.Uri.joinPath(extensionUri, 'media', 'icon.png');
    panel.webview.html = renderHtml(panel.webview, vscode.Uri.joinPath(extensionUri, 'dist', 'settings.js'));
    this.disposables.push(
      panel.onDidDispose(() => this.dispose()),
      panel.webview.onDidReceiveMessage((m: Incoming) => void this.onMessage(m)),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration(SECTION)) this.postState();
      }),
      vscode.workspace.onDidGrantWorkspaceTrust(() => this.postState()),
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor?.document.uri.scheme !== 'file' || editor.document.uri.toString() === this.lastFile?.toString()) return;
        this.lastFile = editor.document.uri;
        // The page asks again with what is in the box, which may not be saved yet.
        this.post({ type: 'previewStale' });
      }),
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        if (!vscode.workspace.workspaceFolders?.length) this.target = 'user';
        this.postState();
      }),
    );
  }

  private async onMessage(m: Incoming): Promise<void> {
    switch (m?.type) {
      case 'ready':
        this.postState();
        break;
      case 'target':
        if (m.target === 'user' || (m.target === 'workspace' && vscode.workspace.workspaceFolders?.length)) this.target = m.target;
        this.postState();
        break;
      case 'set': {
        const parsed = parseFieldInput(String(m.key), m.raw, this.previewContext());
        if (!parsed.ok) {
          this.post({ type: 'fieldError', key: m.key, message: errorText(parsed.error) });
          return;
        }
        await this.write(m.key, parsed.value);
        break;
      }
      case 'reset':
        if (fieldSpec(String(m.key))) await this.write(m.key, undefined);
        break;
      case 'preview':
        this.post({ type: 'preview', preview: this.previewView(typeof m.pattern === 'string' ? m.pattern : '') });
        break;
      case 'openJson':
        await vscode.commands.executeCommand(this.target === 'workspace' ? 'workbench.action.openWorkspaceSettingsFile' : 'workbench.action.openSettingsJson');
        break;
      case 'manageTrust':
        await vscode.commands.executeCommand('workbench.trust.manage');
        break;
      default:
        break;
    }
  }

  /** Writes one setting at the selected level; `undefined` removes it (back to the inherited value). */
  private async write(key: string, value: unknown): Promise<void> {
    const target = this.target === 'workspace' ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
    try {
      await vscode.workspace.getConfiguration(SECTION).update(key, value, target);
    } catch (error) {
      // Typically a settings.json that does not parse: VS Code refuses to write into it.
      this.post({
        type: 'fieldError',
        key,
        message: vscode.l10n.t('Could not save: {0}', error instanceof Error ? error.message : String(error)),
      });
      return;
    }
    // update() resolves once the file is written; read back to be sure the value really took.
    // Skipped where VS Code hides workspace values on purpose (restricted, untrusted).
    const hidden = this.target === 'workspace' && !vscode.workspace.isTrusted && fieldSpec(key)?.restricted;
    const inspect = vscode.workspace.getConfiguration(SECTION).inspect(key);
    const stored = this.target === 'workspace' ? inspect?.workspaceValue : inspect?.globalValue;
    if (!hidden && JSON.stringify(stored) !== JSON.stringify(value)) {
      this.post({ type: 'fieldError', key, message: vscode.l10n.t('The value was written but VS Code reads back something else. Check the settings file.') });
    }
    this.postState();
  }

  private postState(): void {
    const hasWorkspace = !!vscode.workspace.workspaceFolders?.length;
    const fields: Record<string, FieldState> = {};
    for (const spec of FIELDS) fields[spec.key] = this.fieldState(spec);
    const pattern = fields.outputPattern.value;
    this.post({
      type: 'state',
      target: this.target,
      hasWorkspace,
      trusted: vscode.workspace.isTrusted,
      fields,
      preview: this.previewView(typeof pattern === 'string' ? pattern : ''),
    });
  }

  private fieldState(spec: FieldSpec): FieldState {
    const config = vscode.workspace.getConfiguration(SECTION);
    const inspect = config.inspect(spec.key);
    const user = inspect?.globalValue;
    const workspace = inspect?.workspaceValue;
    const notes: string[] = [];

    let value: unknown;
    let setHere: boolean;
    if (this.target === 'user') {
      setHere = user !== undefined;
      value = user ?? inspect?.defaultValue;
      if (workspace !== undefined) notes.push(vscode.l10n.t('This workspace sets its own value, which wins over this one.'));
    } else {
      setHere = workspace !== undefined;
      value = workspace ?? user ?? inspect?.defaultValue;
      if (!setHere && user !== undefined) notes.push(vscode.l10n.t('Not set for this workspace: your User value applies.'));
    }
    const folders = (vscode.workspace.workspaceFolders ?? []).filter(
      (f) => vscode.workspace.getConfiguration(SECTION, f.uri).inspect(spec.key)?.workspaceFolderValue !== undefined,
    );
    // Folder values only exist apart from the workspace value in a multi-root workspace.
    if (vscode.workspace.workspaceFile && folders.length) {
      notes.push(vscode.l10n.t('Overridden in folder settings: {0}.', folders.map((f) => f.name).join(', ')));
    }

    // VS Code does not enforce the schema on settings.json; the engine falls back to the default.
    if (value !== undefined && !isValidValue(spec.key, value)) {
      notes.push(vscode.l10n.t('The saved value {0} is not valid, so the default is used. Choose a value here to replace it.', JSON.stringify(value)));
    }

    const ignored =
      spec.restricted && !vscode.workspace.isTrusted && workspace !== undefined
        ? vscode.l10n.t('Ignored while this workspace is not trusted; the User value or the default is used.')
        : undefined;
    return { value: formatFieldValue(spec.key, value), setHere, notes, ignored };
  }

  /** The open file and its workspace folder (or the first folder), as the preview sees them. */
  private previewContext(): PreviewContext {
    const folder = (this.lastFile && vscode.workspace.getWorkspaceFolder(this.lastFile)) ?? vscode.workspace.workspaceFolders?.[0];
    return {
      workspaceFolder: folder ? toPosix(folder.uri.fsPath) : undefined,
      current: this.lastFile ? toPosix(this.lastFile.fsPath) : undefined,
    };
  }

  private previewView(pattern: string): { rows: Array<{ source: string; output?: string; error?: string; note?: string }>; error?: string } {
    const preview = previewOutputPattern(pattern, this.previewContext());
    return {
      rows: preview.rows.map((r) => ({
        source: r.source,
        output: r.output,
        error: r.error,
        note: r.current ? vscode.l10n.t('open in the editor') : undefined,
      })),
      error: preview.error && vscode.l10n.t('This pattern does not work: {0}', preview.error),
    };
  }

  private post(message: unknown): void {
    void this.panel.webview.postMessage(message);
  }

  dispose(): void {
    SettingsPanel.current = undefined;
    this.panel.dispose();
    for (const d of this.disposables.splice(0)) d.dispose();
  }
}

function errorText(error: FieldError): string {
  switch (error.code) {
    case 'notNumber':
      return vscode.l10n.t('Enter a number greater than 0.');
    case 'notJson':
      return vscode.l10n.t('Not valid JSON: {0}', error.detail);
    case 'notObject':
      return vscode.l10n.t('Enter a JSON object, for example {"mangle": false}.');
    case 'badPattern':
      return vscode.l10n.t('This pattern does not work: {0}', error.detail);
    default:
      return vscode.l10n.t('This value is not valid for this setting.');
  }
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

interface Option {
  value: string;
  label: string;
  hint?: string;
}

function control(key: string, label: string, description: string, body: string): string {
  return `<div class="field" data-field="${key}">
  <div class="head"><span class="label">${escapeHtml(label)}</span><span class="badge" hidden>${escapeHtml(vscode.l10n.t('Modified'))}</span>
    <button class="link reset" data-reset="${key}" hidden>${escapeHtml(vscode.l10n.t('Reset'))}</button></div>
  <div class="desc">${escapeHtml(description)} <code>minifyCompanion.${key}</code></div>
  ${body}
  <div class="notes"></div>
  <div class="error" role="alert"></div>
</div>`;
}

const checkbox = (key: string, label: string, description: string) =>
  control(key, label, description, `<label class="check"><input type="checkbox" data-key="${key}" data-kind="bool"> ${escapeHtml(vscode.l10n.t('On'))}</label>`);

const radios = (key: string, label: string, description: string, options: Option[]) =>
  control(
    key,
    label,
    description,
    options
      .map(
        (o) =>
          `<label class="choice"><input type="radio" name="${key}" value="${o.value}" data-key="${key}" data-kind="choice">
  <span><b>${escapeHtml(o.label)}</b>${o.hint ? `<br><span class="hint">${escapeHtml(o.hint)}</span>` : ''}</span></label>`,
      )
      .join(''),
  );

const lines = (key: string, label: string, description: string, placeholder: string) =>
  control(key, label, description, `<textarea rows="4" spellcheck="false" data-key="${key}" data-kind="lines" placeholder="${escapeHtml(placeholder)}"></textarea>`);

const json = (key: string, label: string, description: string, placeholder: string) =>
  control(key, label, description, `<textarea class="code" rows="5" spellcheck="false" data-key="${key}" data-kind="json" placeholder="${escapeHtml(placeholder)}"></textarea>`);

function renderHtml(webview: vscode.Webview, script: vscode.Uri): string {
  const nonce = crypto.randomBytes(16).toString('base64');
  const langs: Option[] = [
    { value: 'css', label: 'CSS' },
    { value: 'javascript', label: 'JavaScript' },
    { value: 'html', label: 'HTML' },
    { value: 'scss', label: 'Sass / SCSS' },
  ];
  const presets: Option[] = [
    { value: '${dir}/${name}.min.${ext}', label: vscode.l10n.t('Next to the source') },
    { value: '${workspaceFolder}/public/${relativeDir}/${name}.min.${ext}', label: vscode.l10n.t('Mirror into public/') },
    { value: '${dir}/min/${name}.${ext}', label: vscode.l10n.t('A min/ folder beside each source') },
  ];

  return `<!DOCTYPE html>
<html lang="${escapeHtml(vscode.env.language)}">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}' ${webview.cspSource};">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(vscode.l10n.t('Minify Companion Settings'))}</title>
<style nonce="${nonce}">${STYLE}</style>
</head>
<body>
<header>
  <h1>${escapeHtml(vscode.l10n.t('Minify Companion Settings'))}</h1>
  <div class="tabs" role="tablist">
    <button role="tab" data-target="user">${escapeHtml(vscode.l10n.t('User'))}</button>
    <button role="tab" data-target="workspace">${escapeHtml(vscode.l10n.t('Workspace'))}</button>
    <button class="link" id="open-json">${escapeHtml(vscode.l10n.t('Open settings.json'))}</button>
  </div>
  <p class="scope" data-scope="user">${escapeHtml(vscode.l10n.t('Applies to every project, unless a workspace sets its own value.'))}</p>
  <p class="scope" data-scope="workspace">${escapeHtml(vscode.l10n.t('Applies to this workspace only. Saved in .vscode/settings.json (or the .code-workspace file), so it can be shared with the project.'))}</p>
  <p class="scope" data-scope="noWorkspace">${escapeHtml(vscode.l10n.t('Open a folder to give a project its own settings.'))}</p>
  <div class="banner" id="untrusted" hidden>${escapeHtml(vscode.l10n.t('This workspace is not trusted: minify on save is off, and workspace values for output paths and minifier options are ignored.'))}
    <button class="link" id="manage-trust">${escapeHtml(vscode.l10n.t('Manage Workspace Trust'))}</button></div>
</header>
<main>
<section>
  <h2>${escapeHtml(vscode.l10n.t('On save'))}</h2>
  ${radios('onSave', vscode.l10n.t('Minify on save'), vscode.l10n.t('What saving a file does.'), [
    { value: 'ifMinExists', label: vscode.l10n.t('Update existing .min files'), hint: vscode.l10n.t('Only files that already have a .min file. Create it once with Minify Current File.') },
    { value: 'always', label: vscode.l10n.t('Always'), hint: vscode.l10n.t('Create or update the .min file on every save.') },
    { value: 'off', label: vscode.l10n.t('Off'), hint: vscode.l10n.t('Only the Minify commands minify.') },
  ])}
  ${control(
    'languages',
    vscode.l10n.t('File types'),
    vscode.l10n.t('Minified on save and by the folder and workspace commands.'),
    langs.map((o) => `<label class="check inline"><input type="checkbox" value="${o.value}" data-key="languages" data-kind="langs"> ${escapeHtml(o.label)}</label>`).join(''),
  )}
  ${lines('exclude', vscode.l10n.t('Excluded files'), vscode.l10n.t('One glob per line, relative to the workspace folder. Never minified on save or by the folder commands.'), '**/vendor/**')}
  ${control('maxFileSizeKB', vscode.l10n.t('Maximum file size (KB)'), vscode.l10n.t('Larger files are skipped.'), `<input type="number" min="1" step="1" data-key="maxFileSizeKB" data-kind="number">`)}
</section>
<section>
  <h2>${escapeHtml(vscode.l10n.t('Output'))}</h2>
  ${control(
    'outputPattern',
    vscode.l10n.t('Output path'),
    vscode.l10n.t('Variables: ${dir}, ${name}, ${ext}, ${workspaceFolder}, ${relativeDir}. A target outside the workspace folder is refused.'),
    `<input type="text" class="code" spellcheck="false" data-key="outputPattern" data-kind="text">
  <div class="presets">${presets.map((p) => `<button class="secondary" data-preset="${escapeHtml(p.value)}">${escapeHtml(p.label)}</button>`).join('')}</div>
  <div class="preview" aria-live="polite"></div>`,
  )}
  ${checkbox('sourceMap', vscode.l10n.t('Source maps'), vscode.l10n.t('Write a .map file next to minified JS, CSS and compiled Sass.'))}
  ${checkbox('preserveLicenseComments', vscode.l10n.t('Keep license comments'), vscode.l10n.t('Keep /*! … */ and @license comments.'))}
  ${checkbox('statusBar', vscode.l10n.t('Status bar'), vscode.l10n.t('Show the last result in the status bar.'))}
</section>
<section>
  <h2>Sass / SCSS</h2>
  ${checkbox('scss.emitCss', vscode.l10n.t('Also write uncompressed CSS'), vscode.l10n.t('Write name.css next to name.min.css.'))}
  ${lines('scss.loadPaths', vscode.l10n.t('Load paths'), vscode.l10n.t('One folder per line, relative to the workspace folder, searched by @use and @import.'), 'styles')}
</section>
<section>
  <h2>${escapeHtml(vscode.l10n.t('Minifier options (advanced)'))}</h2>
  <p class="desc">${escapeHtml(vscode.l10n.t('JSON objects merged over the safe defaults. Saved when the box loses focus; invalid JSON is not saved.'))}</p>
  ${json('js.terser', 'Terser (JavaScript)', vscode.l10n.t('See terser.org/docs/options.'), '{ "mangle": false }')}
  ${json('css.cleancss', 'clean-css (CSS)', vscode.l10n.t('level 2 merges rules more aggressively.'), '{ "level": 2 }')}
  ${json('html.options', 'html-minifier-terser (HTML)', vscode.l10n.t('Options for HTML files.'), '{ "removeComments": false }')}
</section>
</main>
<script nonce="${nonce}" src="${webview.asWebviewUri(script).toString()}"></script>
</body>
</html>`;
}

const STYLE = `
:root { color-scheme: light dark; }
body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground);
  background: var(--vscode-editor-background); margin: 0; padding: 0 24px 48px; }
header { position: sticky; top: 0; background: var(--vscode-editor-background); padding: 16px 0 8px;
  border-bottom: 1px solid var(--vscode-panel-border, transparent); z-index: 1; }
main { max-width: 760px; }
h1 { font-size: 1.6em; font-weight: 600; margin: 0 0 12px; }
h2 { font-size: 1.15em; font-weight: 600; margin: 28px 0 4px; padding-bottom: 4px; border-bottom: 1px solid var(--vscode-panel-border, transparent); }
.tabs { display: flex; gap: 4px; align-items: center; flex-wrap: wrap; }
.tabs [role=tab] { background: none; color: var(--vscode-foreground); border: none; border-bottom: 2px solid transparent;
  padding: 4px 10px; cursor: pointer; font: inherit; opacity: .75; }
.tabs [role=tab][aria-selected=true] { border-bottom-color: var(--vscode-focusBorder); opacity: 1; font-weight: 600; }
.tabs [role=tab]:disabled { opacity: .4; cursor: default; }
#open-json { margin-left: auto; }
.scope { margin: 6px 0 0; color: var(--vscode-descriptionForeground); }
.banner { margin-top: 8px; padding: 8px 10px; border: 1px solid var(--vscode-inputValidation-warningBorder);
  background: var(--vscode-inputValidation-warningBackground); }
.field { padding: 12px 0 12px 10px; border-left: 2px solid transparent; }
.field.modified { border-left-color: var(--vscode-settings-modifiedItemIndicator, var(--vscode-focusBorder)); }
.head { display: flex; align-items: center; gap: 8px; }
.label { font-weight: 600; }
.badge { font-size: .85em; color: var(--vscode-descriptionForeground); }
.desc, .hint, .notes { color: var(--vscode-descriptionForeground); }
.desc { margin: 2px 0 8px; }
.desc code { font-size: .9em; opacity: .8; }
.notes:empty, .error:empty { display: none; }
.notes { margin-top: 6px; font-style: italic; }
.notes .ignored { color: var(--vscode-editorWarning-foreground); font-style: normal; }
.error { margin-top: 6px; color: var(--vscode-errorForeground); white-space: pre-wrap; }
input[type=text], input[type=number], textarea { box-sizing: border-box; width: 100%; max-width: 560px; font: inherit;
  color: var(--vscode-input-foreground); background: var(--vscode-input-background);
  border: 1px solid var(--vscode-input-border, var(--vscode-panel-border, transparent)); padding: 4px 6px; }
input[type=number] { max-width: 140px; }
.code, textarea { font-family: var(--vscode-editor-font-family); }
textarea { resize: vertical; }
input:focus, textarea:focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
.invalid input, .invalid textarea { border-color: var(--vscode-inputValidation-errorBorder); }
.choice { display: flex; gap: 8px; align-items: flex-start; margin: 6px 0; cursor: pointer; }
.check { display: flex; gap: 6px; align-items: center; cursor: pointer; }
.check.inline { display: inline-flex; margin-right: 16px; }
button { font: inherit; cursor: pointer; }
button.secondary { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground);
  border: none; padding: 3px 10px; }
button.secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
button.link { background: none; border: none; padding: 0; color: var(--vscode-textLink-foreground); }
button.link:hover { text-decoration: underline; }
.presets { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 6px; }
.preview { margin-top: 8px; font-family: var(--vscode-editor-font-family); font-size: .95em; }
.preview .row { color: var(--vscode-descriptionForeground); }
.preview .row b { color: var(--vscode-foreground); font-weight: normal; }
.preview .bad { color: var(--vscode-errorForeground); font-family: var(--vscode-font-family); }
`;
