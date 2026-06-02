import { parentPort } from 'node:worker_threads'

import { isLaunchBundleHealthy } from '../expo/integrity'
import { deletePatchFile, generatePatch, validatePatch } from '../expo/patch'

// Runs the CPU- and I/O-heavy patch pipeline (integrity → generate → validate)
// OFF the main event loop. The WASM bsdiff call is synchronous and would
// otherwise block the HTTP server / websockets for the whole diff; here it
// blocks only this thread. The main thread keeps doing Mongo I/O + scheduling.
//
// Input/output are plain (JSON-cloned) objects so nothing unclonable (ObjectId,
// class instances) crosses the thread boundary, and large bundle bytes never
// do — the worker reads/writes files itself and returns only metadata.

export interface GenerationJob {
  fromUpload: Record<string, unknown>
  toUpload: Record<string, unknown>
  platform: string
  benefitRatio: number
}

export type GenerationResult =
  | { outcome: 'ready'; path: string; size: number; targetSize: number; compressionRatio: number }
  // size/targetSize/compressionRatio are persisted so a later benefit-ratio
  // change can re-judge the patch without regenerating it.
  | { outcome: 'not-beneficial'; reason: string; size: number; targetSize: number; compressionRatio: number }
  | { outcome: 'failed'; error: string }

const run = async (job: GenerationJob): Promise<GenerationResult> => {
  const { fromUpload, toUpload, platform, benefitRatio } = job

  // Integrity pre-flight — never diff against a broken bundle.
  const fromHealth = isLaunchBundleHealthy(fromUpload, platform)
  if (!fromHealth.healthy) {
    return {
      outcome: 'failed',
      error: `FROM bundle integrity: ${fromHealth.blocking.map((b) => b.message).join('; ')}`,
    }
  }
  const toHealth = isLaunchBundleHealthy(toUpload, platform)
  if (!toHealth.healthy) {
    return { outcome: 'failed', error: `TO bundle integrity: ${toHealth.blocking.map((b) => b.message).join('; ')}` }
  }

  let gen
  try {
    gen = await generatePatch(fromUpload, toUpload, platform)
  } catch (e) {
    return { outcome: 'failed', error: `generation: ${e instanceof Error ? e.message : String(e)}` }
  }

  let validation
  try {
    validation = await validatePatch({ patchPath: gen.path, expectedTargetSize: gen.targetSize, benefitRatio })
  } catch (e) {
    deletePatchFile(gen.path)
    return { outcome: 'failed', error: `validation crash: ${e instanceof Error ? e.message : String(e)}` }
  }

  if (!validation.ok) {
    deletePatchFile(gen.path)
    if (validation.notBeneficial) {
      return {
        outcome: 'not-beneficial',
        reason: validation.reason,
        size: gen.size,
        targetSize: gen.targetSize,
        compressionRatio: gen.size / gen.targetSize,
      }
    }
    return { outcome: 'failed', error: validation.reason }
  }

  return {
    outcome: 'ready',
    path: gen.path,
    size: gen.size,
    targetSize: gen.targetSize,
    compressionRatio: gen.size / gen.targetSize,
  }
}

parentPort?.on('message', async (job: GenerationJob) => {
  let result: GenerationResult
  try {
    result = await run(job)
  } catch (e) {
    result = { outcome: 'failed', error: e instanceof Error ? e.message : String(e) }
  }
  parentPort?.postMessage(result)
})
