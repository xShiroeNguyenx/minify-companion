// Runs inside the settings webview (a browser page), bundled to dist/settings.js. It only renders
// what the extension sends and posts raw form values back; validation happens in the extension.

interface FieldState {
  value: unknown;
  setHere: boolean;
  notes: string[];
  ignored?: string;
}

interface Preview {
  rows: Array<{ source: string; output?: string; error?: string; note?: string }>;
  /** The pattern is wrong for every file. */
  error?: string;
}

type Message =
  | { type: 'state'; target: 'user' | 'workspace'; hasWorkspace: boolean; trusted: boolean; fields: Record<string, FieldState>; preview: Preview }
  | { type: 'fieldError'; key: string; message: string }
  | { type: 'preview'; preview: Preview }
  /** Another file was opened: ask again with what is in the box now. */
  | { type: 'previewStale' };

declare function acquireVsCodeApi(): { postMessage(message: unknown): void };

const vscode = acquireVsCodeApi();
const $$ = <T extends Element>(selector: string, root: ParentNode = document) => Array.from(root.querySelectorAll<T>(selector));
const fieldEl = (key: string) => document.querySelector<HTMLElement>(`.field[data-field="${CSS.escape(key)}"]`);

/** Text boxes the user has typed into since the last save; a state update must not wipe them. */
const dirty = new Set<string>();

function setError(key: string, message: string): void {
  const field = fieldEl(key);
  if (!field) return;
  field.querySelector('.error')!.textContent = message;
  field.classList.toggle('invalid', !!message);
}

function readControl(input: HTMLInputElement | HTMLTextAreaElement): unknown {
  const key = input.dataset.key!;
  switch (input.dataset.kind) {
    case 'bool':
      return (input as HTMLInputElement).checked;
    case 'langs':
      return $$<HTMLInputElement>(`input[data-key="${key}"]`)
        .filter((i) => i.checked)
        .map((i) => i.value);
    default:
      return input.value;
  }
}

function save(input: HTMLInputElement | HTMLTextAreaElement): void {
  const key = input.dataset.key!;
  dirty.delete(key);
  setError(key, '');
  vscode.postMessage({ type: 'set', key, raw: readControl(input) });
}

function renderPreview(preview: Preview): void {
  const box = document.querySelector<HTMLElement>('.preview');
  if (!box) return;
  box.replaceChildren();
  const line = (className: string, ...content: Array<string | Node>) => {
    const div = document.createElement('div');
    div.className = className;
    div.append(...content);
    box.append(div);
  };
  if (preview.error) line('bad', preview.error);
  for (const row of preview.rows) {
    const note = row.note ? ` (${row.note})` : '';
    if (row.error) {
      line('row', `${row.source}${note}: `, Object.assign(document.createElement('span'), { className: 'bad', textContent: row.error }));
    } else {
      line('row', `${row.source}${note} → `, Object.assign(document.createElement('b'), { textContent: row.output ?? '' }));
    }
  }
}

function renderField(key: string, state: FieldState): void {
  const field = fieldEl(key);
  if (!field) return;
  field.classList.toggle('modified', state.setHere);
  field.querySelector<HTMLElement>('.badge')!.hidden = !state.setHere;
  field.querySelector<HTMLElement>('.reset')!.hidden = !state.setHere;

  const notes = field.querySelector<HTMLElement>('.notes')!;
  notes.replaceChildren();
  for (const text of state.notes) {
    const div = document.createElement('div');
    div.textContent = text;
    notes.append(div);
  }
  if (state.ignored) {
    const div = document.createElement('div');
    div.className = 'ignored';
    div.textContent = state.ignored;
    notes.append(div);
  }

  for (const input of $$<HTMLInputElement | HTMLTextAreaElement>(`[data-key="${CSS.escape(key)}"]`)) {
    switch (input.dataset.kind) {
      case 'bool':
        (input as HTMLInputElement).checked = state.value === true;
        break;
      case 'choice':
        (input as HTMLInputElement).checked = input.value === state.value;
        break;
      case 'langs':
        (input as HTMLInputElement).checked = Array.isArray(state.value) && state.value.includes(input.value);
        break;
      default:
        // Keep what the user is typing; it is saved (or rejected) when the box loses focus.
        if (dirty.has(key)) break;
        input.value = typeof state.value === 'string' ? state.value : '';
        setError(key, '');
    }
  }
}

function render(message: Extract<Message, { type: 'state' }>): void {
  for (const tab of $$<HTMLButtonElement>('[role=tab]')) {
    tab.setAttribute('aria-selected', String(tab.dataset.target === message.target));
    if (tab.dataset.target === 'workspace') tab.disabled = !message.hasWorkspace;
  }
  for (const p of $$<HTMLElement>('.scope')) {
    const scope = message.hasWorkspace ? message.target : 'noWorkspace';
    p.hidden = p.dataset.scope !== scope;
  }
  document.getElementById('untrusted')!.hidden = message.trusted;
  for (const [key, state] of Object.entries(message.fields)) renderField(key, state);
  if (!dirty.has('outputPattern')) renderPreview(message.preview);
}

window.addEventListener('message', (event: MessageEvent<Message>) => {
  const message = event.data;
  if (message.type === 'state') render(message);
  else if (message.type === 'fieldError') {
    setError(message.key, message.message);
    // The rejected text stays in the box so it can be fixed, not retyped.
    dirty.add(message.key);
  } else if (message.type === 'preview') renderPreview(message.preview);
  else if (message.type === 'previewStale') requestPreview();
});

for (const input of $$<HTMLInputElement | HTMLTextAreaElement>('[data-key]')) {
  const kind = input.dataset.kind;
  if (kind === 'bool' || kind === 'choice' || kind === 'langs') {
    input.addEventListener('change', () => save(input));
    continue;
  }
  input.addEventListener('input', () => dirty.add(input.dataset.key!));
  // `change` fires when the box loses focus with a new value: the moment to save.
  input.addEventListener('change', () => save(input));
  if (kind !== 'json' && kind !== 'lines') {
    input.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter') input.blur();
    });
  }
}

let previewTimer: ReturnType<typeof setTimeout> | undefined;
const pattern = document.querySelector<HTMLInputElement>('[data-key="outputPattern"]');
function requestPreview(): void {
  if (pattern) vscode.postMessage({ type: 'preview', pattern: pattern.value });
}
pattern?.addEventListener('input', () => {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(requestPreview, 150);
});
for (const button of $$<HTMLButtonElement>('[data-preset]')) {
  button.addEventListener('click', () => {
    if (!pattern) return;
    pattern.value = button.dataset.preset!;
    save(pattern);
  });
}

for (const button of $$<HTMLButtonElement>('[data-reset]')) {
  button.addEventListener('click', () => {
    const key = button.dataset.reset!;
    dirty.delete(key);
    vscode.postMessage({ type: 'reset', key });
  });
}
for (const tab of $$<HTMLButtonElement>('[role=tab]')) {
  tab.addEventListener('click', () => {
    dirty.clear();
    vscode.postMessage({ type: 'target', target: tab.dataset.target });
  });
}
document.getElementById('open-json')?.addEventListener('click', () => vscode.postMessage({ type: 'openJson' }));
document.getElementById('manage-trust')?.addEventListener('click', () => vscode.postMessage({ type: 'manageTrust' }));

vscode.postMessage({ type: 'ready' });
