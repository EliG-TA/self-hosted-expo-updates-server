import { useMemo, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import moment from 'moment'
import { Column } from 'primereact/column'
import { DataTable } from 'primereact/datatable'
import { InputText } from 'primereact/inputtext'
import { TabPanel, TabView } from 'primereact/tabview'

import {
  Button,
  Colors,
  DateRangeFilter,
  Flex,
  InlineMultiToggle,
  Input,
  PATCH_STATUS_COLORS,
  Spinner,
  StatusPill,
  Text,
} from '../../Components'
import { FC, invalidateQuery, useCQuery, useLazyTable } from '../../Services'
import type { ListResult, PatchRecord, UnknownRecord, UploadRecord } from '../../types'
import { listFromResult } from '../../types'
import { PatchPairDetail, PlatformCell } from './PatchesPanel'
import { UpdateLink } from './updateDetails'

interface UpdateSizes extends UnknownRecord {
  assetsCount?: number
  assetsSharedCount?: number
  assetsIosOnlyCount?: number
  assetsAndroidOnlyCount?: number
  zipBytes?: number
  bundleByPlatform?: { ios?: number; android?: number }
  assetsBytes?: number
  patchesBytes?: number
  total?: number
}

const getSize = (size?: number) => {
  if (!size) return '0 B'
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(2)} KB`
  if (size < 1024 * 1024 * 1024) return `${(size / 1024 / 1024).toFixed(2)} MB`
  return `${(size / 1024 / 1024 / 1024).toFixed(2)} GB`
}

const formatDate = (date?: string | Date) => (date ? moment(date).format('YYYY-MM-DD HH:mm:ss') : '—')

const styles: Record<string, CSSProperties> = {
  section: {
    width: '100%',
    marginTop: 14,
    alignItems: 'flex-start',
  },
  sectionTitle: {
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: 1.5,
    color: Colors.primary,
    textTransform: 'uppercase',
    marginBottom: 6,
    paddingBottom: 4,
    borderBottom: '1px solid rgba(159, 168, 218, 0.2)',
    width: '100%',
  },
  row: {
    width: '100%',
    padding: '3px 0',
    alignItems: 'flex-start',
    gap: 8,
  },
  label: {
    width: 130,
    flexShrink: 0,
    fontSize: 12,
    color: 'rgba(255,255,255,0.55)',
    paddingTop: 1,
  },
  value: {
    flex: 1,
    fontSize: 13,
    color: Colors.text,
    wordBreak: 'break-all',
  },
  mono: {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  },
  badge: {
    padding: '2px 8px',
    borderRadius: 4,
    color: '#fff',
    fontSize: 11,
    fontWeight: 600,
  },
  totalRow: {
    width: '100%',
    padding: '6px 0',
    marginTop: 4,
    borderTop: '1px solid rgba(159, 168, 218, 0.2)',
    alignItems: 'flex-start',
    gap: 8,
  },
}

// Patch-lifecycle badge: matches the Pill in PatchesPanel so the table
// in Upload-details ↔ Patches tab → Status column looks identical to the
// main Patches tab. Upload-status renderings elsewhere in this file use
// StatusPill from Components/Common.
const StatusBadge = ({ status }: { status?: string }) => (
  <span style={{ ...styles.badge, backgroundColor: PATCH_STATUS_COLORS[status || ''] || '#666' }}>{status}</span>
)

const Row = ({
  label,
  value,
  mono,
  children,
}: {
  label: string
  value?: ReactNode
  mono?: boolean
  children?: ReactNode
}) => (
  <Flex row style={styles.row}>
    <div style={styles.label}>{label}</div>
    <div style={{ ...styles.value, ...(mono ? styles.mono : {}) }}>
      {children !== undefined ? children : (value ?? '—')}
    </div>
  </Flex>
)

const Section = ({
  title,
  children,
  style,
  collapsible,
  defaultCollapsed,
}: {
  title: string
  children: ReactNode
  style?: CSSProperties
  collapsible?: boolean
  defaultCollapsed?: boolean
}) => {
  const [collapsed, setCollapsed] = useState(!!defaultCollapsed)
  const isCollapsed = !!collapsible && collapsed
  return (
    <Flex as style={{ ...styles.section, ...style }}>
      <div
        style={{
          ...styles.sectionTitle,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          cursor: collapsible ? 'pointer' : 'default',
          userSelect: 'none',
        }}
        onClick={collapsible ? () => setCollapsed((c) => !c) : undefined}>
        {collapsible && <span style={{ fontSize: 9 }}>{isCollapsed ? '▶' : '▼'}</span>}
        {title}
      </div>
      {!isCollapsed && children}
    </Flex>
  )
}

const SizesSection = ({ uploadId }: { uploadId: string }) => {
  const { data: sizes, isSuccess } = useCQuery<UpdateSizes>(['updateSizes', uploadId])
  if (!isSuccess || !sizes)
    return (
      <Section title="Sizes">
        <Spinner />
      </Section>
    )

  const assetsBreakdown = sizes.assetsCount
    ? `${sizes.assetsCount} files · ${sizes.assetsSharedCount} shared, ${sizes.assetsIosOnlyCount} iOS-only, ${sizes.assetsAndroidOnlyCount} Android-only`
    : null

  return (
    <Section title="Sizes">
      <Row label="Zip archive" value={getSize(sizes.zipBytes)} />
      <Row label="Bundle iOS" value={getSize(sizes.bundleByPlatform?.ios)} />
      <Row label="Bundle Android" value={getSize(sizes.bundleByPlatform?.android)} />
      <Row label="Assets">
        <div>{getSize(sizes.assetsBytes)}</div>
        {assetsBreakdown && (
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginTop: 2 }}>{assetsBreakdown}</div>
        )}
      </Row>
      <Row label="Patches" value={getSize(sizes.patchesBytes)} />
      <Flex row style={styles.totalRow}>
        <div style={{ ...styles.label, fontWeight: 700, color: Colors.text }}>Total</div>
        <div style={{ ...styles.value, fontWeight: 700, fontSize: 14 }}>{getSize(sizes.total)}</div>
      </Flex>
    </Section>
  )
}

type PatchSource = {
  _id: string
  updateId?: string
  status?: string
  createdAt?: string | Date
  gitCommit?: string
  platforms: string[]
}
type PatchSourcesResult = { target?: { platforms?: string[] }; sources: PatchSource[] }

// One direction of this update's patches as a flat, server-paginated table with
// all filters in the column headers. `counterpartField` is the OTHER end's
// updateId (the fixed end is scoped server-side via base toUploadId/fromUploadId):
//   'fromUpdateId' → incoming (other → this)   'toUpdateId' → outgoing (this → other)
const DirectionalTable = ({
  base,
  counterpartField,
  label,
  onOpenPair,
}: {
  base: Record<string, unknown>
  counterpartField: 'fromUpdateId' | 'toUpdateId'
  label: string
  onOpenPair: (pair: Record<string, unknown>) => void
}) => {
  // Paginate over pairs (not individual patches) so the per-pair aggregates
  // computed in patch-pairs.page() are available for the totals row + for
  // server-side sorting by totalSize / avgRatio / totalServed / latestCreatedAt.
  const t = useLazyTable<Record<string, unknown>>('patchPairsPage', base, {
    defaultSortField: 'latestCreatedAt',
    defaultSortOrder: -1,
    rows: 25,
    enumFields: ['status', 'platform'],
    searchField: counterpartField,
    dateFields: ['createdAt'],
  })

  // Soft date bounds derived from the loaded page — same approach as
  // PatchesPanel. User can still pick outside; just guides the typical case.
  const [createdMin, createdMax] = useMemo(() => {
    let lo = Infinity
    let hi = -Infinity
    for (const pair of t.value) {
      const ts = pair.latestCreatedAt ? new Date(pair.latestCreatedAt as string).getTime() : NaN
      if (!isFinite(ts)) continue
      if (ts < lo) lo = ts
      if (ts > hi) hi = ts
    }
    return isFinite(lo) ? [new Date(lo), new Date(hi)] : [undefined, undefined]
  }, [t.value])

  return (
    <DataTable
      value={t.value}
      lazy
      paginator
      first={t.first}
      rows={t.rows}
      totalRecords={t.totalRecords}
      onPage={t.onPage}
      onSort={t.onSort}
      sortField={t.sortField}
      sortOrder={t.sortOrder}
      filterDisplay="menu"
      filters={t.filters}
      onFilter={t.onFilter}
      loading={t.loading}
      paginatorTemplate="FirstPageLink PrevPageLink CurrentPageReport NextPageLink LastPageLink"
      currentPageReportTemplate="{first}–{last} of {totalRecords} pairs"
      size="small"
      style={{ width: '100%' }}
      emptyMessage="None.">
      <Column
        header={label}
        field={counterpartField}
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
          <span
            onClick={() => onOpenPair(pair)}
            title="Open patch details"
            style={{
              cursor: 'pointer',
              fontFamily: 'ui-monospace, Menlo, monospace',
              fontSize: 12,
              wordBreak: 'break-all',
              color: Colors.primary,
              textDecoration: 'underline dotted',
            }}>
            {String(pair[counterpartField] || '—')}
          </span>
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
            options={PATCH_PLATFORM_OPTIONS}
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
            options={PATCH_STATUS_OPTIONS}
            onChange={(v) => o.filterApplyCallback(v)}
          />
        )}
        body={(pair: Record<string, unknown>) => (
          <PlatformCell
            pair={pair}
            showLabels={false}
            render={(p) =>
              p ? (
                <StatusBadge status={p.status as string | undefined} />
              ) : (
                <span style={{ color: 'rgba(255,255,255,0.4)', fontStyle: 'italic', fontSize: 11 }}>not generated</span>
              )
            }
          />
        )}
      />
      <Column
        field="totalSize"
        header="Size"
        sortable
        body={(pair: Record<string, unknown>) => (
          <PlatformCell
            pair={pair}
            render={(p) => (p?.size != null ? getSize(p.size as number) : '—')}
            total={getSize((pair.totalSize as number) || 0)}
          />
        )}
      />
      <Column
        field="avgRatio"
        header="Ratio"
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
        field="totalServed"
        header="Served"
        sortable
        body={(pair: Record<string, unknown>) => (
          <PlatformCell pair={pair} render={(p) => String(p?.servedCount || 0)} total={String(pair.totalServed || 0)} />
        )}
      />
      <Column
        field="latestCreatedAt"
        header="Updated"
        sortable
        filter
        filterField="createdAt"
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
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>{formatDate(p?.completedAt || p?.createdAt)}</span>
            )}
            total={
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>{formatDate(pair.latestCreatedAt as string)}</span>
            }
          />
        )}
      />
    </DataTable>
  )
}

// Build patches FROM one or more selected base updates TO the update being
// viewed. Candidates (same project + runtime version + release channel) are
// picked by checkbox; one enqueue call per selected source.
const CreatePatchTable = ({ uploadId, project }: { uploadId: string; project?: string }) => {
  const { data, isSuccess } = useCQuery<PatchSourcesResult>(['patchSources', project, uploadId])
  const { data: patchesData } = useCQuery<ListResult<PatchRecord>>(['patches', project])
  const [selected, setSelected] = useState<PatchSource[]>([])
  const [creating, setCreating] = useState(false)

  // Map fromUpdateId → set of platforms already covered by a patch toward this
  // update. 'failed' patches don't count as covered — they're retryable via a
  // fresh enqueue, so their source stays a candidate.
  const coveredByFrom = useMemo(() => {
    const map = new Map<string, Set<string>>()
    for (const p of listFromResult(patchesData)) {
      if (p.toUploadId !== uploadId) continue
      if (p.status === 'failed') continue
      const from = p.fromUpdateId ? String(p.fromUpdateId) : ''
      const plat = p.platform ? String(p.platform) : ''
      if (!from || !plat) continue
      if (!map.has(from)) map.set(from, new Set())
      map.get(from)?.add(plat)
    }
    return map
  }, [patchesData, uploadId])

  const rawSources = data?.sources || []
  // Drop a source only once EVERY common platform already has a (non-failed)
  // patch — partially-covered sources stay so the missing platform can be made.
  const sources = rawSources.filter((s) => {
    const covered = coveredByFrom.get(s.updateId || '')
    return !covered || !s.platforms.every((p) => covered.has(p))
  })

  const handleGenerate = async () => {
    if (!selected.length) return
    setCreating(true)
    let enq = 0
    let skp = 0
    let failed = 0
    for (const s of selected) {
      try {
        const res = (await FC.client
          .service('patches')
          .update('enqueue', { project, fromUploadId: s._id, toUploadId: uploadId })) as {
          enqueued?: unknown[]
          skipped?: unknown[]
        }
        enq += res?.enqueued?.length || 0
        skp += res?.skipped?.length || 0
      } catch (e) {
        failed++
      }
    }
    invalidateQuery(['patches', 'patchJobs', 'diskUsage'])
    window.toast?.show({
      severity: failed ? 'warn' : enq ? 'success' : 'info',
      summary: `Queued ${enq} patch(es)`,
      detail:
        [skp ? `${skp} skipped` : '', failed ? `${failed} source(s) failed` : ''].filter(Boolean).join(' · ') ||
        undefined,
    })
    setSelected([])
    setCreating(false)
  }

  if (!isSuccess) return <Spinner />
  if (!sources.length)
    return (
      <Text
        value={
          rawSources.length
            ? 'All eligible base updates already have patches queued for this update.'
            : 'No eligible base updates (must share runtime version + release channel).'
        }
        size={12}
        color="rgba(255,255,255,0.5)"
      />
    )

  // Precompute a string label for platforms so the column is sortable/filterable
  // (PrimeReact can't sort/filter an array field directly).
  const rows = sources.map((s) => ({ ...s, platformsLabel: s.platforms.join(' + ') }))

  return (
    <div style={{ width: '100%' }}>
      <DataTable
        value={rows}
        size="small"
        style={{ width: '100%' }}
        dataKey="_id"
        selectionMode="multiple"
        selection={selected}
        onSelectionChange={(e) => setSelected(e.value as PatchSource[])}
        paginator={rows.length > 10}
        rows={10}
        removableSort
        sortField="createdAt"
        sortOrder={-1}>
        <Column selectionMode="multiple" headerStyle={{ width: '3rem' }} />
        <Column
          field="updateId"
          header="Update ID"
          sortable
          filter
          filterPlaceholder="Search id"
          body={(r: PatchSource) => <UpdateLink updateId={r.updateId} />}
        />
        <Column
          field="status"
          header="Status"
          sortable
          filter
          filterPlaceholder="Status"
          body={(r: PatchSource) => <StatusPill status={r.status} />}
        />
        <Column
          field="platformsLabel"
          header="Platforms"
          sortable
          filter
          filterPlaceholder="Platform"
          body={(r: PatchSource) => r.platforms.join(' + ')}
        />
        <Column
          field="gitCommit"
          header="Commit"
          sortable
          filter
          filterPlaceholder="Commit"
          body={(r: PatchSource) => <span style={styles.mono}>{r.gitCommit?.slice(0, 7) || '—'}</span>}
        />
        <Column field="createdAt" header="Created" sortable body={(r: PatchSource) => formatDate(r.createdAt)} />
      </DataTable>
      <Flex row style={{ marginTop: 10 }}>
        {creating ? (
          <Spinner />
        ) : (
          <Button
            icon="plus"
            label={`Generate patches${selected.length ? ` (${selected.length})` : ''}`}
            disabled={!selected.length}
            onClick={handleGenerate}
          />
        )}
      </Flex>
    </div>
  )
}

const PATCH_STATUS_OPTIONS = ['pending', 'generating', 'validating', 'ready', 'failed', 'not-beneficial'].map((s) => ({
  label: s,
  value: s,
  color: PATCH_STATUS_COLORS[s],
}))
const PATCH_PLATFORM_OPTIONS = ['ios', 'android'].map((s) => ({ label: s, value: s }))

const PatchesTab = ({ uploadId, project }: { uploadId: string; project?: string }) => {
  // Clicking a counterpart opens the pair detail window, which is where patches
  // are deleted (the tables themselves have no delete button).
  const [selectedPair, setSelectedPair] = useState<Record<string, unknown> | null>(null)

  return (
    <div style={{ width: '100%', display: 'block', boxSizing: 'border-box' }}>
      <Section title="Incoming patches  ·  other → this" style={{ marginTop: 0 }} collapsible>
        <DirectionalTable
          base={{ project, toUploadId: uploadId }}
          counterpartField="fromUpdateId"
          label="From"
          onOpenPair={setSelectedPair}
        />
      </Section>

      <Section title="Outgoing patches  ·  this → other" collapsible>
        <DirectionalTable
          base={{ project, fromUploadId: uploadId }}
          counterpartField="toUpdateId"
          label="To"
          onOpenPair={setSelectedPair}
        />
      </Section>

      <Section title="Create patches  ·  base → this" collapsible defaultCollapsed>
        <CreatePatchTable uploadId={uploadId} project={project} />
      </Section>

      {selectedPair && <PatchPairDetail pair={selectedPair} onClose={() => setSelectedPair(null)} />}
    </div>
  )
}

const OverviewTab = ({ update }: { update: UploadRecord }) => (
  <div style={{ width: '100%', display: 'block', boxSizing: 'border-box' }}>
    <Section title="Identity" style={{ marginTop: 0 }}>
      <Row label="Update ID" value={update.updateId || 'Not Released'} mono />
      <Row label="Update Hash" value={update.updateHash} mono />
      <Row label="Path" value={update.path || 'none'} mono />
    </Section>

    <Section title="Release">
      <Row label="Version" value={update.version} />
      <Row label="Release Channel" value={update.releaseChannel} />
      <Row label="Created" value={formatDate(update.createdAt)} />
      <Row label="Released On" value={update.releasedAt ? formatDate(update.releasedAt) : 'Not Released'} />
    </Section>

    <Section title="Source">
      <Row label="Git Branch" value={update.gitBranch} mono />
      <Row label="Git Commit" value={update.gitCommit} mono />
      <Row label="Original File" value={String(update.originalname || '')} mono />
      <Row label="Uploaded File" value={update.filename} mono />
    </Section>

    {update.status !== 'deleted' && <SizesSection uploadId={update._id} />}
  </div>
)

export const UpdateInfo = ({
  update,
  activeIndex,
  onTabChange,
}: {
  update: UploadRecord
  activeIndex?: number
  onTabChange?: (index: number) => void
}) => {
  const tabProps = onTabChange !== undefined ? { activeIndex, onTabChange: (e) => onTabChange(e.index) } : {}

  return (
    <div style={{ width: '100%', display: 'block', boxSizing: 'border-box' }}>
      {/* Sticky strip with current status — stays visible as the body scrolls */}
      <div
        className="update-info-sticky-header"
        style={{
          width: '100%',
          display: 'flex',
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 12,
          flexWrap: 'wrap',
        }}>
        <div style={{ display: 'flex', flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          <StatusPill status={update.status} />
          {update.releasedAt && (
            <Text value={`released ${formatDate(update.releasedAt)}`} size={11} color="rgba(255,255,255,0.6)" />
          )}
        </div>
      </div>

      <TabView
        {...tabProps}
        className="update-info-tabview"
        style={{ width: '100%' }}
        panelContainerStyle={{ width: '100%', padding: '16px 0 0 0' }}>
        <TabPanel header="Overview">
          <OverviewTab update={update} />
        </TabPanel>
        {update.status !== 'deleted' && (
          <TabPanel header="Patches">
            <div style={{ width: '100%', minHeight: 600 }}>
              <PatchesTab uploadId={update._id} project={update.project} />
            </div>
          </TabPanel>
        )}
        {update.appJson != null && (
          <TabPanel header="app.json">
            <div style={{ width: '100%', minHeight: 600 }}>
              <Input multiline value={JSON.stringify(update.appJson, null, 2)} rows={20} style={{ width: '100%' }} />
            </div>
          </TabPanel>
        )}
        {update.dependencies != null && (
          <TabPanel header="package.json">
            <div style={{ width: '100%', minHeight: 600 }}>
              <Input
                multiline
                value={JSON.stringify(update.dependencies, null, 2)}
                rows={20}
                style={{ width: '100%' }}
              />
            </div>
          </TabPanel>
        )}
      </TabView>
    </div>
  )
}

UpdateInfo.OVERVIEW_TAB_INDEX = 0
