import { Worker } from 'worker_threads';

interface Job<I, O> {
  input: I;
  resolve: (value: O) => void;
  reject: (error: Error) => void;
}

interface Slot {
  worker: Worker;
  busy: boolean;
  idleTimer?: NodeJS.Timeout;
}

export interface WorkerPoolOptions {
  /** Most workers alive at once. */
  size: number;
  /** A job running longer than this kills its worker and fails. */
  timeoutMs: number;
  /** An idle worker is stopped after this long, to give its memory back. */
  idleMs: number;
}

/**
 * Runs jobs in worker threads so a long minify (Terser is synchronous CPU work: ~0.7 s for 200 KB
 * of JS) never blocks the extension host — the editor, other extensions and the save itself.
 *
 * Workers start on demand, are reused, and stop after being idle. A worker that crashes or times
 * out is discarded and its job fails with a message saying so; the next job gets a fresh one.
 * The script receives one input per message and must post back exactly one message per input.
 */
export class WorkerPool<I, O> {
  private readonly slots: Slot[] = [];
  private readonly queue: Job<I, O>[] = [];
  private disposed = false;

  constructor(
    private readonly script: string,
    private readonly options: WorkerPoolOptions,
  ) {}

  run(input: I): Promise<O> {
    if (this.disposed) return Promise.reject(new Error('Worker pool is shut down.'));
    return new Promise<O>((resolve, reject) => {
      this.queue.push({ input, resolve, reject });
      this.pump();
    });
  }

  /** Workers currently alive, for tests and logging. */
  get size(): number {
    return this.slots.length;
  }

  private pump(): void {
    while (this.queue.length) {
      let slot = this.slots.find((s) => !s.busy);
      if (!slot && this.slots.length < Math.max(1, this.options.size)) slot = this.spawn();
      if (!slot) return;
      this.execute(slot, this.queue.shift()!);
    }
  }

  private spawn(): Slot {
    const slot: Slot = { worker: new Worker(this.script), busy: false };
    // An idle worker must not keep the process alive.
    slot.worker.unref();
    this.slots.push(slot);
    return slot;
  }

  private remove(slot: Slot): void {
    const i = this.slots.indexOf(slot);
    if (i >= 0) this.slots.splice(i, 1);
    if (slot.idleTimer) clearTimeout(slot.idleTimer);
    void slot.worker.terminate();
  }

  private execute(slot: Slot, job: Job<I, O>): void {
    slot.busy = true;
    if (slot.idleTimer) clearTimeout(slot.idleTimer);
    const { worker } = slot;

    const finish = (fn: () => void, keep: boolean) => {
      clearTimeout(timer);
      worker.off('message', onMessage);
      worker.off('error', onError);
      worker.off('exit', onExit);
      fn();
      if (keep && !this.disposed) {
        slot.busy = false;
        slot.idleTimer = setTimeout(() => this.remove(slot), this.options.idleMs);
        slot.idleTimer.unref?.();
      } else {
        this.remove(slot);
      }
      this.pump();
    };

    const onMessage = (value: O) => finish(() => job.resolve(value), true);
    const onError = (error: Error) => finish(() => job.reject(new Error(`The minify worker crashed: ${error.message}`)), false);
    const onExit = (code: number) => finish(() => job.reject(new Error(`The minify worker stopped unexpectedly (exit code ${code}).`)), false);
    const timer = setTimeout(
      () => finish(() => job.reject(new Error(`Minifying took longer than ${Math.round(this.options.timeoutMs / 1000)} s and was stopped.`)), false),
      this.options.timeoutMs,
    );

    worker.on('message', onMessage);
    worker.on('error', onError);
    worker.on('exit', onExit);
    worker.postMessage(job.input);
  }

  dispose(): void {
    this.disposed = true;
    for (const job of this.queue.splice(0)) job.reject(new Error('Worker pool is shut down.'));
    for (const slot of [...this.slots]) this.remove(slot);
  }
}
