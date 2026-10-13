import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from './config';
import { matchesAny, shouldMinify, type FilterInput } from './filter';
import type { MinifyConfig } from './types';

function input(over: Partial<Omit<FilterInput, 'config'>> & { config?: Partial<MinifyConfig> } = {}): FilterInput {
  const { config, ...rest } = over;
  return {
    srcPath: '/w/css/style.css',
    relativePath: 'css/style.css',
    trigger: 'save',
    config: { ...DEFAULT_CONFIG, ...config },
    workspaceTrusted: true,
    outputExists: true,
    ...rest,
  };
}

describe('shouldMinify', () => {
  it('minifies a save when the .min exists (default ifMinExists)', () => {
    expect(shouldMinify(input())).toEqual({ ok: true });
  });

  it('skips a save when the .min does not exist yet', () => {
    expect(shouldMinify(input({ outputExists: false }))).toEqual({ ok: false, reason: 'noMinYet' });
  });

  it('creates the .min on save in "always" mode', () => {
    expect(shouldMinify(input({ outputExists: false, config: { onSave: 'always' } }))).toEqual({ ok: true });
  });

  it('skips saves in "off" mode but not explicit runs', () => {
    expect(shouldMinify(input({ config: { onSave: 'off' } }))).toEqual({ ok: false, reason: 'autoOff' });
    expect(shouldMinify(input({ trigger: 'explicit', config: { onSave: 'off' } }))).toEqual({ ok: true });
  });

  it('never treats a .min file as a source, even when asked explicitly (no save loop)', () => {
    for (const trigger of ['save', 'explicit', 'scan'] as const) {
      expect(shouldMinify(input({ srcPath: '/w/a.min.css', relativePath: 'a.min.css', trigger, config: { exclude: [] } }))).toEqual({
        ok: false,
        reason: 'minFile',
      });
    }
  });

  it('never minifies a Sass partial by itself', () => {
    expect(shouldMinify(input({ srcPath: '/w/_vars.scss', relativePath: '_vars.scss', trigger: 'explicit' }))).toEqual({
      ok: false,
      reason: 'partial',
    });
  });

  it('honours exclude for saves and scans, not for an explicit file', () => {
    const vendor = { srcPath: '/w/node_modules/x/a.js', relativePath: 'node_modules/x/a.js' };
    expect(shouldMinify(input({ ...vendor }))).toEqual({ ok: false, reason: 'excluded' });
    expect(shouldMinify(input({ ...vendor, trigger: 'scan' }))).toEqual({ ok: false, reason: 'excluded' });
    expect(shouldMinify(input({ ...vendor, trigger: 'explicit' }))).toEqual({ ok: true });
  });

  it('honours languages', () => {
    expect(shouldMinify(input({ srcPath: '/w/a.js', relativePath: 'a.js', config: { languages: ['css'] } }))).toEqual({
      ok: false,
      reason: 'languageDisabled',
    });
  });

  it('scans create missing outputs', () => {
    expect(shouldMinify(input({ trigger: 'scan', outputExists: false }))).toEqual({ ok: true });
  });

  it('turns off saves in an untrusted workspace, leaves explicit runs', () => {
    expect(shouldMinify(input({ workspaceTrusted: false }))).toEqual({ ok: false, reason: 'untrusted' });
    expect(shouldMinify(input({ workspaceTrusted: false, trigger: 'explicit' }))).toEqual({ ok: true });
  });

  it('skips files over the size limit for every trigger', () => {
    expect(shouldMinify(input({ trigger: 'explicit', sizeBytes: 2048, config: { maxFileSizeKB: 1 } }))).toEqual({
      ok: false,
      reason: 'tooLarge',
    });
  });

  it('rejects unsupported extensions', () => {
    expect(shouldMinify(input({ srcPath: '/w/a.ts', relativePath: 'a.ts', trigger: 'explicit' }))).toEqual({
      ok: false,
      reason: 'unsupported',
    });
  });
});

describe('matchesAny', () => {
  it('matches the default excludes', () => {
    const ex = DEFAULT_CONFIG.exclude;
    expect(matchesAny(ex, 'node_modules/a/b.js')).toBe(true);
    expect(matchesAny(ex, 'pkg/node_modules/b.js')).toBe(true);
    expect(matchesAny(ex, 'a.min.js')).toBe(true);
    expect(matchesAny(ex, 'css/a.min.css')).toBe(true);
    expect(matchesAny(ex, 'css/a.css')).toBe(false);
    expect(matchesAny(ex, 'distribution/a.css')).toBe(false);
  });

  it('is false for an empty list', () => {
    expect(matchesAny([], 'a.css')).toBe(false);
  });
});
