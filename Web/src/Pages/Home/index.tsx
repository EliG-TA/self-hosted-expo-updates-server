import { Flex, Card, Spinner, Button } from '../../Components'
import { useCQuery } from '../../Services'
import { useNavigate } from 'react-router-dom'
import { AppDisplay } from './AppDisplay'
import type { AppRecord, ListResult } from '../../types'
import { listFromResult } from '../../types'

export default function Home () {
  const { data: appsResult, isSuccess } = useCQuery<ListResult<AppRecord>>('apps')
  const apps = listFromResult(appsResult)
  const navigate = useNavigate()
  if (!isSuccess) return <Spinner />

  return (
    <Flex fw js style={{ padding: 20, marginBottom: 300 }}>
      <Card title='MY APPS' fadeIn style={{ padding: 20, width: '100%', maxWidth: 900 }}>
        <Flex fw js>
          {apps.length
            ? apps.map(app => <AppDisplay app={app} key={app._id} goto={() => navigate(`/app/${app._id}`)} />)
            : <Button label='Add your first app' onClick={() => navigate('/new')} />}
        </Flex>
      </Card>
    </Flex>
  )
}
