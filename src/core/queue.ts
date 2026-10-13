/**
 * Runs at most one task per key at a time. A task scheduled while its key is busy replaces any
 * task already waiting, and runs once the current one ends — so five quick saves of one file
 * produce at most two minifies, and the last one always sees the newest content. An older result
 * can therefore never overwrite a newer one.
 */
export class KeyedQueue {
  private readonly running = new Map<string, Promise<void>>();
  private readonly waiting = new Map<string, () => Promise<void>>();

  constructor(private readonly onError: (key: string, error: unknown) => void = () => undefined) {}

  /** Resolves when the key is idle again, including any task that replaced this one. */
  schedule(key: string, task: () => Promise<void>): Promise<void> {
    const current = this.running.get(key);
    if (current) {
      this.waiting.set(key, task);
      return current;
    }
    const run = this.drain(key, task);
    this.running.set(key, run);
    return run;
  }

  isBusy(key: string): boolean {
    return this.running.has(key);
  }

  private async drain(key: string, first: () => Promise<void>): Promise<void> {
    let task: (() => Promise<void>) | undefined = first;
    try {
      while (task) {
        try {
          await task();
        } catch (error) {
          this.onError(key, error);
        }
        task = this.waiting.get(key);
        this.waiting.delete(key);
      }
    } finally {
      this.running.delete(key);
    }
  }
}

/** Runs `worker` over `items` with at most `limit` in flight. Stops starting new ones once `isCancelled()`. */
export async function runPool<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>,
  isCancelled: () => boolean = () => false,
): Promise<void> {
  let next = 0;
  const lanes = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length && !isCancelled()) {
      const index = next++;
      await worker(items[index], index);
    }
  });
  await Promise.all(lanes);
}
