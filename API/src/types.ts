export type UnknownRecord = Record<string, unknown>

interface PatchCollectionLike {
  updateOne(filter: UnknownRecord, update: UnknownRecord): Promise<unknown>
  findOneAndUpdate(filter: UnknownRecord, update: UnknownRecord, options?: UnknownRecord): Promise<{ value?: unknown } | null>
  find(filter: UnknownRecord): { toArray(): Promise<unknown[]> }
}

export interface AppService {
  find(params?: UnknownRecord): Promise<unknown>
  get(id?: unknown, params?: UnknownRecord): Promise<unknown>
  create(data?: unknown, params?: UnknownRecord): Promise<unknown>
  update(id: unknown, data?: unknown, params?: UnknownRecord): Promise<unknown>
  patch(id: unknown, data?: unknown, params?: UnknownRecord): Promise<unknown>
  remove(id?: unknown, params?: UnknownRecord): Promise<unknown>
  _create?(data?: unknown, params?: UnknownRecord): Promise<unknown>
  _patch?(id: unknown, data?: unknown, params?: UnknownRecord): Promise<unknown>
  purgeAll?(data?: unknown): Promise<unknown>
  hooks?(hooks: UnknownRecord): void
  Model?: PatchCollectionLike
  publish?(event: string, callback: (data: unknown, context: UnknownRecord) => unknown): void
}

export interface LoggerLike {
  info(source: unknown, info?: unknown): void
  warn(source: unknown, info?: unknown): void
  error(source: unknown, info?: unknown): void
  debug(source: unknown, info?: unknown): void
}

export interface AppLike {
  service(name: string): AppService
  services: Record<string, AppService>
  get(name: string): unknown
  set(name: string, value: unknown): void
}

export interface RequestParams {
  query?: UnknownRecord
  headers?: Record<string, string | undefined>
  provider?: unknown
  user?: UnknownRecord & { _id?: unknown }
  file?: {
    originalname: string
    mimetype: string
    buffer: Buffer
  }
}

export interface HookContextLike {
  app: AppLike
  service: AppService
  method?: string
  path?: string
  id?: unknown
  data?: unknown
  result?: unknown
  params?: RequestParams
  type?: string
  error?: Error & { code?: number; name?: string }
  toJSON?: () => unknown
}

export interface UploadRecord extends UnknownRecord {
  _id: string
  project?: string
  version?: string
  releaseChannel?: string
  status?: string
  path?: string
  filename?: string
  size?: number | string
  updateId?: string
  updateHash?: string
  createdAt?: string | Date
  releasedAt?: string | Date
  gitCommit?: string
  gitBranch?: string
  appJson?: unknown
  dependencies?: unknown
}

export interface MetadataJson {
  fileMetadata?: Record<string, { bundle?: string; assets?: Array<{ path: string; ext?: string }> }>
}

export interface MetadataResult {
  metadataJson: MetadataJson
  createdAt: string
}

export interface AssetMetadataOptions {
  update: UploadRecord
  filePath: string
  ext?: string | null
  isLaunchAsset: boolean
  platform: string
  runtimeVersion?: string
}


export interface IntegrityIssue {
  severity: 'error' | 'warning'
  category: string
  message: string
}

export interface IntegrityResult {
  issues: IntegrityIssue[]
  errorCount: number
  warningCount: number
}


export interface ClientRecord extends UnknownRecord {
  _id?: string
  project?: string
  version?: string
  platform?: string
  releaseChannel?: string
  embeddedUpdate?: string
  currentUpdate?: string
  lastSeen?: string | Date
  updateCount?: number
}

export interface PatchRecord extends UnknownRecord {
  _id: string
  path?: string
  project?: string
}
