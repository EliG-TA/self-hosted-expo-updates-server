import { useMemo, useState } from 'react'
import moment from 'moment'
import { Column } from 'primereact/column'
import { DataTable } from 'primereact/datatable'
import { Dialog } from 'primereact/dialog'
import { InputText } from 'primereact/inputtext'

import { Button, Colors, ConfirmDialog, Flex, InlineMultiToggle, Text } from '../../Components'
import { FC, invalidateQuery, useCQuery, useLazyTable } from '../../Services'
import type { AppRecord, PatchJobRecord } from '../../types'
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
export const PatchPairDetail = ({ pair, onClose }: { pair: Record<string, unknown>; onClose: () => void }) => {
  const fromUpdateId = pair.fromUpdateId as string | undefined
  const toUpdateId = pair.toUpdateId as string | undefined
  const embedded = pair.platforms as Array<Record<string, unknown>> | undefined
  const { data: patchesData } = useCQuery<{ data: Array<Record<string, unknown>>; total: number }>(
    ['patchesPage', { pairId: pair._id, limit: 10 }],
    { enabled: !embedded && !!pair._id },
  )
  const platforms = embedded || patchesData?.data || []
  const { data: historyData } = useCQuery<{ data: PatchJobRecord[]; total: number }>(
    ['patchJobsPage', { pairId: pair._id, limit: 500, sortField: 'at', sortOrder: 1 }],
    { enabled: !!pair._id },
  )
  const history = historyData?.data || []
  const [pendingDelete, setPendingDelete] = useState<Record<string, unknown> | null>(null)
  const [deleting, setDeleting] = useState(false)

  const confirmDelete = async () => {
    if (!pendingDelete?._id) return
    setDeleting(true)
    try {
      await FC.client.service('patches').remove(pendingDelete._id)
      invalidateQuery(['patches', 'patchesPage', 'patchPairsPage', 'patchJobsPage', 'diskUsage'])
      setPendingDelete(null)
      onClose() // reopen to see fresh state; the table list refreshes via invalidate
    } catch (e) {
      window.toast?.show({ severity: 'error', summary: 'Delete failed', detail: (e as Error).message })
      setDeleting(false)
    }
  }

  return (
    <Dialog visible header="Patch detail" style={{ width: 'min(860px, 94vw)' }} onHide={onClose} dismissableMask>
      <Flex as fw style={{ gap: 16, alignItems: 'stretch' }}>
        <div style={stackCell}>
          <UpdateLink updateId={fromUpdateId} />
          <span style={{ color: Colors.text }}>→</span>
          <UpdateLink updateId={toUpdateId} />
        </div>

        <Flex row style={{ gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          {platforms.length === 0 && <Text value="No patch rows for this pair." size={12} color={Colors.text} />}
          {platforms.map((p) => (
            <div
              key={String(p._id)}
              style={{
                padding: 14,
                minWidth: 250,
                flex: 1,
                borderRadius: 6,
                border: '1px solid rgba(255,255,255,0.12)',
                background: 'rgba(255,255,255,0.03)',
              }}>
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
                <Text value={String(p.error)} size={11} color="#ff6b6b" style={{ marginTop: 6, wordBreak: 'break-word' }} />
              )}
            </div>
          ))}
        </Flex>

        <Text value="History" bold size={13} style={{ marginTop: 4 }} />
        <DataTable
          value={history}
          size="small"
          paginator={history.length > 10}
          rows={10}
          emptyMessage="No history"
          style={{ width: '100%' }}>
          <Column field="at" header="When" body={(r: PatchJobRecord) => fmtDate(r.at)} />
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
// All filters live in column headers (filterDisplay="row"). Paginated by PAIR.
export const PatchesPanel = ({ app, enabled = true }: { app: AppRecord; enabled?: boolean }) => {
  const project = app?._id
  const pt = useLazyTable<Record<string, unknown>>(
    'patchPairsPage',
    { project },
    {
      enabled,
      defaultSortField: 'latest',
      defaultSortOrder: -1,
      rows: 25,
      enumFields: ['status', 'platform'],
      searchField: 'fromUpdateId',
    },
  )
  const [selectedPair, setSelectedPair] = useState<Record<string, unknown> | null>(null)

  const platformSel = (pt.filters.platform as { value?: unknown } | undefined)?.value as string[] | null
  const statusSel = (pt.filters.status as { value?: unknown } | undefined)?.value as string[] | null

  // Flatten the page of pairs into platform rows; trim by active platform/status
  // filters and drop any pair left with no matching rows. pairKey keeps a pair's
  // rows contiguous so the rowspan grouping merges its From→To cell.
  const rows = useMemo(() => {
    const out: Array<Record<string, unknown>> = []
    for (const pair of pt.value) {
      let platforms = (pair.platforms as Array<Record<string, unknown>>) || []
      if (platformSel?.length) platforms = platforms.filter((p) => platformSel.includes(String(p.platform)))
      if (statusSel?.length) platforms = platforms.filter((p) => statusSel.includes(String(p.status)))
      platforms = platforms.slice().sort((a, b) => String(a.platform || '').localeCompare(String(b.platform || '')))
      const pairKey = String(pair._id)
      for (const pl of platforms) out.push({ ...pl, pairKey, _pair: pair })
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pt.value, JSON.stringify(platformSel), JSON.stringify(statusSel)])

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
        filterDisplay="menu"
        filters={pt.filters}
        onFilter={pt.onFilter}
        loading={pt.loading}
        paginatorTemplate="FirstPageLink PrevPageLink CurrentPageReport NextPageLink LastPageLink"
        currentPageReportTemplate="{first}–{last} of {totalRecords} pairs"
        size="small"
        rowGroupMode="rowspan"
        groupRowsBy="pairKey"
        style={{ width: '100%', marginTop: 8 }}
        emptyMessage="No patches">
        <Column
          header="From → To"
          field="pairKey"
          filterField="fromUpdateId"
          filter
          filterElement={(o) => (
            <InputText
              value={(o.value as string) || ''}
              onChange={(e) => o.filterApplyCallback(e.target.value)}
              placeholder="updateId…"
              style={{ width: 240, fontSize: 13 }}
            />
          )}
          body={(r) => {
            const pair = (r._pair as Record<string, unknown>) || {}
            return (
              <div onClick={() => setSelectedPair(pair)} title="Open patch details" style={{ ...stackCell, cursor: 'pointer' }}>
                <span style={linkText}>{String(pair.fromUpdateId || '—')}</span>
                <span style={{ color: Colors.text }}>→</span>
                <span style={linkText}>{String(pair.toUpdateId || '—')}</span>
              </div>
            )
          }}
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
          body={(r) => String(r.platform || '—')}
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
          body={(r) => <Pill value={(r.status as string) || '—'} color={PATCH_STATUS_COLORS[(r.status as string) || '']} />}
        />
        <Column header="Size" body={(r) => fmtBytes(r.size as number)} />
        <Column header="Ratio" body={(r) => (r.compressionRatio ? `${((r.compressionRatio as number) * 100).toFixed(0)}%` : '—')} />
        <Column header="Served" body={(r) => String(r.servedCount || 0)} />
        <Column header="Updated" body={(r) => fmtDate((r.completedAt || r.createdAt) as string)} />
      </DataTable>

      {selectedPair && <PatchPairDetail pair={selectedPair} onClose={() => setSelectedPair(null)} />}
    </div>
  )
}
