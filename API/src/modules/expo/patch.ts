import * as crypto from 'crypto'
import * as fs from 'fs'
import * as path from 'path'

import { getMetadataSync } from './helpers'

const PATCH_BENEFIT_RATIO = 0.75
const PATCH_DIR_NAME = '_patches'
// @hot-updater/bsdiff emits the Endsley bsdiff variant, whose 16-byte header
// is "ENDSLEY/BSDIFF43" (see node_modules/@hot-updater/bsdiff rust src:
// `patch.extend_from_slice(b"ENDSLEY/BSDIFF43")`). NOT the classic 8-byte
// "BSDIFF40". The magic check must match what the library actually produces.
const BSDIFF_MAGIC = Buffer.from('ENDSLEY/BSDIFF43', 'utf8')

let hdiffPromise = null
const loadHdiff = () => {
  if (!hdiffPromise) {
    // @hot-updater/bsdiff is ESM-only; load it via dynamic import from CommonJS.
    hdiffPromise = import('@hot-updater/bsdiff').then((m) => m.hdiff)
  }
  return hdiffPromise
}

const sha256 = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex')

export const getLaunchAssetPath = (upload, platform) => {
  const { metadataJson } = getMetadataSync(upload)
  const platformMeta = metadataJson?.fileMetadata?.[platform]
  if (!platformMeta?.bundle) {
    throw new Error(`No bundle for platform ${platform} in update ${upload.updateId}`)
  }
  return path.join(upload.path, platformMeta.bundle)
}

// Which platforms this upload ships a launch bundle for. Used by the manual
// patch-enqueue flow to compute the from↔to platform intersection (a patch
// is only meaningful when both updates have a bundle for that platform).
export const getAvailablePlatforms = (upload): string[] => {
  try {
    const { metadataJson } = getMetadataSync(upload)
    const fm = metadataJson?.fileMetadata || {}
    // android first, then ios — drives the manual-enqueue creation order.
    return ['android', 'ios'].filter((p) => fm[p]?.bundle)
  } catch (e) {
    return []
  }
}

export const getPatchDir = (toUpload) => path.join(toUpload.path, PATCH_DIR_NAME)

export const getPatchFilePath = (toUpload, fromUpload, platform) =>
  path.join(getPatchDir(toUpload), `from-${fromUpload.updateId}-${platform}.patch`)

const ensurePatchDir = (toUpload) => {
  const dir = getPatchDir(toUpload)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  return dir
}

export const generatePatch = async (fromUpload, toUpload, platform) => {
  const fromPath = getLaunchAssetPath(fromUpload, platform)
  const toPath = getLaunchAssetPath(toUpload, platform)
  if (!fs.existsSync(fromPath)) throw new Error(`Base bundle missing: ${fromPath}`)
  if (!fs.existsSync(toPath)) throw new Error(`Target bundle missing: ${toPath}`)

  const fromBuf = fs.readFileSync(fromPath)
  const toBuf = fs.readFileSync(toPath)

  const hdiff = await loadHdiff()
  const patchBytes = await hdiff(fromBuf, toBuf)
  // @hot-updater/bsdiff returns a Uint8Array-like; ensure Buffer for fs.write
  const patchBuf = Buffer.isBuffer(patchBytes) ? patchBytes : Buffer.from(patchBytes.buffer || patchBytes)

  ensurePatchDir(toUpload)
  const outPath = getPatchFilePath(toUpload, fromUpload, platform)
  fs.writeFileSync(outPath, patchBuf)

  return {
    path: outPath,
    size: patchBuf.length,
    targetSize: toBuf.length,
    targetHash: sha256(toBuf),
    fromHash: sha256(fromBuf),
  }
}

/**
 * Server-side validation of a freshly generated patch.
 *
 * Strategy (no server-side apply — see docs/bsdiff-implementation-plan.md):
 * 1. Magic header check — patch must start with BSDIFF40 (the format both
 *    iOS bspatch.c and Android BSPatch.cpp expect).
 * 2. Non-empty body.
 * 3. Benefit check — patch.length < 0.75 * target.length, else patch wastes
 *    client CPU/battery for negligible network savings → terminal `not-beneficial`.
 *
 * Final correctness (sha256 of patched output == target hash) is enforced by
 * the native client (see expo-updates FileDownloader iOS/Android), which
 * auto-falls back to a full download on mismatch. Duplicating that on the
 * server is dead work.
 */
export const validatePatch = async ({ patchPath, expectedTargetSize }) => {
  let patchBuf
  try {
    patchBuf = fs.readFileSync(patchPath)
  } catch (e) {
    return { ok: false, reason: `failed to read patch file: ${e.message}` }
  }

  if (patchBuf.length < BSDIFF_MAGIC.length) {
    return { ok: false, reason: `patch too small (${patchBuf.length} bytes)` }
  }
  if (!patchBuf.subarray(0, BSDIFF_MAGIC.length).equals(BSDIFF_MAGIC)) {
    return {
      ok: false,
      reason: `magic mismatch: expected ENDSLEY/BSDIFF43 header`,
    }
  }

  const benefitRatio = patchBuf.length / expectedTargetSize
  if (benefitRatio >= PATCH_BENEFIT_RATIO) {
    return {
      ok: false,
      reason: `not-beneficial: patch is ${(benefitRatio * 100).toFixed(1)}% of target (threshold ${PATCH_BENEFIT_RATIO * 100}%)`,
      notBeneficial: true,
    }
  }

  return { ok: true }
}

export const deletePatchFile = (patchPath) => {
  if (patchPath && fs.existsSync(patchPath)) {
    try {
      fs.unlinkSync(patchPath)
    } catch (e) {
      // best-effort; file may already be gone
    }
  }
}

export const sumPatchesSize = (toUpload) => {
  const dir = getPatchDir(toUpload)
  if (!fs.existsSync(dir)) return 0
  let total = 0
  for (const entry of fs.readdirSync(dir)) {
    try {
      total += fs.statSync(path.join(dir, entry)).size
    } catch (e) {
      /* ignore */
    }
  }
  return total
}

export { PATCH_BENEFIT_RATIO, PATCH_DIR_NAME, sha256 }
