import { Text, Card, Spinner } from '../../Components'
import { useCQuery } from '../../Services'
import { UpdateInfo } from './UpdateInfo'
import _ from 'lodash'

const compareVersions = (a, b) => {
  const partsA = a.split(/[-.]/).map(x => isNaN(x) ? x : parseInt(x))
  const partsB = b.split(/[-.]/).map(x => isNaN(x) ? x : parseInt(x))
  for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
    const partA = partsA[i] || 0
    const partB = partsB[i] || 0
    if (partA > partB) return 1
    if (partA < partB) return -1
  }
  return 0
}

export const PublishedUpdates = ({ app }) => {
  const { data: published, isSuccess } = useCQuery(['published', app._id])

  if (!isSuccess) return <Spinner />

  // Group by version
  const grouped = _.groupBy(published, 'version')

  // Sort versions descending
  const sortedVersions = Object.keys(grouped).sort((a, b) => compareVersions(b, a))

  // Sort updates within each group by releasedAt descending
  sortedVersions.forEach(version => {
    grouped[version] = _.sortBy(grouped[version], u => -new Date(u.releasedAt))
  })

  return (
    <Card title='PUBLISHED UPDATES' collapsable collapsed={!published.length} fadeIn style={{ padding: 20, width: '100%', maxWidth: 900, marginTop: 40 }}>
      {!published.length && <Text value='No published updates yet, upload and release one to see it here' />}
      {sortedVersions.map((version, versionInd) => (
        <Card key={version} collapsable collapsed={!!versionInd} title={`Version ${version}`} style={{ marginTop: 20 }}>
          {grouped[version].map((update, ind) => (
            <Card key={update._id} collapsable collapsed={!!ind} title={`${update.releaseChannel} - ${update.gitCommit}`} style={{ marginTop: 10 }}>
              <UpdateInfo update={update} />
            </Card>
          ))}
        </Card>
      ))}
    </Card>
  )
}
