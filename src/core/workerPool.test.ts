import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { WorkerPool } from './workerPool';

// A tiny worker: echoes { n } back as n * 2; "crash" throws, "exit" exits, "hang" never answers.
const SCRIPT = `
const { parentPort } = require('worker_threads');
parentPort.on('message', (msg) => {
  if (msg === 'crash') throw new Error('boom');
  if (msg === 'exit') process.exit(3);
  if (msg === 'hang') return;
  setTimeout(() => parentPort.postMessage(msg * 2), 20);
});
`;

let dir: string;
let script: string;
const pools: WorkerPool<unknown, number>[] = [];
const make = (size = 2, timeoutMs = 2000, idleMs = 10000) => {
  const p = new WorkerPool<unknown, number>(script, { size, timeoutMs, idleMs });
  pools.push(p);
  return p;
};

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-pool-'));
  script = path.join(dir, 'worker.cjs');
  fs.writeFileSync(script, SCRIPT);
});
afterEach(() => pools.splice(0).forEach((p) => p.dispose()));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('WorkerPool', () => {
  it('runs jobs and never starts more workers than its size', async () => {
    const pool = make(2);
    const results = await Promise.all([1, 2, 3, 4, 5].map((n) => pool.run(n)));
    expect(results).toEqual([2, 4, 6, 8, 10]);
    expect(pool.size).toBeLessThanOrEqual(2);
  });

  it('fails a job whose worker crashes, then keeps working with a fresh worker', async () => {
    const pool = make(1);
    await expect(pool.run('crash')).rejects.toThrow(/crashed: boom/);
    await expect(pool.run('exit')).rejects.toThrow(/exit code 3/);
    expect(await pool.run(21)).toBe(42);
  });

  it('times out a job that never answers and recovers', async () => {
    const pool = make(1, 200);
    await expect(pool.run('hang')).rejects.toThrow(/longer than/);
    expect(await pool.run(5)).toBe(10);
  });

  it('stops idle workers', async () => {
    const pool = make(1, 2000, 50);
    await pool.run(1);
    expect(pool.size).toBe(1);
    await new Promise((r) => setTimeout(r, 300));
    expect(pool.size).toBe(0);
  });

  it('rejects queued and new jobs once disposed', async () => {
    const pool = make(1);
    const first = pool.run('hang');
    const queued = pool.run(1);
    pool.dispose();
    await expect(queued).rejects.toThrow(/shut down/);
    await expect(first).rejects.toThrow();
    await expect(pool.run(1)).rejects.toThrow(/shut down/);
  });
});
