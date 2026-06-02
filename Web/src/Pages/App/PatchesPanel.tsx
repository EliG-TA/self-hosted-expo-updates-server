import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import moment from 'moment'
import { Column } from 'primereact/column'
import { DataTable } from 'primereact/datatable'
import { Dialog } from 'primereact/dialog'
import { InputText } from 'primereact/inputtext'

import {
  Button,
  Colors,
  ConfirmDialog,
  DateRangeFilter,
  Flex,
  InlineMultiToggle,
  StatusPill,
  Text,
} from '../../Components'
import { FC, invalidateQuery, useCQuery, useLazyTable } from '../../Services'
import type { AppRecord, ListResult, PatchJobRecord, UploadRecord } from '../../types'
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
const EVENT_LABELS: Record<string, string> = {
  created: 'created',
  'status-changed': 'changed',
  removed: 'removed',
}
const STATUS_OPTIONS = ['pending', 'generating', 'validating', 'ready', 'failed', 'not-beneficial'].map((s) => ({
  label: s,
  value: s,
}))
const PLATFORM_OPTIONS = ['ios', 'android'].map((s) => ({ label: s, value: s }))

const STATUS_OPTIONS_WITH_COLOR = STATUS_OPTIONS.map((o) => ({ ...o, color: PATCH_STATUS_COLORS[o.value] }))

const stackCell = {
  display: 'flex',
  flexDirection: 'column' as const,
  alignItems: 'flex-start' as const,
  gap: 2,
}

// Familiar clickable-updateId look (matches UpdateLink).
const linkText = {
  fontFamily: 'ui-monospace, Menlo, monospace',
  fontSize: 12,
  wordBreak: 'break-all' as const,
  color: Colors.primary,
  textDecoration: 'underline dotted',
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

const DetailRow = ({ label, value }: { label: string; value: string }) => (
  <Flex row style={{ justifyContent: 'space-between', gap: 12, width: '100%' }}>
    <Text value={label} size={11} color="rgba(255,255,255,0.5)" />
    <Text value={value} size={12} />
  </Flex>
)

// Detail window for ONE from→to pair: shows both platforms + combined history,
// and is where a patch is DELETED (the tables have no delete button). Platforms
// are read off the embedded pair row when present (pairs table), else fetched by
// pairId (e.g. opened from Update details). updateId links navigate to the
// update; the table header that opens this card does not.
const ALL_PLATFORMS: Array<'ios' | 'android'> = ['ios', 'android']

// Renders a per-platform stack inside one table cell — the entire "ios row +
// android row + (optional) total row" lives in a single cell of a single
// pair-level row. Keeps the table to one row per pair so the from→to / size /
// ratio / served / updated values stay column-aligned across pairs.
export const PlatformCell = ({
  pair,
  render,
  total,
  showLabels = true,
}: {
  pair: Record<string, unknown>
  render: (p: Record<string, unknown> | undefined, platform: 'ios' | 'android') => ReactNode
  total?: ReactNode
  showLabels?: boolean
}) => {
  const platforms = (pair.platforms as Array<Record<string, unknown>>) || []
  const byName = new Map(platforms.map((p) => [String(p.platform), p]))
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
      {ALL_PLATFORMS.map((name) => (
        <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 6, minHeight: 18 }}>
          {showLabels && <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', minWidth: 48 }}>{name}</span>}
          <span style={{ fontSize: 12 }}>{render(byName.get(name), name)}</span>
        </div>
      ))}
      {total != null && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            paddingTop: 2,
            marginTop: 2,
            borderTop: '1px solid rgba(255,255,255,0.08)',
          }}>
          {showLabels && (
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.6)', minWidth: 48, fontWeight: 600 }}>total</span>
          )}
          <span style={{ fontSize: 12, fontWeight: 600 }}>{total}</span>
        </div>
      )}
    </div>
  )
}

// gitCommit on UploadRecord is the full `git log --oneline -n 1` output —
// short sha + subject. Split so the hash gets monospace styling and the
// subject reads as prose. Matches the rendering in PublishedUpdates.
const splitCommit = (raw?: string) => {
  if (!raw) return { hash: null as string | null, subject: null as string | null }
  const idx = raw.indexOf(' ')
  if (idx === -1) return { hash: raw, subject: null }
  return { hash: raw.slice(0, idx), subject: raw.slice(idx + 1) }
}

