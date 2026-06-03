import { createHash } from 'node:crypto'

import * as Err from '@feathersjs/errors'
import FormData from 'form-data'
import { parseDictionary, serializeDictionary } from 'structured-headers'

import { convertToDictionaryItemsRepresentation, getAssetMetadataSync, getMetadataSync, signRSASHA256 } from './helpers'
import { getRequestParams } from './request'

const getSignature = async ({ headers, manifest, privateKey }) => {
  const expectSignatureHeader = !!headers['expo-expect-signature']
  if (!expectSignatureHeader) return {}

  if (!privateKey) {
    throw new Err.BadRequest('Code signing requested but no key supplied when starting server.')
  }
  const manifestString = JSON.stringify(manifest)
  const hashSignature = signRSASHA256(manifestString, privateKey)
  const dictionary = convertToDictionaryItemsRepresentation({
    sig: hashSignature,
    keyid: 'main',
  })
  return { 'expo-signature': serializeDictionary(dictionary) }
}

// Parses the RFC 8941 structured-dictionary expo-extra-params request header
// (set on the client by Updates.setExtraParamAsync) into a plain object.
// Returns {} on missing/malformed input so callers can safely look up keys.
const getExtraParamsFromHeaders = (headers): Record<string, string> => {
  const raw = headers['expo-extra-params']
  if (!raw) return {}
  try {
    const dict = parseDictionary(raw)
    const out: Record<string, string> = {}
    for (const [key, [value]] of dict) {
      if (typeof value === 'string') out[key] = value
    }
    return out
  } catch {
    return {}
  }
}

// Returns a rollBackToEmbeddedUpdate directive response, mirroring the shape
// hanldeManifestData returns for normal manifests so the existing dispatch in
// handleManifestResponse can write the multipart/mixed body unchanged. The
// directive is signed with the same RSA-SHA256 + keyid:'main' scheme used for
// manifests, so clients with `expo-expect-signature: 1` accept it.
const buildRollbackDirective = async ({ headers, application }) => {
  const directive = {
    type: 'rollBackToEmbeddedUpdate',
    parameters: { commitTime: new Date().toISOString() },
  }

  const form = new FormData()
  form.append('directive', JSON.stringify(directive), {
    contentType: 'application/json',
    header: {
      'content-type': 'application/json; charset=utf-8',
      ...(await getSignature({ headers, manifest: directive, privateKey: application.privateKey })),
    },
  })

  return {
    type: 'manifest',
    formBoundary: form.getBoundary(),
    formData: form.getBuffer().toString(),
  }
}

