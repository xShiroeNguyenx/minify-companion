import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '..');
const readJson = (p: string) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8')) as Record<string, string>;

/** Every `l10n.t('…')` literal in the extension's sources. */
function runtimeStrings(): string[] {
  const out = new Set<string>();
  const walk = (dir: string) => {
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      if (fs.statSync(p).isDirectory()) walk(p);
      else if (p.endsWith('.ts') && !p.endsWith('.test.ts')) {
        const src = fs.readFileSync(p, 'utf8');
        for (const m of src.matchAll(/l10n\.t\(\s*'((?:\\'|[^'])*)'/g)) out.add(m[1].replace(/\\'/g, "'"));
      }
    }
  };
  walk(path.join(root, 'src'));
  return [...out];
}

describe('i18n', () => {
  it('translates every runtime string into Vietnamese', () => {
    const vi = readJson('l10n/bundle.l10n.vi.json');
    const strings = runtimeStrings();
    expect(strings.length).toBeGreaterThan(10);
    expect(strings.filter((s) => !(s in vi))).toEqual([]);
  });

  it('has no stale Vietnamese runtime strings', () => {
    const strings = new Set(runtimeStrings());
    expect(Object.keys(readJson('l10n/bundle.l10n.vi.json')).filter((k) => !strings.has(k))).toEqual([]);
  });

  it('has the same package.nls keys in English and Vietnamese, covering package.json', () => {
    const en = readJson('package.nls.json');
    const vi = readJson('package.nls.vi.json');
    expect(Object.keys(vi).sort()).toEqual(Object.keys(en).sort());
    const pkg = fs.readFileSync(path.join(root, 'package.json'), 'utf8');
    const used = [...pkg.matchAll(/"%([^%"]+)%"/g)].map((m) => m[1]);
    expect(used.filter((k) => !(k in en))).toEqual([]);
  });
});
