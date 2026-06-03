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
  // Updates.setExtraParamAsync('bad-update-id', <id>) on the device), respond
  // with a rollBackToEmbeddedUpdate directive instead of the manifest. The
  // expo-updates client honors this by reverting to the embedded bundle on
  // next reload — closing the self-healing loop for devices that crashed
  // mid-render and the JS-side blocklist alone can't rescue.
  const extraParams = getExtraParamsFromHeaders(headers)
  const badUpdateId = extraParams['bad-update-id']
  if (badUpdateId && badUpdateId === update.updateId) {
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
