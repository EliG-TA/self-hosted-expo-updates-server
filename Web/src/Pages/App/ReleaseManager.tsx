import { useState, useEffect } from 'react'
import { DataTable } from 'primereact/datatable'
import { Column } from 'primereact/column'
import { TabView, TabPanel } from 'primereact/tabview'
import moment from 'moment'

import { FC, useCQuery, invalidateQuery } from '../../Services'
import { Button, Card, Flex, Spinner, Text, Colors, StatusPill } from '../../Components'
import { Release } from './Release'
import { UpdateInstructions } from './UpdateInstructions'

const fmtBytes = (n) => {
  if (!n) return '0 B'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}

const OldUpdatesCleanupSection = ({ project, onOpenUpload }) => {
  const [olderThanDays, setOlderThanDays] = useState(90)
  const [calculating, setCalculating] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [result, setResult] = useState(null) // { count, totalBytes, olderThanDays } when computed
  const [opening, setOpening] = useState(null) // uploadId currently being fetched for the dialog

  const handleCalculate = async (daysOverride) => {
    const days = daysOverride ?? olderThanDays
    setCalculating(true)
    setResult(null)
    try {
      const res = await FC.client.service('utils').get('oldUpdatesCleanupCandidates', {
        query: { project, olderThanDays: days }
      })
      setResult({ ...res, computedForDays: days })
    } catch (e) {
      window.toast?.show({ severity: 'error', summary: 'Calculation failed', detail: e.message })
    }
    setCalculating(false)
  }

  // Auto-load only on mount and when the project changes (e.g. user switches
  // to a different app). Editing the Window input no longer triggers a
  // request — user has to click Recalculate explicitly.
  useEffect(() => {
    handleCalculate(olderThanDays)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project])

  const handleOpenCandidate = async (candidate) => {
    if (!candidate?._id) return
    setOpening(candidate._id)
    try {
      const upload = await FC.client.service('uploads').get(candidate._id)
      onOpenUpload?.(upload)
    } catch (e) {
      window.toast?.show({ severity: 'error', summary: 'Failed to load upload', detail: e.message })
    }
    setOpening(null)
  }

  const handleCleanup = async () => {
    if (!result?.count) return
    const computedForDays = result.computedForDays
    const msg = `Delete ${result.count} old update(s) (${fmtBytes(result.totalBytes)}) not used by any client in the last ${computedForDays} days?\n\nOnly currently-released updates are excluded — everything else (obsolete, ready, …) is eligible.\n\nThis permanently removes files and database records.`
    if (!window.confirm(msg)) return

    setDeleting(true)
    try {
      const res = await FC.client.service('utils').update('cleanupOldUpdates', {
        project,
        olderThanDays: computedForDays
      })
      invalidateQuery(['uploads', 'published', 'diskUsage'])
      window.toast?.show({
        severity: 'info',
        summary: `Removed ${res?.removed || 0} old updates`,
        detail: `Freed ${fmtBytes(res?.totalBytes || 0)}`
      })
      // Recompute with the same window so the user sees the post-cleanup
      // state (ideally 0 candidates) without an extra manual click.
      await handleCalculate(computedForDays)
    } catch (e) {
      window.toast?.show({ severity: 'error', summary: 'Cleanup failed', detail: e.message })
    }
    setDeleting(false)
  }

  const canShowDelete = result !== null && !calculating && !deleting

  return (
    <div style={{ width: '100%' }}>
      <Flex fw as style={{ gap: 12, padding: 10 }}>
        <Text
          value='Delete old, non-released updates: anything created more than N days ago that no device currently has installed. Only currently-released updates are excluded — everything else (obsolete, ready, …) is eligible.'
          size={12}
          color='rgba(255,255,255,0.6)'
        />

        <Flex row style={{ gap: 12, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
          <Flex as>
            <Text value='Window (days)' size={11} color='rgba(255,255,255,0.5)' />
            <input
              type='number'
              min={1}
              max={365}
              value={olderThanDays}
              disabled={calculating || deleting}
              onChange={(e) => setOlderThanDays(Math.max(1, parseInt(e.target.value) || 30))}
              style={{
                width: 80,
                padding: '6px 10px',
                borderRadius: 4,
                border: '1px solid rgba(255,255,255,0.2)',
                background: 'rgba(20,26,37,1)',
                color: Colors.text,
                fontSize: 14
              }}
            />
          </Flex>

          {result && (
            <>
              <Flex as>
                <Text value='Candidates' size={11} color='rgba(255,255,255,0.5)' />
                <Text value={String(result.count)} bold size={20} />
              </Flex>

              <Flex as>
                <Text value='Space to free' size={11} color='rgba(255,255,255,0.5)' />
                <Text value={fmtBytes(result.totalBytes)} bold size={20} />
              </Flex>
            </>
          )}
        </Flex>

        <Flex row style={{ marginTop: 10, gap: 10 }}>
          {calculating
            ? <Spinner />
            : (
              <Button
                icon='calculator'
                label={result ? 'Recalculate' : 'Calculate candidates'}
                onClick={() => handleCalculate(olderThanDays)}
                disabled={deleting}
              />
              )}

          {canShowDelete && (
            deleting
              ? <Spinner />
              : (
                <Button
                  icon='trash'
                  label={result.count
                    ? `Delete ${result.count} old update(s)`
                    : 'Nothing to delete'}
                  disabled={!result.count}
                  onClick={handleCleanup}
                />
                )
          )}
        </Flex>

        {result && result.count > 0 && (
          <div style={{ width: '100%', marginTop: 16 }}>
            <DataTable
              value={result.candidates}
              size='small'
              paginator={result.candidates.length > 10}
              rows={10}
              sortField='createdAt'
              sortOrder={1}
              style={{ width: '100%' }}
            >
              <Column field='updateId' header='Update ID' sortable filter
                body={(row) => (
                  <span
                    onClick={(e) => { e.stopPropagation(); handleOpenCandidate(row) }}
                    title={opening === row._id ? 'Loading…' : 'Open update details'}
                    style={{
                      fontFamily: 'ui-monospace, Menlo, monospace',
                      fontSize: 12,
                      wordBreak: 'break-all',
                      cursor: 'pointer',
                      color: Colors.primary,
                      textDecoration: 'underline dotted',
                      opacity: opening === row._id ? 0.5 : 1
                    }}
                  >
                    {row.updateId || '—'}
                  </span>
                )}
              />
              <Column field='createdAt' header='Created' sortable style={{ width: 170 }}
                body={(row) => (
                  <span style={{ fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>
                    {row.createdAt ? moment(row.createdAt).format('YYYY-MM-DD HH:mm:ss') : '—'}
                  </span>
                )}
              />
              <Column field='version' header='Version' sortable filter style={{ width: 100 }} />
              <Column field='releaseChannel' header='Channel' sortable filter style={{ width: 130 }} />
              <Column field='status' header='Status' sortable filter style={{ width: 110 }} />
              <Column field='sizeBytes' header='Size' sortable style={{ width: 100 }}
                body={(row) => (row.sizeBytes == null ? '—' : fmtBytes(row.sizeBytes))}
              />
            </DataTable>
          </div>
        )}

        {result && result.count === 0 && (
          <Text
            value={`No non-released updates older than ${result.computedForDays} day${result.computedForDays === 1 ? '' : 's'} are safe to delete right now.`}
            size={12}
            color='rgba(255,255,255,0.5)'
            style={{ marginTop: 10 }}
          />
        )}
      </Flex>
    </div>
  )
}

export const ReleaseManager = ({ app }) => {
  const { data: uploads, isSuccess } = useCQuery(['uploads', app._id])
  const [update, setUpdate] = useState(null)
  const [releasing, setRelasing] = useState(false)

  if (!isSuccess) return <Spinner />

  if (!uploads.length) {
    return (
      <Card {...cardProps}>
        <UpdateInstructions app={app} />
      </Card>
    )
  }

  return (
    <Card {...cardProps}>
      <TabView style={{ width: '100%', marginTop: 10 }} renderActiveOnly={false}>
        <TabPanel header='All Updates'>
          <DataTable
            style={{ marginTop: 10, width: '100%' }}
            value={uploads} paginator rows={10} emptyMessage='No app versions yet'
          >
            <Column field='updateId' header='Update ID' filter sortable
              body={(row) => (
                <span
                  onClick={(e) => { e.stopPropagation(); setUpdate(row) }}
                  title='Open update details'
                  style={{
                    fontFamily: 'ui-monospace, Menlo, monospace',
                    fontSize: 12,
                    wordBreak: 'break-all',
                    cursor: 'pointer',
                    color: Colors.primary,
                    textDecoration: 'underline dotted'
                  }}
                >{row.updateId || '—'}</span>
              )}
            />
            <Column field='createdAt' header='Created' sortable body={({ createdAt }) => moment(createdAt).format('YYYY-MM-DD HH:mm:ss')} />
            <Column field='releaseChannel' header='Channel' filter sortable />
            <Column field='version' header='Version' filter sortable />
            <Column field='status' header='Status' filter sortable
              body={({ status }) => <StatusPill status={status} />}
            />
          </DataTable>
        </TabPanel>
        <TabPanel header='Old Updates Cleanup'>
          <OldUpdatesCleanupSection project={app._id} onOpenUpload={setUpdate} />
        </TabPanel>
      </TabView>

      <Release update={update} releaseState={[releasing, setRelasing]} onHide={() => setUpdate(null)} />
    </Card>
  )
}

const cardProps = {
  title: 'RELEASE MANAGER',
  collapsable: true,
  collapsed: false,
  fadeIn: true,
  style: { padding: 20, width: '100%', maxWidth: 900, marginTop: 20 }
}
