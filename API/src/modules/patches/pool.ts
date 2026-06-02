import * as path from 'node:path'
import { Worker } from 'node:worker_threads'

import type { GenerationJob, GenerationResult } from './generate.worker'

// Bun loads the .ts worker directly (no build step). Resolved relative to this
// file (via __dirname, since the project compiles as CommonJS) so it works in
// both dev (bun --watch) and the prod image (bun run).
const WORKER_PATH = path.join(__dirname, 'generate.worker.ts')

// One worker per job. bsdiff jobs run for seconds, so the ~tens-of-ms spawn +
// wasm-compile cost is negligible, and a fresh isolate per job means a crash or
// runaway allocation can't poison later jobs. Parallelism is bounded upstream
// by the worker loop's concurrency pool, so this never spawns more than N.
export const runGenerationJob = (job: GenerationJob): Promise<GenerationResult> =>
  new Promise<GenerationResult>((resolve, reject) => {
    const worker = new Worker(WORKER_PATH)
    let settled = false

    const settle = (fn: () => void) => {
      if (settled) return
      settled = true
      void worker.terminate()
      fn()
    }

    worker.on('message', (msg: GenerationResult) => settle(() => resolve(msg)))
    worker.on('error', (err: Error) => settle(() => reject(err)))
    worker.on('exit', (code: number) => {
      if (settled) return
      settle(() => reject(new Error(`generation worker exited (code ${code}) before responding`)))
    })

    worker.postMessage(job)
  })