// Deterministic UUID-shaped id derived from the previous update's real id, so
// every client rolling back from the same bad update to the same target gets
// the same synthetic id. This lets the bsdiff patch cache (keyed on
// from-update-id → to-update-id) reuse a single patch across the affected
// population instead of regenerating one per request.
const deriveRollbackTargetUpdateId = (prevUpdateId: string): string => {
  const hex = createHash('sha256').update(`${prevUpdateId}-rollback`).digest('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

// Republishes the previous known-good upload as a manifest with a fresh
// updateId and current commitTime. Same launchAsset + asset references as the
// original prev, so the bytes the client downloads are identical (and any
// device that still has prev cached can skip the bundle download entirely).
// Why fresh id + commitTime: the expo-updates loader policy only loads an
// update whose commitTime is strictly newer than the currently-running one
// (LoaderSelectionPolicyFilterAware.shouldLoadNewUpdate). Returning prev's
// original manifest as-is would be refused as a downgrade.
const buildRepublishedManifest = async ({
  prev,
  headers,
  application,
  runtimeVersion,
  platform,
}) => {
  const { metadataJson } = getMetadataSync(prev)
  const platformSpecificMetadata = metadataJson.fileMetadata[platform]

  const manifest = {
    id: deriveRollbackTargetUpdateId(prev.updateId),
    createdAt: new Date().toISOString(),
    runtimeVersion,
    assets: platformSpecificMetadata.assets.map((asset) =>
      getAssetMetadataSync({
        update: prev,
        filePath: asset.path,
        ext: asset.ext,
        runtimeVersion,
        platform,
        isLaunchAsset: false,
      }),
    ),
    launchAsset: getAssetMetadataSync({
      update: prev,
      filePath: platformSpecificMetadata.bundle,
      isLaunchAsset: true,
      runtimeVersion,
      platform,
      ext: null,
    }),
    metadata: {},
    extra: { expoClient: prev.appJson },
  }

  const assetRequestHeaders: Record<string, Record<string, string>> = {}
  ;[...manifest.assets, manifest.launchAsset].forEach((asset) => {
    assetRequestHeaders[asset.key] = { 'test-header': 'test-header-value' }
  })

  const form = new FormData()
  form.append('manifest', JSON.stringify(manifest), {
    contentType: 'application/json',
    header: {
      'content-type': 'application/json; charset=utf-8',
      ...(await getSignature({ headers, manifest, privateKey: application.privateKey })),
    },
  })
  form.append('extensions', JSON.stringify({ assetRequestHeaders }), {
    contentType: 'application/json',
  })

  return {
    type: 'manifest',
    formBoundary: form.getBoundary(),
    formData: form.getBuffer().toString(),
  }
}

export const hanldeManifestData = async (app, { query, headers }) => {
  const { project, platform, runtimeVersion, releaseChannel } = getRequestParams({ query, headers })

  const [update] = await app
    .service('uploads')
    .find({ query: { project, version: runtimeVersion, releaseChannel, status: 'released' } })
  if (!update) return { message: 'No uploads found' }

  const application = await app.service('apps').get(update.project)
  if (!application) return { message: 'No application found' }

  // Self-healing rollback path: if the client reports that the update we
  // would serve is exactly the one it has identified as bad (via
  // Updates.setExtraParamAsync('bad-update-id', <id>) on the device), try to
  // find the most recent older released-or-obsolete upload and republish it
  // under a fresh updateId/commitTime so the client's loader policy accepts
  // it as a forward update. If no older upload exists for this filter, fall
  // back to a rollBackToEmbeddedUpdate directive — the embedded bundle is
  // the protocol's only built-in last-resort target.
  const extraParams = getExtraParamsFromHeaders(headers)
  const badUpdateId = extraParams['bad-update-id']
  if (badUpdateId && badUpdateId === update.updateId) {
    const prevResult = await app.service('uploads').find({
      query: {
        project,
        version: runtimeVersion,
        releaseChannel,
        status: { $in: ['released', 'obsolete'] },
        updateId: { $ne: badUpdateId },
        $sort: { createdAt: -1 },
        $limit: 1,
      },
    })
    const prev = Array.isArray(prevResult) ? prevResult[0] : prevResult?.data?.[0]
    if (prev) {
      return await buildRepublishedManifest({
        prev,
        headers,
        application,
        runtimeVersion,
        platform,
      })
    }
    return await buildRollbackDirective({ headers, application })
  }

  try {
    const { metadataJson, createdAt } = getMetadataSync(update)

    const platformSpecificMetadata = metadataJson.fileMetadata[platform]
    const manifest = {
      id: update.updateId,
      createdAt,
      runtimeVersion,
      assets: platformSpecificMetadata.assets.map((asset) =>
        getAssetMetadataSync({
          update,
          filePath: asset.path,
          ext: asset.ext,
          runtimeVersion,
          platform,
          isLaunchAsset: false,
        }),
      ),
      launchAsset: getAssetMetadataSync({
        update,
        filePath: platformSpecificMetadata.bundle,
        isLaunchAsset: true,
        runtimeVersion,
        platform,
        ext: null,
      }),
      metadata: {},
      extra: {
        expoClient: update.appJson,
      },
    }

    const assetRequestHeaders = {}
    ;[...manifest.assets, manifest.launchAsset].forEach((asset) => {
      assetRequestHeaders[asset.key] = {
        'test-header': 'test-header-value',
      }
    })

    const form = new FormData()

    form.append('manifest', JSON.stringify(manifest), {
      contentType: 'application/json',
      header: {
        'content-type': 'application/json; charset=utf-8',
        ...(await getSignature({ headers, manifest, privateKey: application.privateKey })),
      },
    })

    form.append('extensions', JSON.stringify({ assetRequestHeaders }), {
      contentType: 'application/json',
    })

    return {
      type: 'manifest',
      formBoundary: form.getBoundary(),
      formData: form.getBuffer().toString(),
    }
  } catch (error) {
    throw new Err.BadRequest(JSON.stringify(error))
  }
}

export const handleManifestResponse = (res, protocolVersion) => {
  res.set('expo-protocol-version', protocolVersion ?? 0)
  res.set('expo-sfv-version', 0)
  res.set('cache-control', 'private, max-age=0')
  res.set('content-type', `multipart/mixed; boundary=${res.data.formBoundary}`)
  const buffer = Buffer.from(res.data.formData)
  res.write(buffer)
  res.end()
}
