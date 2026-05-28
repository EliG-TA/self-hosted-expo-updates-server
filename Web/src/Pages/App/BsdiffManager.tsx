import { useMemo, useState } from 'react'
import moment from 'moment'
import { Column } from 'primereact/column'
import { DataTable } from 'primereact/datatable'
import { InputSwitch } from 'primereact/inputswitch'
import { TabPanel, TabView } from 'primereact/tabview'

import { Button, Card, Colors, ConfirmDialog, Flex, Spinner, Text } from '../../Components'
import { FC, invalidateQuery, useCQuery } from '../../Services'
import type { AppRecord, ListResult, PatchJobRecord, PatchRecord, ServiceOutcome } from '../../types'
import { listFromResult } from '../../types'
import { UpdateLink } from './updateDetails'

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

const PATCH_STATUS_COLORS: Record<string, string> = {
  pending: '#9e9e9e',
  generating: '#42a5f5',
  validating: '#9775fa',
  ready: '#4caf50',
  failed: '#ef5350',
  'not-beneficial': '#ffa94d',
}

const EVENT_COLORS: Record<string, string> = {
  created: '#4dabf7',
  'status-changed': '#9775fa',
  removed: '#ff6b6b',
}

// "status-changed" is too wide for the Event pill — show a short label.
const EVENT_LABELS: Record<string, string> = {
  created: 'created',
  'status-changed': 'changed',
  removed: 'removed',
}

