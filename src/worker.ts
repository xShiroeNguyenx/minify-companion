// Entry point of dist/worker.js: runs one minify per message, off the extension host's thread.
// No 'vscode' here; everything a job needs travels in the message.
import { parentPort } from 'worker_threads';
import { errorMessage } from './core/issues';
import { gzipSize } from './core/stats';
import type { MinifyInput, MinifyResult } from './core/types';
import { runMinifier } from './minifiers';
import type { ScssOptions } from './minifiers/scss';

export interface WorkerRequest {
  input: MinifyInput;
  scss: ScssOptions;
}

parentPort?.on('message', async (request: WorkerRequest) => {
  let result: MinifyResult;
  try {
    result = await runMinifier(request.input, request.scss);
    // Here rather than in the extension host: gzipping a few MB takes tens of milliseconds.
    if (result.ok && result.outputs.length) result.gzipSize = gzipSize(result.outputs[0].content);
  } catch (error) {
    // The minifiers return errors as results; this is for anything they did not expect.
    result = { ok: false, errors: [{ message: errorMessage(error) }] };
  }
  parentPort?.postMessage(result);
});
