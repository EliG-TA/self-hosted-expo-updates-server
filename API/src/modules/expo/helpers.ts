import * as crypto from 'crypto'
import * as fs from 'fs'
import mimeModule from 'mime'
import * as path from 'path'

import type { AssetMetadataOptions, MetadataResult, UnknownRecord, UploadRecord } from '../../types'

const mime = mimeModule

function createHash(file, hashingAlgorithm, encoding) {
  return crypto.createHash(hashingAlgorithm).update(file).digest(encoding)
}

function getBase64URLEncoding(base64EncodedString) {
  return base64EncodedString.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export const convertToDictionaryItemsRepresentation = (
  obj: UnknownRecord,
): Map<string, [unknown, Map<string, unknown>]> => {
  return new Map(Object.entries(obj).map(([k, v]) => [k, [v, new Map()] as [unknown, Map<string, unknown>]]))
}

export const signRSASHA256 = (data, privateKey) => {
  const sign = crypto.createSign('RSA-SHA256')
  sign.update(data, 'utf8')
  sign.end()
  return sign.sign(privateKey, 'base64')
}

export const getPrivateKeyAsync = async () => {
  const privateKeyPath = process.env.PRIVATE_KEY_PATH
  if (!privateKeyPath) return null

  let pemBuffer: Buffer
  try {
    pemBuffer = fs.readFileSync(path.resolve(privateKeyPath))
    return pemBuffer.toString('utf8')
  } catch (e) {
    return false
  }
}

export const getAssetMetadataSync = ({ update, filePath, ext, isLaunchAsset, platform }: AssetMetadataOptions) => {
  const normalizedFilePath = path.normalize(filePath).replace(/\\/g, '/')
  const assetFilePath = path.join(update.path, normalizedFilePath)
  const asset = fs.readFileSync(path.resolve(assetFilePath), null)
  const assetHash = getBase64URLEncoding(createHash(asset, 'sha256', 'base64'))
  const key = createHash(asset, 'md5', 'hex')
  const keyExtensionSuffix = isLaunchAsset ? 'bundle' : ext
  const contentType = isLaunchAsset ? 'application/javascript' : mime.getType(ext)

  const baseUrl = `${process.env.PUBLIC_URL}/api/assets?asset=${assetFilePath}&contentType=${encodeURI(contentType)}&platform=${platform}`
  // Launch assets need to know which (project, updateId) they're being
  // served as so the patch flow on the server can look up patches between
  // the client's currentUpdateId and this one.
  const url = isLaunchAsset
    ? `${baseUrl}&project=${encodeURIComponent(update.project)}&updateId=${encodeURIComponent(update.updateId)}`
    : baseUrl

  return {
    hash: assetHash,
    key,
    fileExtension: `.${keyExtensionSuffix}`,
    contentType,
    url,
  }
}

// Manifest timestamp prefers releasedAt, but unreleased uploads (and the
// pre-flight integrity guard that runs *before* release) have none — fall back
// to createdAt, then to now, so `new Date(...).toISOString()` never throws
// `RangeError: Invalid Date` and blocks the release. See issue #48.
const resolveManifestTimestamp = (update: UploadRecord): string => {
  for (const candidate of [update.releasedAt, update.createdAt]) {
    if (!candidate) continue
    const d = new Date(candidate)
    if (!Number.isNaN(d.getTime())) return d.toISOString()
  }
  return new Date().toISOString()
}

export const getMetadataSync = (update: UploadRecord): MetadataResult => {
  try {
    const metadataPath = `${update.path}/metadata.json`
    const updateMetadataBuffer = fs.readFileSync(path.resolve(metadataPath), null)
    const metadataJson = JSON.parse(updateMetadataBuffer.toString('utf-8'))

    return {
      metadataJson,
      createdAt: resolveManifestTimestamp(update),
    }
  } catch (error) {
    throw new Error(`No update found with runtime version: ${update.version}. Error: ${error}`)
  }
}

const convertSHA256HashToUUID = (value) => {
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20, 32)}`
}

export { convertSHA256HashToUUID }

const getUpdateHash = (pathToUpdate) => {
  const metadataPath = `${pathToUpdate}/metadata.json`
  const updateMetadataBuffer = fs.readFileSync(path.resolve(metadataPath), null)
  return createHash(updateMetadataBuffer, 'sha256', 'hex')
}

export { getUpdateHash }

const getUpdateId = (pathToUpdate, updateHash) => {
  const combined = pathToUpdate + updateHash
  const id = createHash(combined, 'sha256', 'hex')
  return convertSHA256HashToUUID(id)
}

export { getUpdateId }
