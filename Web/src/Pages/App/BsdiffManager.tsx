import { useMemo, useState } from 'react'
import moment from 'moment'
import { Column } from 'primereact/column'
import { DataTable } from 'primereact/datatable'
import { InputSwitch } from 'primereact/inputswitch'

import { Button, Card, Colors, Flex, Spinner, Text } from '../../Components'
import { FC, invalidateQuery, useCQuery } from '../../Services'
import type { AppRecord, ListResult, PatchJobRecord, PatchRecord, ServiceOutcome } from '../../types'
import { listFromResult } from '../../types'

const fmtBytes = (n?: number) => {
  if (!n) return '0 B'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}

const fmtMs = (ms?: number) => {
  if (!ms && ms !== 0) return '—'
  if (ms < 1000) return `${ms} ms`
  return `${(ms / 1000).toFixed(2)} s`
}

const fmtDate = (d?: string | Date) => (d ? moment(d).format('YYYY-MM-DD HH:mm:ss') : '—')

const JOB_STATUS_COLORS = {
  queued: '#9e9e9e',
  running: '#42a5f5',
  success: '#4caf50',
  failed: '#ef5350',
}

const JOB_TYPE_COLORS = {
  generate: '#4dabf7',
  validate: '#9775fa',
  delete: '#ffa94d',
  purge: '#ff6b6b',
}

const Pill = ({ value, color }: { value?: string | number; color?: string }) => (
  <span
    style={{
      padding: '2px 8px',
      borderRadius: 4,
      backgroundColor: color || '#666',
      color: '#fff',
      fontSize: 11,
      fontWeight: 600,
    }}>
    {value}
  </span>
)

export const BsdiffManager = ({ app }: { app: AppRecord }) => {
  const project = app?._id
  const [saving, setSaving] = useState(false)
  const [purging, setPurging] = useState(false)

  const { data: patches, isSuccess: patchesReady } = useCQuery<ListResult<PatchRecord>>(['patches', project])
  const { data: jobs, isSuccess: jobsReady } = useCQuery<ListResult<PatchJobRecord>>(['patchJobs', project])

  const stats = useMemo(() => {
    const list = listFromResult(patches)
    const own = list.filter((p) => p.project === project)
    const totalSize = own.reduce((acc, p) => acc + (p.size || 0), 0)
    const totalServed = own.reduce((acc, p) => acc + (p.servedCount || 0), 0)
    const byStatus = own.reduce<Record<string, number>>((acc, p) => {
      const status = p.status || 'unknown'
      acc[status] = (acc[status] || 0) + 1
      return acc
    }, {})
    return { count: own.length, totalSize, totalServed, byStatus }
  }, [patches, project])

  const handleToggle = async (value: boolean) => {
    setSaving(true)
    try {
      await FC.client.service('apps').patch(project, { bsdiffEnabled: value })
      invalidateQuery('app')
      window.toast?.show({ severity: 'info', summary: `bsdiff ${value ? 'enabled' : 'disabled'}` })
    } catch (e) {
      window.toast?.show({ severity: 'error', summary: 'Toggle failed', detail: e.message })
    }
    setSaving(false)
  }

  const handlePurge = async () => {
    if (!window.confirm('Delete ALL patches for this app? This cannot be undone.')) return
    setPurging(true)
    try {
      const res = (await FC.client.service('patches').update('purgeAll', { project })) as ServiceOutcome
      invalidateQuery(['patches', 'patchJobs', 'diskUsage'])
      window.toast?.show({ severity: 'info', summary: `Purged ${res?.removed || 0} patches` })
    } catch (e) {
      window.toast?.show({ severity: 'error', summary: 'Purge failed', detail: e.message })
    }
    setPurging(false)
  }

  const projectJobs = useMemo(() => {
    const list = listFromResult(jobs)
    return list.filter((j) => !project || j.project === project || j.project === null)
  }, [jobs, project])

  return (
    <Card
      title="BSDIFF MANAGEMENT"
      collapsable
      collapsed
      fadeIn
      style={{ padding: 20, width: '100%', maxWidth: 900, marginTop: 40 }}>
      <Flex fw as style={{ padding: 10 }}>
        <Flex row fw style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <Flex row style={{ alignItems: 'center', gap: 10 }}>
            <Text value="Enable bsdiff patches:" bold />
            {saving ? (
              <Spinner />
            ) : (
              <InputSwitch checked={!!app?.bsdiffEnabled} onChange={(e) => handleToggle(e.value)} />
            )}
          </Flex>
          <Text
            value={
              app?.bsdiffEnabled
                ? 'Active — clients will receive bsdiff patches when available'
                : 'Disabled — full bundles only'
            }
            size={11}
            color={Colors.text}
          />
        </Flex>

        <Flex row fw style={{ marginTop: 16, gap: 24, flexWrap: 'wrap' }}>
          <Flex as>
            <Text value="Total patches" size={11} color={Colors.text} />
            <Text value={String(stats.count)} bold size={18} />
          </Flex>
          <Flex as>
            <Text value="Total size" size={11} color={Colors.text} />
            <Text value={fmtBytes(stats.totalSize)} bold size={18} />
          </Flex>
          <Flex as>
            <Text value="Served to clients" size={11} color={Colors.text} />
            <Text value={String(stats.totalServed)} bold size={18} />
          </Flex>
          {Object.entries(stats.byStatus).map(([status, n]) => (
            <Flex as key={status}>
              <Text value={status} size={11} color={Colors.text} />
              <Text value={String(n)} bold size={18} />
            </Flex>
          ))}
        </Flex>

        <Flex row fw style={{ marginTop: 16 }}>
          {purging ? <Spinner /> : <Button icon="trash" label="Purge all patches for this app" onClick={handlePurge} />}
        </Flex>

        <Text value="Job History" bold size={14} style={{ marginTop: 24 }} />
        {!jobsReady && <Spinner />}
        {jobsReady && (
          <DataTable
            value={projectJobs}
            size="small"
            paginator
            rows={15}
            style={{ width: '100%', marginTop: 8 }}
            emptyMessage="No jobs yet">
            <Column field="startedAt" header="Started" body={(r) => fmtDate(r.startedAt)} />
            <Column field="type" header="Type" body={(r) => <Pill value={r.type} color={JOB_TYPE_COLORS[r.type]} />} />
            <Column
              field="status"
              header="Status"
              body={(r) => <Pill value={r.status} color={JOB_STATUS_COLORS[r.status]} />}
            />
            <Column field="platform" header="Platform" />
            <Column
              header="From → To"
              body={(r) => (
                <Text value={`${(r.fromUpdateId || '').slice(0, 8)} → ${(r.toUpdateId || '').slice(0, 8)}`} size={11} />
              )}
            />
            <Column field="durationMs" header="Duration" body={(r) => fmtMs(r.durationMs)} />
            <Column
              field="error"
              header="Reason / Error"
              body={(r) => (
                <Text value={r.error || r.reason || ''} size={11} color={r.error ? '#ff6b6b' : Colors.text} />
              )}
            />
          </DataTable>
        )}
      </Flex>
    </Card>
  )
}
