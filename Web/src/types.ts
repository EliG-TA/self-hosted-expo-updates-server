import type { CSSProperties, Dispatch, ReactNode, RefObject, SetStateAction } from 'react'
import type { Toast } from 'primereact/toast'

export type UnknownRecord = Record<string, unknown>
export interface DynamicData extends Array<UnknownRecord>, UnknownRecord {
  data: UnknownRecord[]
}
export type QueryKeyValue = string | readonly unknown[]

export type ToastRef = Toast

export interface Paginated<T> {
  data: T[]
  total?: number
  limit?: number
  skip?: number
}

export type ListResult<T> = T[] | Paginated<T>

export const listFromResult = <T>(result: ListResult<T> | null | undefined): T[] => {
  if (!result) return []
  return Array.isArray(result) ? result : result.data || []
}

export interface AppRecord extends UnknownRecord {
  _id: string
  name?: string
  bsdiffEnabled?: boolean
}

export interface UploadRecord extends UnknownRecord {
  _id: string
  project?: string
  version?: string
  releaseChannel?: string
  status?: string
  path?: string
  filename?: string
  size?: number
  updateId?: string
  updateHash?: string
  uploadAvailable?: boolean
  createdAt?: string | Date
  releasedAt?: string | Date
  gitCommit?: string
  gitBranch?: string
  embeddedIos?: boolean
  embeddedAndroid?: boolean
}

export interface PatchRecord extends UnknownRecord {
  _id: string
  project?: string
  status?: string
  size?: number
  servedCount?: number
}

export interface DiskUsageRecord extends UnknownRecord {
  updatesBytes?: number
  patchesBytes?: number
  usedBytes?: number
  freeBytes?: number
  totalBytes?: number
}

export interface CertificateRecord extends UnknownRecord {
  privateKey?: string
  certificate?: string
}

export interface ServiceOutcome extends UnknownRecord {
  error?: string
  removed?: number
}

export interface IntegrityIssue extends UnknownRecord {
  severity?: string
  message?: string
}

export interface IntegrityRecord extends UnknownRecord {
  errorCount?: number
  warningCount?: number
  issues: IntegrityIssue[]
}

export interface PatchJobRecord extends UnknownRecord {
  _id?: string
  project?: string | null
  type?: string
  status?: string
  platform?: string
  startedAt?: string | Date
  durationMs?: number
  fromUpdateId?: string
  toUpdateId?: string
  error?: string
  reason?: string
}

export interface FlexProps extends React.HTMLAttributes<HTMLDivElement> {
  style?: CSSProperties
  row?: boolean
  children?: ReactNode
  js?: boolean
  jb?: boolean
  je?: boolean
  jse?: boolean
  jc?: boolean
  flexrow?: boolean
  as?: boolean
  ae?: boolean
  width?: CSSProperties['width']
  height?: CSSProperties['height']
  fw?: boolean
  fh?: boolean
  bg?: string | boolean
  wrap?: boolean
  black?: boolean
}

export type StateTuple<T> = [T, Dispatch<SetStateAction<T>>]

export interface InputProps extends UnknownRecord {
  setRef?: (ref: RefObject<unknown>) => void
  setValue?: (value: string) => void
  useState?: StateTuple<string>
  onChange?: (value: string | UnknownRecord) => void
  onEnter?: () => void | Promise<void>
  autofocus?: boolean
  password?: boolean
  date?: boolean
  label?: string
  multiline?: boolean
  dropdown?: boolean
  autoComplete?: string
  error?: boolean
  id?: string
  value?: unknown
  style?: CSSProperties & { textWidth?: CSSProperties['width'] }
}
