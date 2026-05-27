import { Flex, Spinner } from '../../Components'
import { useParams } from 'react-router-dom'
import { useCQuery } from '../../Services'
import { useState, useEffect } from 'react'
import { ConfigServer } from './ConfigServer'
import { ConfigApp } from './ConfigApp'
import { ReleaseManager } from './ReleaseManager'
import { PublishedUpdates } from './PublishedUpdates'
import { BsdiffManager } from './BsdiffManager'
import type { AppRecord, CertificateRecord } from '../../types'

export default function App () {
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