// Stack long content vertically across 3 lines (value / → / value) instead
// of one wide line. Full text shown — never clipped.
const stackCell = {
  display: 'flex',
  flexDirection: 'column' as const,
  alignItems: 'flex-start' as const,
  gap: 2,
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

type ObsoleteCandidate = {
  _id: string
  platform?: string
  fromUpdateId?: string
  toUpdateId?: string
  size?: number
  status?: string
  servedCount?: number
  createdAt?: string | Date
  toUpload?: {
    _id?: string
    version?: string
    releaseChannel?: string
    createdAt?: string | Date
    gitCommit?: string
  } | null
}

type ObsoletePreview = {
  candidates: ObsoleteCandidate[]
  totalBytes: number
  count: number
  computedForDays: number
}

type CleanupOutcome = ServiceOutcome & {
  count?: number
  totalBytes?: number
  computedForDays?: number
  errors?: Array<{ id: unknown; error: string }>
}

export const BsdiffManager = ({ app }: { app: AppRecord }) => {
  const project = app?._id
  const [saving, setSaving] = useState(false)
  const [purging, setPurging] = useState(false)
  const [olderThanDays, setOlderThanDays] = useState<number>(7)
  const [calculating, setCalculating] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [preview, setPreview] = useState<ObsoletePreview | null>(null)
  const [confirmingCleanup, setConfirmingCleanup] = useState(false)
  const [confirmingPurge, setConfirmingPurge] = useState(false)
  // The card is collapsed by default and the Card hides (not unmounts) its
  // children, so gate the fetches on actual visibility: patches only once the
  // card is opened, jobs only once the Job History tab (index 1) is active.
  const [cardOpen, setCardOpen] = useState(false)
  const [activeTab, setActiveTab] = useState(0)

  const { data: patches, isSuccess: patchesReady } = useCQuery<ListResult<PatchRecord>>(['patches', project], {
    enabled: cardOpen,
  })
  const { data: jobs, isSuccess: jobsReady } = useCQuery<ListResult<PatchJobRecord>>(['patchJobs', project], {
    enabled: cardOpen && activeTab === 1,
  })

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

  const projectJobs = useMemo(() => {
    const list = listFromResult(jobs)
    return list.filter((j) => !project || j.project === project || j.project == null)
  }, [jobs, project])

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
    setPurging(true)
    try {
      const res = (await FC.client.service('patches').update('purgeAll', { project })) as ServiceOutcome
      invalidateQuery(['patches', 'patchJobs', 'diskUsage'])
      setPreview(null)
      window.toast?.show({ severity: 'info', summary: `Purged ${res?.removed || 0} patches` })
    } catch (e) {
      window.toast?.show({ severity: 'error', summary: 'Purge failed', detail: e.message })
    }
    setPurging(false)
    setConfirmingPurge(false)
  }

  // Phase 1: GET candidates for the chosen window. The result populates the
  // preview table and totals so the admin sees exactly what will be deleted
  // before they confirm. Mirrors ReleaseManager.cleanupOldUpdates.
  const handleCalculate = async (days: number) => {
    setCalculating(true)
    try {
      const res = (await FC.client
        .service('patches')
        .get('obsoleteCandidates', { query: { project, olderThanDays: days } })) as ObsoletePreview
      setPreview(res || { candidates: [], totalBytes: 0, count: 0, computedForDays: days })
    } catch (e) {
      window.toast?.show({ severity: 'error', summary: 'Calculate failed', detail: e.message })
    }
    setCalculating(false)
  }

  // Phase 2: re-runs the same query server-side (instead of trusting the
  // preview blindly) and deletes. Re-fetches the preview after so the table
  // shows the post-cleanup state — typically zero candidates.
  const handleConfirmCleanup = async () => {
    if (!preview?.count) return
    const days = preview.computedForDays
    setDeleting(true)
    try {
      const res = (await FC.client
        .service('patches')
        .update('cleanupObsolete', { project, olderThanDays: days })) as CleanupOutcome
      invalidateQuery(['patches', 'patchJobs', 'diskUsage'])
      const errorCount = res?.errors?.length || 0
      window.toast?.show({
        severity: errorCount ? 'warn' : 'info',
        summary: `Removed ${res?.removed || 0} obsolete patches`,
        detail: `Freed ${fmtBytes(res?.totalBytes || 0)}${errorCount ? ` · ${errorCount} error(s)` : ''}`,
      })
      await handleCalculate(days)
    } catch (e) {
      window.toast?.show({ severity: 'error', summary: 'Cleanup failed', detail: e.message })
    }
    setDeleting(false)
    setConfirmingCleanup(false)
  }

  return (
    <Card
      title="BSDIFF MANAGEMENT"
      collapsable
      collapsed
      fadeIn
      onToggle={(collapsed) => setCardOpen(!collapsed)}
      style={{ padding: 20, width: '100%', maxWidth: 900, marginTop: 40 }}>
      <TabView activeIndex={activeTab} onTabChange={(e) => setActiveTab(e.index)}>
        <TabPanel header="Management">
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

            {/* Cleanup obsolete patches — two-phase like ReleaseManager.cleanupOldUpdates */}
            <Text value="Cleanup obsolete patches" bold size={14} style={{ marginTop: 24 }} />
            <Text
              value="Delete patches whose target update has been set to 'obsolete' and is older than the window below. A patch from an obsolete bundle to a current release is NOT deleted — clients stuck on old bundles still benefit from it."
              size={12}
              color="rgba(255,255,255,0.6)"
            />

            <Flex row style={{ gap: 12, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
              <Flex as>
                <Text value="Window (days)" size={11} color="rgba(255,255,255,0.5)" />
                <input
                  type="number"
                  min={0}
                  max={365}
                  value={olderThanDays}
                  disabled={calculating || deleting}
                  onChange={(e) => setOlderThanDays(Math.max(0, parseInt(e.target.value) || 0))}
                  style={{
                    width: 80,
                    padding: '6px 10px',
                    borderRadius: 4,
                    border: '1px solid rgba(255,255,255,0.2)',
                    background: 'rgba(20,26,37,1)',
                    color: Colors.text,
                    fontSize: 14,
                  }}
                />
              </Flex>
              {preview && (
                <>
                  <Flex as>
                    <Text value="Candidates" size={11} color="rgba(255,255,255,0.5)" />
                    <Text value={String(preview.count)} bold size={20} />
                  </Flex>
                  <Flex as>
                    <Text value="Space to free" size={11} color="rgba(255,255,255,0.5)" />
                    <Text value={fmtBytes(preview.totalBytes)} bold size={20} />
                  </Flex>
                </>
              )}
            </Flex>

            <Flex row style={{ marginTop: 10, gap: 10, flexWrap: 'wrap' }}>
              {calculating ? (
                <Spinner />
              ) : (
                <Button
                  icon="calculator"
                  label={preview ? 'Recalculate' : 'Calculate candidates'}
                  onClick={() => handleCalculate(olderThanDays)}
                  disabled={deleting}
                />
              )}
              {preview &&
                preview.count > 0 &&
                !calculating &&
                (deleting ? (
                  <Spinner />
                ) : (
                  <Button
                    icon="trash"
                    danger
                    label={`Delete ${preview.count} patches (${fmtBytes(preview.totalBytes)})`}
                    onClick={() => setConfirmingCleanup(true)}
                  />
                ))}
              {purging ? (
                <Spinner />
              ) : (
                <Button icon="trash" danger label="Purge ALL patches" onClick={() => setConfirmingPurge(true)} />
              )}
            </Flex>

            {preview && preview.count > 0 && (
              <DataTable
                value={preview.candidates}
                size="small"
                paginator
                rows={10}
                style={{ width: '100%', marginTop: 12 }}
                emptyMessage="No candidates">
                <Column field="platform" header="Platform" />
                <Column
                  header="From → To"
                  body={(r: ObsoleteCandidate) => (
                    <div style={stackCell}>
                      <UpdateLink updateId={r.fromUpdateId} />
                      <span style={{ color: Colors.text }}>→</span>
                      <UpdateLink updateId={r.toUpdateId} />
                    </div>
                  )}
                />
                <Column
                  header="Target version"
                  body={(r: ObsoleteCandidate) => <Text value={r.toUpload?.version || '—'} size={11} />}
                />
                <Column
                  header="Channel"
                  body={(r: ObsoleteCandidate) => <Text value={r.toUpload?.releaseChannel || '—'} size={11} />}
                />
                <Column header="Target created" body={(r: ObsoleteCandidate) => fmtDate(r.toUpload?.createdAt)} />
                <Column
                  field="status"
                  header="Patch status"
                  body={(r: ObsoleteCandidate) => <Pill value={r.status} color={PATCH_STATUS_COLORS[r.status || '']} />}
                />
                <Column field="size" header="Size" body={(r: ObsoleteCandidate) => fmtBytes(r.size)} />
                <Column
                  field="servedCount"
                  header="Served"
                  body={(r: ObsoleteCandidate) => String(r.servedCount || 0)}
                />
                <Column
                  field="createdAt"
                  header="Patch created"
                  body={(r: ObsoleteCandidate) => fmtDate(r.createdAt)}
                />
              </DataTable>
            )}

            {preview && preview.count === 0 && (
              <Text
                value={`No obsolete patches older than ${preview.computedForDays} day(s) for this app.`}
                size={12}
                color={Colors.text}
                style={{ marginTop: 12 }}
              />
            )}
          </Flex>
        </TabPanel>

        <TabPanel header="Job History">
          {!jobsReady && <Spinner />}
          {jobsReady && (
            <DataTable
              value={projectJobs}
              size="small"
              paginator
              rows={15}
              style={{ width: '100%', marginTop: 8 }}
              emptyMessage="No history yet">
              <Column field="at" header="When" body={(r: PatchJobRecord) => fmtDate(r.at)} />
              <Column
                field="event"
                header="Event"
                body={(r: PatchJobRecord) => (
                  <Pill value={EVENT_LABELS[r.event || ''] || r.event} color={EVENT_COLORS[r.event || '']} />
                )}
              />
              <Column
                header="Status"
                body={(r: PatchJobRecord) => {
                  if (r.event === 'status-changed') {
                    return (
                      <div style={stackCell}>
                        <Pill value={r.previousStatus || '—'} color={PATCH_STATUS_COLORS[r.previousStatus || '']} />
                        <span style={{ color: Colors.text }}>→</span>
                        <Pill value={r.status || '—'} color={PATCH_STATUS_COLORS[r.status || '']} />
                      </div>
                    )
                  }
                  if (r.event === 'removed') {
                    return <Pill value={r.previousStatus || '—'} color={PATCH_STATUS_COLORS[r.previousStatus || '']} />
                  }
                  return <Pill value={r.status || '—'} color={PATCH_STATUS_COLORS[r.status || '']} />
                }}
              />
              <Column field="platform" header="Platform" />
              <Column
                header="From → To"
                body={(r: PatchJobRecord) => (
                  <div style={stackCell}>
                    <UpdateLink updateId={r.fromUpdateId} />
                    <span style={{ color: Colors.text }}>→</span>
                    <UpdateLink updateId={r.toUpdateId} />
                  </div>
                )}
              />
              <Column
                field="attempts"
                header="Attempts"
                body={(r: PatchJobRecord) => (r.attempts != null ? String(r.attempts) : '—')}
              />
              <Column field="durationMs" header="Duration" body={(r: PatchJobRecord) => fmtMs(r.durationMs)} />
              <Column field="size" header="Size" body={(r: PatchJobRecord) => fmtBytes(r.size)} />
              <Column
                header="Reason / Error"
                body={(r: PatchJobRecord) => (
                  <Text value={r.error || r.reason || ''} size={11} color={r.error ? '#ff6b6b' : Colors.text} />
                )}
              />
            </DataTable>
          )}
        </TabPanel>
      </TabView>

      <ConfirmDialog
        visible={confirmingCleanup}
        title="Delete obsolete patches"
        confirmIcon="trash"
        confirmLabel={preview?.count ? `Delete ${preview.count} patch(es)` : 'Delete'}
        confirmDanger
        onConfirm={handleConfirmCleanup}
        onCancel={() => setConfirmingCleanup(false)}
        loading={deleting}>
        {preview && (
          <>
            <Text
              value={`You are about to delete ${preview.count} patch(es) (${fmtBytes(preview.totalBytes)}) whose target update is obsolete and older than ${preview.computedForDays} day(s).`}
            />
            <Text
              value="Patches from an obsolete bundle to a current release are NOT affected — only those pointing at a retired target."
              style={{ marginTop: 20 }}
            />
            <Text value="This permanently removes patch files and database records." style={{ marginTop: 20 }} />
            <Text value="Are you sure?" style={{ marginTop: 20 }} />
          </>
        )}
      </ConfirmDialog>

      <ConfirmDialog
        visible={confirmingPurge}
        title="Purge all patches"
        confirmIcon="trash"
        confirmLabel={`Purge ${stats.count} patch(es)`}
        confirmDanger
        onConfirm={handlePurge}
        onCancel={() => setConfirmingPurge(false)}
        loading={purging}>
        <Text
          value={`You are about to delete ALL ${stats.count} patch(es) for this app (${fmtBytes(stats.totalSize)}), regardless of status or target.`}
        />
        <Text
          value="Clients will fall back to full bundle downloads until patches are regenerated on demand."
          style={{ marginTop: 20 }}
        />
        <Text value="This permanently removes patch files and database records." style={{ marginTop: 20 }} />
        <Text value="Are you sure?" style={{ marginTop: 20 }} />
      </ConfirmDialog>
    </Card>
  )
}
