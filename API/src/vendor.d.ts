declare module 'feathers-blob' {
  import type { AppService, UnknownRecord } from './types'

  interface BlobServiceOptions {
    Model: unknown
  }

  function blobService(options: BlobServiceOptions): AppService
  export = blobService
}

declare module 'fs-blob-store' {
  function fsBlobStore(path: string): unknown
  export = fsBlobStore
}

declare module 'structured-headers' {
  export function serializeDictionary(value: Map<string, [unknown, Map<string, unknown>]>): string
}
