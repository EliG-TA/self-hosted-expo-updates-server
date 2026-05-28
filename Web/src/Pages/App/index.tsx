import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'

import { Flex, Spinner } from '../../Components'
import { FC, useCQuery } from '../../Services'
import type { AppRecord, CertificateRecord, UploadRecord } from '../../types'
import { BsdiffManager } from './BsdiffManager'
import { ConfigApp } from './ConfigApp'
import { ConfigServer } from './ConfigServer'
import { PublishedUpdates } from './PublishedUpdates'
import { ReleaseManager } from './ReleaseManager'
import { OpenUpdateContext } from './updateDetails'

// The update-details dialog (UpdateInfo + integrity + patch tabs) is heavy and
// only needed once an update is opened — load its chunk on first open.
const Release = lazy(() => import('./Release').then((m) => ({ default: m.Release })))

export default function App() {
  const { appId = '' } = useParams()
  const { data: app, isSuccess } = useCQuery<AppRecord & CertificateRecord>(['app', appId])
  const [appUpdate, setAppUpdate] = useState<AppRecord & CertificateRecord>(app || { _id: appId })
  const [openedUpdate, setOpenedUpdate] = useState<UploadRecord | null>(null)

  useEffect(() => {
    setAppUpdate(app || { _id: appId })
  }, [appId, app])

  const openByUpload = useCallback((upload: UploadRecord) => setOpenedUpdate(upload), [])
  const openByUpdateId = useCallback(async (updateId?: string) => {
    if (!updateId) return
    try {
      const res = await FC.client.service('uploads').find({ query: { updateId, $limit: 1 } })
      const upload = (Array.isArray(res) ? res[0] : (res as { data?: UploadRecord[] })?.data?.[0]) as UploadRecord
      if (upload) setOpenedUpdate(upload)
      else window.toast?.show({ severity: 'warn', summary: 'Update not found', detail: updateId })
    } catch (e) {
      window.toast?.show({ severity: 'error', summary: 'Failed to open update', detail: e.message })
    }
  }, [])

  if (!isSuccess) return <Spinner />
  return (
    <OpenUpdateContext.Provider value={{ openByUpload, openByUpdateId }}>
      <Flex fw js style={{ padding: 20, marginBottom: 300 }}>
        <ReleaseManager app={appUpdate} />
        <PublishedUpdates app={appUpdate} />
        <BsdiffManager app={appUpdate} />
        <ConfigServer state={[appUpdate, setAppUpdate]} />
        <ConfigApp app={appUpdate} />
      </Flex>
      {openedUpdate && (
        <Suspense fallback={<Spinner />}>
          <Release update={openedUpdate} onHide={() => setOpenedUpdate(null)} />
        </Suspense>
      )}
    </OpenUpdateContext.Provider>
  )
}
