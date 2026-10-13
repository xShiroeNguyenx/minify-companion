import { toPosix } from './paths';

/** Case-folds Windows paths so `D:/A/_x.scss` and `d:/a/_x.scss` are one node. */
function keyOf(p: string): string {
  const posix = toPosix(p);
  return /^[a-zA-Z]:\//.test(posix) ? posix.toLowerCase() : posix;
}

/**
 * Which Sass entry files pulled in which files, learnt from each compile's `loadedUrls`.
 * Saving a partial looks up its dependents here instead of recompiling the whole workspace.
 */
export class ScssGraph {
  /** entry key → dependency keys */
  private readonly deps = new Map<string, Set<string>>();
  /** key → original spelling, so callers get back the path they gave us */
  private readonly spelling = new Map<string, string>();

  setDependencies(entry: string, dependencies: readonly string[]): void {
    const entryKey = keyOf(entry);
    this.spelling.set(entryKey, toPosix(entry));
    const set = new Set<string>();
    for (const d of dependencies) {
      const k = keyOf(d);
      if (k !== entryKey) set.add(k);
    }
    this.deps.set(entryKey, set);
  }

  removeEntry(entry: string): void {
    this.deps.delete(keyOf(entry));
  }

  /** Entries that (transitively, as Sass reports it) load `file`. */
  dependentsOf(file: string): string[] {
    const k = keyOf(file);
    const out: string[] = [];
    for (const [entry, set] of this.deps) {
      if (set.has(k)) out.push(this.spelling.get(entry) ?? entry);
    }
    return out;
  }

  /** Whether any compile so far has seen `file` as a dependency. */
  knows(file: string): boolean {
    const k = keyOf(file);
    for (const set of this.deps.values()) if (set.has(k)) return true;
    return false;
  }
}
