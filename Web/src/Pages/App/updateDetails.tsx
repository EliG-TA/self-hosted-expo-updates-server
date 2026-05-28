import { createContext, useContext } from 'react'

import { Colors } from '../../Components'
import type { UploadRecord } from '../../types'

// Single shared "open update details" channel for the App page. The provider
// (App/index.tsx) owns one <Release> dialog; any table can open it by upload
// or by updateId without importing Release (which would create a circular
// dependency: Release → UpdateInfo → table → Release).
export interface OpenUpdateApi {
  openByUpload: (upload: UploadRecord) => void
  openByUpdateId: (updateId?: string) => void | Promise<void>
}

export const OpenUpdateContext = createContext<OpenUpdateApi | null>(null)

export const useOpenUpdate = (): OpenUpdateApi => {
  const ctx = useContext(OpenUpdateContext)
  // No-op fallback so components used outside the provider don't crash.
  return ctx || { openByUpload: () => {}, openByUpdateId: () => {} }
}

// Clickable, full-length updateId that opens the update's details dialog.
// Mirrors the link styling used in PublishedUpdates / ReleaseManager.
export const UpdateLink = ({ updateId }: { updateId?: string }) => {
  const { openByUpdateId } = useOpenUpdate()
  if (!updateId) return <span style={{ color: 'rgba(255,255,255,0.4)' }}>—</span>
  return (
    <span
      onClick={(e) => {
        e.stopPropagation()
        openByUpdateId(updateId)
      }}
      title="Open update details"
      style={{
        fontFamily: 'ui-monospace, Menlo, monospace',
        fontSize: 12,
        wordBreak: 'break-all',
        cursor: 'pointer',
        color: Colors.primary,
        textDecoration: 'underline dotted',
      }}>
      {updateId}
    </span>
  )
}
