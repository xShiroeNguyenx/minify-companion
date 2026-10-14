// Runs inside the VS Code extension host. No test framework: each case throws on failure and the
// runner reports the first one. Kept in plain JS so it needs no build step of its own.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vscode = require('vscode');

const ws = () => vscode.workspace.workspaceFolders[0].uri.fsPath;
const file = (rel) => path.join(ws(), rel);
const read = (rel) => fs.readFileSync(file(rel), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(label, check, timeoutMs = 10000) {
  const end = Date.now() + timeoutMs;
  let last;
  while (Date.now() < end) {
    try {
      if (await check()) return;
      last = undefined;
    } catch (e) {
      last = e;
    }
    await sleep(50);
  }
  throw new Error(`Timed out waiting for: ${label}${last ? ` (${last.message})` : ''}`);
}

/** Opens the file, replaces its whole text and saves it through the editor, like Ctrl+S. */
async function editAndSave(rel, text) {
  const doc = await vscode.workspace.openTextDocument(file(rel));
  const editor = await vscode.window.showTextDocument(doc);
  await editor.edit((b) => b.replace(new vscode.Range(0, 0, doc.lineCount, 0), text));
  assert.ok(await doc.save(), `save of ${rel} failed`);
  return doc;
}

const cases = {
  async 'saving a CSS file updates its existing .min file'() {
    await editAndSave('css/style.css', '.a {\n  color : blue ;\n}\n');
    await waitFor('style.min.css updated', () => read('css/style.min.css') === '.a{color:#00f}' || read('css/style.min.css') === '.a{color:blue}');
  },

  async 'saving a CSS file with no .min yet does not create one (ifMinExists)'() {
    await editAndSave('css/other.css', '.o { margin: 1px; }\n');
    await sleep(800);
    assert.ok(!fs.existsSync(file('css/other.min.css')), 'other.min.css must not be created');
  },

  async 'the Minify Current File command creates the .min file'() {
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(file('css/other.css')));
    const outcome = await vscode.commands.executeCommand('minifyCompanion.minifyCurrent');
    await waitFor('other.min.css created', () => read('css/other.min.css') === '.o{margin:1px}');
    assert.strictEqual(outcome.kind, 'ok');
    assert.ok(outcome.gzip > 0, `gzip size reported (${outcome.gzip})`);
  },

  async 'a syntax error keeps the old .min and reports a problem at the right line'() {
    const before = read('js/app.min.js');
    const doc = await editAndSave('js/app.js', 'var ok = 1;\nvar broken = ;\n');
    await waitFor('diagnostic on app.js', () => vscode.languages.getDiagnostics(doc.uri).some((d) => d.range.start.line === 1));
    assert.strictEqual(read('js/app.min.js'), before, 'app.min.js must be untouched');
  },

  async 'fixing the error minifies and clears the problem'() {
    const doc = await editAndSave('js/app.js', 'function add(first, second) {\n  return first + second;\n}\nwindow.add = add;\n');
    await waitFor('app.min.js written', () => read('js/app.min.js').includes('window.add='));
    await waitFor('diagnostics cleared', () => vscode.languages.getDiagnostics(doc.uri).length === 0);
  },

  async 'saving a Sass partial recompiles the entry that uses it'() {
    await editAndSave('scss/main.scss', '@use "vars";\n.a { color: vars.$brand; }\n');
    await waitFor('main.min.css compiled', () => read('scss/main.min.css') === '.a{color:red}');
    await editAndSave('scss/_vars.scss', '$brand: #0000ff;\n');
    await waitFor('main.min.css recompiled from partial', () => read('scss/main.min.css') === '.a{color:blue}');
    assert.ok(!fs.existsSync(file('scss/_vars.min.css')), 'a partial must not get its own output');
  },

  async 'HTML is minified without gluing words together'() {
    await editAndSave('page.html', '<p>  Hello  <b>World</b>  </p>\n<!-- gone -->\n');
    await waitFor('page.min.html written', () => read('page.min.html').includes('Hello <b>World</b>') && !read('page.min.html').includes('gone'));
  },

  async 'quick successive saves end with the last content'() {
    const doc = await vscode.workspace.openTextDocument(file('css/style.css'));
    const editor = await vscode.window.showTextDocument(doc);
    for (let i = 1; i <= 5; i++) {
      await editor.edit((b) => b.replace(new vscode.Range(0, 0, doc.lineCount, 0), `.a { width: ${i}px; }\n`));
      await doc.save();
    }
    await waitFor('style.min.css has the last save', () => read('css/style.min.css') === '.a{width:5px}');
  },

  async 'source maps are written when enabled'() {
    const cfg = vscode.workspace.getConfiguration('minifyCompanion');
    await cfg.update('sourceMap', true, vscode.ConfigurationTarget.Workspace);
    try {
      await editAndSave('css/style.css', '.a {\n  width: 6px;\n}\n');
      await waitFor('map written', () => fs.existsSync(file('css/style.min.css.map')));
      assert.ok(read('css/style.min.css').endsWith('/*# sourceMappingURL=style.min.css.map */'));
      assert.deepStrictEqual(JSON.parse(read('css/style.min.css.map')).sources, ['style.css']);
    } finally {
      await cfg.update('sourceMap', undefined, vscode.ConfigurationTarget.Workspace);
    }
  },

  async 'minifying a large JS file does not block the extension host'() {
    // ~360 KB: about 1.2 s of Terser work, which used to freeze the host for that long.
    const big = Array.from({ length: 2600 }, (_, i) => `function fn${i}(alpha, beta) { var total = alpha + beta * ${i}; if (total > 10) { return total - 1; } return total; }\nwindow.fn${i} = fn${i};\n`).join('');
    fs.writeFileSync(file('js/big.js'), '');
    fs.writeFileSync(file('js/big.min.js'), '');
    let worstLag = 0;
    let last = Date.now();
    const timer = setInterval(() => {
      const now = Date.now();
      worstLag = Math.max(worstLag, now - last - 20);
      last = now;
    }, 20);
    try {
      await editAndSave('js/big.js', big);
      await waitFor('big.min.js written', () => read('js/big.min.js').includes('window.fn2599='), 30000);
    } finally {
      clearInterval(timer);
    }
    assert.ok(worstLag < 300, `extension host stalled for ${worstLag} ms`);
  },

  async 'Toggle Minify on Save turns saving off and back on'() {
    const cfg = () => vscode.workspace.getConfiguration('minifyCompanion');
    await vscode.commands.executeCommand('minifyCompanion.toggleAuto');
    assert.strictEqual(cfg().get('onSave'), 'off');
    await editAndSave('css/style.css', '.a { width: 7px; }\n');
    await sleep(800);
    assert.notStrictEqual(read('css/style.min.css'), '.a{width:7px}', 'saving while off must not minify');

    await vscode.commands.executeCommand('minifyCompanion.toggleAuto');
    assert.strictEqual(cfg().get('onSave'), 'ifMinExists');
    await editAndSave('css/style.css', '.a { width: 8px; }\n');
    await waitFor('minify on save is back', () => read('css/style.min.css') === '.a{width:8px}');
  },

  async 'Minify on a folder (Explorer) creates outputs for every file inside'() {
    const folder = vscode.Uri.file(file('lib'));
    await vscode.commands.executeCommand('minifyCompanion.minifySelected', folder, [folder]);
    assert.ok(read('lib/util.min.js').includes('window.twice='), 'lib/util.min.js');
    assert.strictEqual(read('lib/deep/box.min.css'), '.box{padding:0}');
    assert.ok(!fs.existsSync(file('vendor/v.min.js')), 'vendor/ is outside the selection');
  },

  async 'output files under a custom outputPattern are never minified again'() {
    const cfg = vscode.workspace.getConfiguration('minifyCompanion');
    await cfg.update('outputPattern', '${workspaceFolder}/out/${relativeDir}/${name}.${ext}', vscode.ConfigurationTarget.Workspace);
    try {
      await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(file('extra/e.css')));
      await vscode.commands.executeCommand('minifyCompanion.minifyCurrent');
      await waitFor('out/extra/e.css written', () => read('out/extra/e.css') === '.e{margin:0}');
      await vscode.commands.executeCommand('minifyCompanion.minifyWorkspace');
      assert.ok(!fs.existsSync(file('out/out')), 'Minify All must not minify its own outputs into out/out');
    } finally {
      await cfg.update('outputPattern', undefined, vscode.ConfigurationTarget.Workspace);
      fs.rmSync(file('out'), { recursive: true, force: true });
    }
  },

  async 'Minify All in Workspace creates missing outputs and honours exclude'() {
    await vscode.commands.executeCommand('minifyCompanion.minifyWorkspace');
    assert.strictEqual(read('extra/e.min.css'), '.e{margin:0}');
    assert.ok(fs.existsSync(file('css/other.min.css')), 'css/other.min.css');
    assert.ok(!fs.existsSync(file('vendor/v.min.js')), 'vendor/** is excluded by default');
    assert.ok(!fs.existsSync(file('scss/_vars.min.css')), 'partials never get an output');
    assert.ok(!fs.existsSync(file('css/style.min.min.css')), '.min files are never sources');
  },

  async 'Open Settings shows one settings screen, however often it is run'() {
    const settingsTabs = () =>
      vscode.window.tabGroups.all
        .flatMap((g) => g.tabs)
        .filter((t) => t.input instanceof vscode.TabInputWebview && t.input.viewType.endsWith('minifyCompanion.settings'));
    await vscode.commands.executeCommand('minifyCompanion.openSettings');
    await waitFor('settings tab open', () => settingsTabs().length === 1);
    await vscode.commands.executeCommand('minifyCompanion.openSettings');
    await sleep(300);
    assert.strictEqual(settingsTabs().length, 1, 'a second run reveals the open screen');
  },
};

exports.run = async function run() {
  const failures = [];
  for (const [name, fn] of Object.entries(cases)) {
    try {
      await fn();
      console.log(`  ✔ ${name}`);
    } catch (error) {
      console.log(`  ✘ ${name}\n    ${error && error.stack ? error.stack.split('\n').slice(0, 3).join('\n    ') : error}`);
      failures.push(name);
    }
  }
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  if (failures.length) throw new Error(`${failures.length} integration test(s) failed: ${failures.join('; ')}`);
};
