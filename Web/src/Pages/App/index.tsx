import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'

import { Flex, Spinner } from '../../Components'
import { useCQuery } from '../../Services'
import type { AppRecord, CertificateRecord } from '../../types'
import { BsdiffManager } from './BsdiffManager'
import { ConfigApp } from './ConfigApp'
import { ConfigServer } from './ConfigServer'
import { PublishedUpdates } from './PublishedUpdates'
import { ReleaseManager } from './ReleaseManager'

export default function App() {
  const { appId = '' } = useParams()
  const { data: app, isSuccess } = useCQuery<AppRecord & CertificateRecord>(['app', appId])
  const [appUpdate, setAppUpdate] = useState<AppRecord & CertificateRecord>(app || { _id: appId })

  useEffect(() => {
    setAppUpdate(app || { _id: appId })
  }, [appId, app])

  if (!isSuccess) return <Spinner />
  return (
    <Flex fw js style={{ padding: 20, marginBottom: 300 }}>
      <ReleaseManager app={appUpdate} />
      <PublishedUpdates app={appUpdate} />
      <BsdiffManager app={appUpdate} />
      <ConfigServer state={[appUpdate, setAppUpdate]} />
      <ConfigApp app={appUpdate} />
    </Flex>
  )
}