const UpdateSideCard = ({ label, upload, updateId }: { label: string; upload?: UploadRecord; updateId?: string }) => {
  const commit = splitCommit(upload?.gitCommit)
  return (
    <div
      style={{
        flex: 1,
        minWidth: 240,
        padding: 12,
        borderRadius: 6,
        border: '1px solid rgba(255,255,255,0.12)',
        background: 'rgba(255,255,255,0.03)',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}>
      <Flex row style={{ justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <Text value={label} size={11} color="rgba(255,255,255,0.5)" bold />
        {upload?.status && <StatusPill status={upload.status} />}
      </Flex>
      <UpdateLink updateId={updateId} />
      {upload?.createdAt && <DetailRow label="Created" value={fmtDate(upload.createdAt as string)} />}
      {upload?.releasedAt && <DetailRow label="Released" value={fmtDate(upload.releasedAt as string)} />}
      {upload?.size != null && <DetailRow label="Bundle" value={fmtBytes(upload.size)} />}
      {commit.hash && (
        <Flex as style={{ marginTop: 4, gap: 2 }}>
          <Text value="Commit" size={11} color="rgba(255,255,255,0.5)" />
          <span
            style={{
              fontFamily: 'ui-monospace, Menlo, monospace',
              fontSize: 12,
              color: 'rgba(255,255,255,0.8)',
            }}>
            {commit.hash}
          </span>
          {commit.subject && (
            <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)' }} title={commit.subject}>
              {commit.subject}
            </span>
          )}
          {upload?.gitBranch && (
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)' }}>{upload.gitBranch}</span>
          )}
        </Flex>
      )}
    </div>
  )
}

export const PatchPairDetail = ({ pair, onClose }: { pair: Record<string, unknown>; onClose: () => void }) => {
  const fromUpdateId = pair.fromUpdateId as string | undefined
  const toUpdateId = pair.toUpdateId as string | undefined
  const fromUploadId = pair.fromUploadId as string | undefined
  const toUploadId = pair.toUploadId as string | undefined
  const project = pair.project as string | undefined
  const version = pair.version as string | undefined
  const releaseChannel = pair.releaseChannel as string | undefined
  const embedded = pair.platforms as Array<Record<string, unknown>> | undefined
  // Reuse the project-wide uploads query — already cached by Patches tab,
  // AppDisplay, and ReleaseManager, so this is a free lookup in practice.
  const { data: uploadsResult } = useCQuery<ListResult<UploadRecord>>(['uploads', project], { enabled: !!project })
  const uploadsList = listFromResult(uploadsResult)
  const byId = new Map(uploadsList.map((u) => [String(u._id), u]))
  const fromUpload = fromUploadId ? byId.get(String(fromUploadId)) : undefined
  const toUpload = toUploadId ? byId.get(String(toUploadId)) : undefined
  // Always run the per-pair query — `embedded` is a snapshot from the row
  // we opened the dialog with and won't refresh after an enqueue/delete.
  // The live query becomes the source of truth as soon as it resolves,
  // with the embedded array used only for the first paint.
  const { data: patchesData } = useCQuery<{ data: Array<Record<string, unknown>>; total: number }>(
    ['patchesPage', { pairId: pair._id, limit: 10 }],
    { enabled: !!pair._id },
  )
  const platforms = patchesData?.data || embedded || []
  // Index platforms by name so we can render BOTH ios+android slots and
  // surface a "Queue creation" CTA when the pair is missing one.
  const platformByName = new Map<string, Record<string, unknown>>()
  for (const p of platforms) platformByName.set(String(p.platform), p)
  const { data: historyData } = useCQuery<{ data: PatchJobRecord[]; total: number }>(
    ['patchJobsPage', { pairId: pair._id, limit: 500, sortField: 'at', sortOrder: -1 }],
    { enabled: !!pair._id },
  )
  const history = historyData?.data || []
  const [pendingDelete, setPendingDelete] = useState<Record<string, unknown> | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [enqueuing, setEnqueuing] = useState<string | null>(null) // platform name in flight

  const confirmDelete = async () => {
    if (!pendingDelete?._id) return
    setDeleting(true)
    try {
      await FC.client.service('patches').remove(pendingDelete._id)
      // patchesPage (the dialog's live source) and patchPairsPage (the
      // background table) both refetch — the deleted platform block flips
      // back to its "Queue creation" CTA in place.
      invalidateQuery(['patches', 'patchesPage', 'patchPairsPage', 'patchJobsPage', 'diskUsage'])
      setPendingDelete(null)
    } catch (e) {
      window.toast?.show({ severity: 'error', summary: 'Delete failed', detail: (e as Error).message })
    }
    setDeleting(false)
  }

  const enqueueMissing = async (platform: string) => {
    if (!fromUploadId || !toUploadId) {
      window.toast?.show({
        severity: 'error',
        summary: 'Cannot enqueue',
        detail: 'Pair is missing upload references — open it from the Patches tab.',
      })
      return
    }
    setEnqueuing(platform)
    try {
      // Server enqueues for every common platform that's missing/failed and
      // skips already-good ones, so passing just upload ids is enough.
      await FC.client.service('patches').update('enqueue', { fromUploadId, toUploadId })
      invalidateQuery(['patches', 'patchesPage', 'patchPairsPage', 'patchJobsPage', 'diskUsage'])
      window.toast?.show({ severity: 'info', summary: 'Queued', detail: `Patch generation queued for ${platform}` })
    } catch (e) {
      window.toast?.show({ severity: 'error', summary: 'Enqueue failed', detail: (e as Error).message })
    }
    setEnqueuing(null)
  }

  return (
    <Dialog visible header="Patch detail" style={{ width: 'min(860px, 94vw)' }} onHide={onClose} dismissableMask>
      <Flex as fw style={{ gap: 16, alignItems: 'stretch' }}>
        <Flex row style={{ gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          {version && (
            <Flex as>
              <Text value="Runtime" size={11} color="rgba(255,255,255,0.5)" />
              <Text value={version} size={13} bold />
            </Flex>
          )}
          {releaseChannel && (
            <Flex as>
              <Text value="Channel" size={11} color="rgba(255,255,255,0.5)" />
              <Text value={releaseChannel} size={13} bold />
            </Flex>
          )}
        </Flex>

        <Flex row style={{ gap: 12, flexWrap: 'wrap', alignItems: 'stretch' }}>
          <UpdateSideCard label="FROM" upload={fromUpload} updateId={fromUpdateId} />
          <Flex row style={{ alignItems: 'center', padding: '0 4px' }}>
            <span style={{ color: Colors.text, fontSize: 20 }}>→</span>
          </Flex>
          <UpdateSideCard label="TO" upload={toUpload} updateId={toUpdateId} />
        </Flex>

        <Flex row style={{ gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          {ALL_PLATFORMS.map((platform) => {
            const p = platformByName.get(platform)
            const blockStyle = {
              padding: 14,
              minWidth: 250,
              flex: 1,
              borderRadius: 6,
              border: '1px solid rgba(255,255,255,0.12)',
              background: 'rgba(255,255,255,0.03)',
            }
            if (!p) {
              return (
                <div key={platform} style={blockStyle}>
                  <Flex row style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <Text value={platform} bold size={14} />
                    <Text value="not generated" size={11} color="rgba(255,255,255,0.5)" />
                  </Flex>
                  <Text
                    value="No patch exists for this platform yet."
                    size={12}
                    color="rgba(255,255,255,0.6)"
                    style={{ marginBottom: 12 }}
                  />
                  <Button
                    icon={enqueuing === platform ? 'spinner' : 'plus'}
                    label="Queue creation"
                    disabled={enqueuing === platform || !fromUploadId || !toUploadId}
                    onClick={() => enqueueMissing(platform)}
                  />
                </div>
              )
            }
            return (
              <div key={String(p._id)} style={blockStyle}>
                <Flex row style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <Text value={String(p.platform || '—')} bold size={14} />
                  <Flex row style={{ alignItems: 'center', gap: 8 }}>
                    <Pill value={(p.status as string) || '—'} color={PATCH_STATUS_COLORS[(p.status as string) || '']} />
                    <Button icon="trash" danger onClick={() => setPendingDelete(p)} style={{ padding: 4 }} />
                  </Flex>
                </Flex>
                <DetailRow label="Patch size" value={fmtBytes(p.size as number)} />
                <DetailRow label="Target bundle" value={fmtBytes(p.targetBundleSize as number)} />
                <DetailRow
                  label="Ratio"
                  value={p.compressionRatio ? `${((p.compressionRatio as number) * 100).toFixed(1)}%` : '—'}
                />
                <DetailRow label="Served" value={String(p.servedCount || 0)} />
                <DetailRow label="Attempts" value={p.attempts != null ? String(p.attempts) : '—'} />
                <DetailRow label="Created" value={fmtDate(p.createdAt as string)} />
                <DetailRow label="Completed" value={fmtDate(p.completedAt as string)} />
                <DetailRow label="Source" value={String(p.source || 'auto')} />
                {!!p.error && (
                  <Text
                    value={String(p.error)}
                    size={11}
                    color="#ff6b6b"
                    style={{ marginTop: 6, wordBreak: 'break-word' }}
                  />
                )}
              </div>
            )
          })}
        </Flex>

        <Text value="History" bold size={13} style={{ marginTop: 4 }} />
        <DataTable
          value={history}
          size="small"
          paginator={history.length > 10}
          rows={10}
          emptyMessage="No history"
          style={{ width: '100%' }}>
          <Column
            field="at"
            header="When"
            body={(r: PatchJobRecord) => (
              <span style={{ fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>{fmtDate(r.at)}</span>
            )}
          />
          <Column field="platform" header="Platform" />
          <Column
            header="Event"
            body={(r: PatchJobRecord) => (
              <Pill value={EVENT_LABELS[r.event || ''] || r.event} color={EVENT_COLORS[r.event || '']} />
            )}
          />
          <Column
            header="Status"
            body={(r: PatchJobRecord) =>
              r.event === 'status-changed' ? (
                <div style={stackCell}>
                  <Pill value={r.previousStatus || '—'} color={PATCH_STATUS_COLORS[r.previousStatus || '']} />
                  <span style={{ color: Colors.text }}>→</span>
                  <Pill value={r.status || '—'} color={PATCH_STATUS_COLORS[r.status || '']} />
                </div>
              ) : (
                <Pill
                  value={r.status || r.previousStatus || '—'}
                  color={PATCH_STATUS_COLORS[r.status || r.previousStatus || '']}
                />
              )
            }
          />
          <Column field="durationMs" header="Duration" body={(r: PatchJobRecord) => fmtMs(r.durationMs)} />
          <Column
            header="Reason / Error"
            body={(r: PatchJobRecord) => (
              <Text value={r.error || r.reason || ''} size={11} color={r.error ? '#ff6b6b' : Colors.text} />
            )}
          />
        </DataTable>
      </Flex>

      <ConfirmDialog
        visible={!!pendingDelete}
        title="Delete patch"
        confirmIcon="trash"
        confirmLabel="Delete"
        confirmDanger
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
        loading={deleting}>
        {pendingDelete && (
          <Text
            value={`Delete the ${pendingDelete.platform} patch for this pair? The patch file and DB record are removed; it regenerates on demand if still needed.`}
          />
        )}
      </ConfirmDialog>
    </Dialog>
  )
}

// All patches for the app: ONE ROW PER PLATFORM (ios/android separate), but the
// first column (From → To) is merged across a pair's platform rows via
// rowGroupMode="rowspan". The merged From→To cell is clickable → PatchPairDetail.
// All filters live in column headers (filterDisplay="menu"). Paginated by PAIR.
export const PatchesPanel = ({ app, enabled = true }: { app: AppRecord; enabled?: boolean }) => {
  const project = app?._id
  const pt = useLazyTable<Record<string, unknown>>(
    'patchPairsPage',
    { project },
    {
      enabled,
      defaultSortField: 'latestCreatedAt',
      defaultSortOrder: -1,
      rows: 25,
      enumFields: ['status', 'platform'],
      searchField: 'fromUpdateId',
      dateFields: ['createdAt'],
    },
  )
  const [selectedPair, setSelectedPair] = useState<Record<string, unknown> | null>(null)

  // Bounds for the date-range picker. Server-paginated, so this only sees
  // the currently loaded page — good enough as a soft hint, and the user
  // can still pick any date manually if they're chasing older patches that
  // haven't paged in yet.
  const [createdMin, createdMax] = useMemo(() => {
    let lo = Infinity
    let hi = -Infinity
    for (const pair of pt.value) {
      const t = pair.latestCreatedAt ? new Date(pair.latestCreatedAt as string).getTime() : NaN
      if (!isFinite(t)) continue
      if (t < lo) lo = t
      if (t > hi) hi = t
    }
    return isFinite(lo) ? [new Date(lo), new Date(hi)] : [undefined, undefined]
  }, [pt.value])

  // Pairs come straight through — one row per from-to pair. Per-platform
  // breakdowns live INSIDE each cell via PlatformCell, so the table layout
  // stays 1 row = 1 pair regardless of how many platforms a pair has.
  const rows = pt.value

  return (
    <div style={{ width: '100%' }}>
      <DataTable
        value={rows}
        lazy
        paginator
        first={pt.first}
        rows={pt.rows}
        totalRecords={pt.totalRecords}
        onPage={pt.onPage}
        onSort={pt.onSort}
        sortField={pt.sortField}
        sortOrder={pt.sortOrder}
        filterDisplay="menu"
        filters={pt.filters}
        onFilter={pt.onFilter}
        loading={pt.loading}
        paginatorTemplate="FirstPageLink PrevPageLink CurrentPageReport NextPageLink LastPageLink"
        currentPageReportTemplate="{first}–{last} of {totalRecords} pairs"
        size="small"
        style={{ width: '100%', marginTop: 8 }}
        emptyMessage="No patches">
        <Column
          header="From → To"
          field="fromUpdateId"
          sortable
          filter
          filterElement={(o) => (
            <InputText
              value={(o.value as string) || ''}
              onChange={(e) => o.filterApplyCallback(e.target.value)}
              placeholder="updateId…"
              style={{ width: 240, fontSize: 13 }}
            />
          )}
          body={(pair: Record<string, unknown>) => (
            <div
              onClick={() => setSelectedPair(pair)}
              title="Open patch details"
              style={{ ...stackCell, cursor: 'pointer' }}>
              <span style={linkText}>{String(pair.fromUpdateId || '—')}</span>
              <span style={{ color: Colors.text }}>→</span>
              <span style={linkText}>{String(pair.toUpdateId || '—')}</span>
            </div>
          )}
        />
        <Column
          header="Platform"
          field="platform"
          filter
          showFilterMatchModes={false}
          filterElement={(o) => (
            <InlineMultiToggle
              value={o.value as string[] | undefined}
              options={PLATFORM_OPTIONS}
              onChange={(v) => o.filterApplyCallback(v)}
            />
          )}
          body={(pair: Record<string, unknown>) => (
            <PlatformCell
              pair={pair}
              showLabels={false}
              render={(p, platform) =>
                p ? (
                  <span>{String(p.platform)}</span>
                ) : (
                  <span style={{ color: 'rgba(255,255,255,0.4)', fontStyle: 'italic' }}>{platform}</span>
                )
              }
            />
          )}
        />
        <Column
          header="Status"
          field="status"
          filter
          showFilterMatchModes={false}
          filterElement={(o) => (
            <InlineMultiToggle
              value={o.value as string[] | undefined}
              options={STATUS_OPTIONS_WITH_COLOR}
              onChange={(v) => o.filterApplyCallback(v)}
            />
          )}
          body={(pair: Record<string, unknown>) => (
            <PlatformCell
              pair={pair}
              showLabels={false}
              render={(p) =>
                p ? (
                  <Pill value={(p.status as string) || '—'} color={PATCH_STATUS_COLORS[(p.status as string) || '']} />
                ) : (
                  <span style={{ color: 'rgba(255,255,255,0.4)', fontStyle: 'italic', fontSize: 11 }}>
                    not generated
                  </span>
                )
              }
            />
          )}
        />
        <Column
          header="Size"
          field="totalSize"
          sortable
          body={(pair: Record<string, unknown>) => (
            <PlatformCell
              pair={pair}
              render={(p) => (p?.size != null ? fmtBytes(p.size as number) : '—')}
              total={fmtBytes((pair.totalSize as number) || 0)}
            />
          )}
        />
        <Column
          header="Ratio"
          field="avgRatio"
          sortable
          body={(pair: Record<string, unknown>) => (
            <PlatformCell
              pair={pair}
              render={(p) => (p?.compressionRatio ? `${((p.compressionRatio as number) * 100).toFixed(1)}%` : '—')}
              total={pair.avgRatio ? `${((pair.avgRatio as number) * 100).toFixed(1)}%` : '—'}
            />
          )}
        />
        <Column
          header="Served"
          field="totalServed"
          sortable
          body={(pair: Record<string, unknown>) => (
            <PlatformCell
              pair={pair}
              render={(p) => String(p?.servedCount || 0)}
              total={String(pair.totalServed || 0)}
            />
          )}
        />
        <Column
          header="Updated"
          field="latestCreatedAt"
          filterField="createdAt"
          sortable
          filter
          showFilterMatchModes={false}
          filterElement={(o) => (
            <DateRangeFilter
              value={o.value}
              onChange={(v) => o.filterCallback(v)}
              minDate={createdMin}
              maxDate={createdMax}
            />
          )}
          body={(pair: Record<string, unknown>) => (
            <PlatformCell
              pair={pair}
              render={(p) => (
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {fmtDate((p?.completedAt || p?.createdAt) as string)}
                </span>
              )}
              total={
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtDate(pair.latestCreatedAt as string)}</span>
              }
            />
          )}
        />
      </DataTable>

      {selectedPair && <PatchPairDetail pair={selectedPair} onClose={() => setSelectedPair(null)} />}
    </div>
  )
}
