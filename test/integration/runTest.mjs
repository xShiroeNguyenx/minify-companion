// Launches a real VS Code (the oldest version package.json supports, so the bundle is proven on
// its Node runtime) with the built extension and a throwaway workspace, then runs suite.cjs inside it.
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { runTests } from '@vscode/test-electron';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const version = process.env.VSCODE_TEST_VERSION ?? JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).engines.vscode.replace(/^\^/, '');

// Run from a terminal inside VS Code, these leak in: ELECTRON_RUN_AS_NODE makes Code.exe behave
// as plain Node and exit at once, and the VSCODE_* ones point it at the parent instance.
for (const key of Object.keys(process.env)) {
  if (key === 'ELECTRON_RUN_AS_NODE' || key.startsWith('VSCODE_')) delete process.env[key];
}

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'minify-companion-ws-'));
const files = {
  'css/style.css': '.a {\n  color: red;\n}\n',
  'css/style.min.css': '/* stale */',
  'css/other.css': '.o { margin: 0px; }\n',
  'js/app.js': 'function add(first, second) {\n  return first + second;\n}\nwindow.add = add;\n',
  'js/app.min.js': '',
  'scss/_vars.scss': '$brand: #ff0000;\n',
  'scss/main.scss': '@use "vars";\n.a { color: vars.$brand; }\n',
  'scss/main.min.css': '',
  'page.html': '<p>  Hello  <b>World</b>  </p>\n',
  'page.min.html': '',
  '.vscode/settings.json': JSON.stringify({ 'files.autoSave': 'off' }),
};
for (const [rel, content] of Object.entries(files)) {
  fs.mkdirSync(path.dirname(path.join(workspace, rel)), { recursive: true });
  fs.writeFileSync(path.join(workspace, rel), content);
}

try {
  await runTests({
    version,
    // MC_EXTENSION_PATH: run against an unpacked .vsix instead of the source tree.
    extensionDevelopmentPath: process.env.MC_EXTENSION_PATH ?? root,
    extensionTestsPath: path.join(root, 'test', 'integration', 'suite.cjs'),
    launchArgs: [workspace, '--disable-extensions', '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes'],
  });
} catch (error) {
  console.error('Integration tests failed:', error);
  process.exitCode = 1;
} finally {
  if (process.env.KEEP_WS) console.log(`Workspace kept: ${workspace}`);
  else fs.rmSync(workspace, { recursive: true, force: true });
}
