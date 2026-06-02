import { useState } from 'react'
import _ from 'lodash'
import moment from 'moment'
import { Column } from 'primereact/column'
import { DataTable } from 'primereact/datatable'

import { Card, Colors, Spinner, Text } from '../../Components'
import { useCollapsedState, useCQuery } from '../../Services'
import { Release } from './Release'

const compareVersions = (a, b) => {
  const partsA = a.split(/[-.]/).map((x) => (isNaN(x) ? x : parseInt(x)))
  const partsB = b.split(/[-.]/).map((x) => (isNaN(x) ? x : parseInt(x)))
  for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
    const partA = partsA[i] || 0
    const partB = partsB[i] || 0
    if (partA > partB) return 1
    if (partA < partB) return -1
  }
  return 0
}

const formatDate = (d) => (d ? moment(d).format('YYYY-MM-DD HH:mm:ss') : '—')

// gitCommit field is populated by the upload script as `git log --oneline -n 1`,
// so it's '<shortSha> <subject>' rather than a bare hash. Split the two so the
// hash gets monospace styling and the subject is plain readable prose.
const splitCommit = (raw) => {
  if (!raw) return { hash: null, subject: null }
  const idx = raw.indexOf(' ')
  if (idx === -1) return { hash: raw, subject: null }
  return { hash: raw.slice(0, idx), subject: raw.slice(idx + 1) }
}

// Per-version table — hooks for persisted collapsed state must live in their
// own component so they're not called inside .map().
const VersionTable = ({ project, version, updates, defaultCollapsed, onOpen }) => {
  const [collapsed, setCollapsed] = useCollapsedState(`published:${project}:version:${version}`, defaultCollapsed)
  return (
    <Card
      collapsable
      collapsed={collapsed}
      onToggle={setCollapsed}
      title={`Runtime ${version}  ·  ${updates.length} release${updates.length === 1 ? '' : 's'}`}
      style={{ marginTop: 20 }}>
      <DataTable
        value={updates}
        size="small"
        paginator={updates.length > 10}
        rows={10}
        sortField="releasedAt"
        sortOrder={-1}
        style={{ width: '100%', marginTop: 10 }}>
        <Column
          field="updateId"
          header="Update ID"
          sortable
          body={(row) => (
            <span
              onClick={(e) => {
                e.stopPropagation()
                onOpen(row)
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
              {row.updateId || '—'}
            </span>
          )}
        />
        <Column field="releaseChannel" header="Channel" sortable style={{ width: 130 }} />
        <Column
          field="gitCommit"
          header="Commit"
          sortable
          body={(row) => {
            const { hash, subject } = splitCommit(row.gitCommit)
            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span
                  style={{
                    fontFamily: 'ui-monospace, Menlo, monospace',
                    fontSize: 12,
                    color: 'rgba(255,255,255,0.7)',
                  }}>
                  {hash || '—'}
                </span>
                {subject && (
                  <span style={{ fontSize: 12 }} title={subject}>
                    {subject}
                  </span>
                )}
                {row.gitBranch && <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)' }}>{row.gitBranch}</span>}
              </div>
            )
          }}
        />
        <Column
          field="releasedAt"
          header="Published"
          sortable
          style={{ width: 180 }}
          body={({ releasedAt }) => (
            <span style={{ fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>{formatDate(releasedAt)}</span>
          )}
        />
      </DataTable>
    </Card>
  )
}

export const PublishedUpdates = ({ app }) => {
  const { data: published, isSuccess } = useCQuery(['published', app._id])
  const [collapsed, setCollapsed] = useCollapsedState(`published:${app._id}:root`, false)
  const [openedUpdate, setOpenedUpdate] = useState(null)

  if (!isSuccess) return <Spinner />

  const grouped = _.groupBy(published, 'version')
  const sortedVersions = Object.keys(grouped).sort((a, b) => compareVersions(b, a))

  return (
    <Card
      title="PUBLISHED UPDATES"
      collapsable
      collapsed={collapsed}
      onToggle={setCollapsed}
      fadeIn
      style={{ padding: 20, width: '100%', maxWidth: 900, marginTop: 40 }}>
      {!published.length && <Text value="No published updates yet, upload and release one to see it here" />}
      {sortedVersions.map((version, versionInd) => (
        <VersionTable
          key={version}
          project={app._id}
          version={version}
          updates={grouped[version]}
          defaultCollapsed={!!versionInd}
          onOpen={setOpenedUpdate}
        />
      ))}

      <Release update={openedUpdate} onHide={() => setOpenedUpdate(null)} />
    </Card>
  )
}
