import { useMemo, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import moment from 'moment'
import { Column } from 'primereact/column'
import { DataTable } from 'primereact/datatable'
import { TabPanel, TabView } from 'primereact/tabview'

import { Button, Colors, ConfirmDialog, Flex, Input, Spinner, Text } from '../../Components'
import { FC, invalidateQuery, useCQuery } from '../../Services'
import type { ListResult, PatchRecord, UnknownRecord, UploadRecord } from '../../types'
import { listFromResult } from '../../types'
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

const STATUS_COLORS = {
  released: '#4caf50',
  obsolete: '#9e9e9e',
  ready: '#42a5f5',
  // patch lifecycle statuses (rendered in the Patches tab)
  pending: '#ffb300',
  generating: '#42a5f5',
  validating: '#42a5f5',
  failed: '#ef5350',
  'not-beneficial': '#9e9e9e',
}

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
    textTransform: 'uppercase',
    letterSpacing: 0.5,
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

const StatusBadge = ({ status }: { status?: string }) => (
  <span style={{ ...styles.badge, backgroundColor: STATUS_COLORS[status as keyof typeof STATUS_COLORS] || '#666' }}>
    {status}
  </span>
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

// One direction of a patch list, grouped by the counterpart update.
//   groupField 'fromUpdateId' → incoming (other → this), header shows From
//   groupField 'toUpdateId'   → outgoing (this → other), header shows To
const DirectionalPatches = ({
  rows,
  groupField,
  onDelete,
}: {
  rows: PatchRecord[]
  groupField: 'fromUpdateId' | 'toUpdateId'
  onDelete: (patch: PatchRecord) => void
}) => {
  if (!rows.length) return <Text value="None." size={12} color="rgba(255,255,255,0.5)" />
  const sorted = [...rows].sort((a, b) => {
    const g = String(a[groupField] || '').localeCompare(String(b[groupField] || ''))
    return g !== 0 ? g : String(a.platform || '').localeCompare(String(b.platform || ''))
  })
  const headerLabel = groupField === 'fromUpdateId' ? 'From' : 'To'
  return (
    <DataTable
      value={sorted}
      size="small"
      style={{ width: '100%' }}
      rowGroupMode="subheader"
      groupRowsBy={groupField}
      sortField={groupField}
      sortOrder={1}
      rowGroupHeaderTemplate={(row) => (
        <span style={{ fontSize: 12 }}>
          <span style={{ color: 'rgba(255,255,255,0.5)', marginRight: 6 }}>{headerLabel}:</span>
          <UpdateLink updateId={row[groupField] as string} />
        </span>
      )}>
      <Column field="platform" header="Platform" />
      <Column field="createdAt" header="Date" body={(row) => formatDate(row.createdAt)} />
      <Column field="status" header="Status" body={(row) => <StatusBadge status={row.status} />} />
      <Column field="size" header="Size" body={(row) => getSize(row.size || 0)} />
      <Column
        field="compressionRatio"
        header="Ratio"
        body={(row) => (row.compressionRatio ? `${(row.compressionRatio * 100).toFixed(0)}%` : '—')}
      />
      <Column field="servedCount" header="Served" body={(row) => row.servedCount || 0} />
      <Column
        header=""
        body={(row) => <Button icon="trash" danger onClick={() => onDelete(row)} style={{ padding: 4 }} />}
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
          body={(r: PatchSource) => <StatusBadge status={r.status} />}
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

const PatchesTab = ({ uploadId, project }: { uploadId: string; project?: string }) => {
  const { data: patches, isSuccess } = useCQuery<ListResult<PatchRecord>>(['patches', project])
  const [pendingDelete, setPendingDelete] = useState<PatchRecord | null>(null)
  const [deleting, setDeleting] = useState(false)
  if (!isSuccess) return <Spinner />
  const all = listFromResult(patches)
  const incoming = all.filter((p) => p.toUploadId === uploadId) // other → this
  const outgoing = all.filter((p) => p.fromUploadId === uploadId) // this → other

  const confirmDelete = async () => {
    if (!pendingDelete?._id) return
    setDeleting(true)
    try {
      await FC.client.service('patches').remove(pendingDelete._id)
      invalidateQuery(['patches', 'diskUsage'])
    } catch (e) {
      window.toast.show({ severity: 'error', summary: 'Error', detail: e.message })
    }
    setDeleting(false)
    setPendingDelete(null)
  }

  return (
    <div style={{ width: '100%', display: 'block', boxSizing: 'border-box' }}>
      <Section title="Incoming patches  ·  other → this" style={{ marginTop: 0 }} collapsible>
        <DirectionalPatches rows={incoming} groupField="fromUpdateId" onDelete={setPendingDelete} />
      </Section>

      <Section title="Outgoing patches  ·  this → other" collapsible>
        <DirectionalPatches rows={outgoing} groupField="toUpdateId" onDelete={setPendingDelete} />
      </Section>

      <Section title="Create patches  ·  base → this" collapsible defaultCollapsed>
        <CreatePatchTable uploadId={uploadId} project={project} />
      </Section>

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
          <>
            <Text value={`Delete the ${pendingDelete.platform} patch:`} />
            <div style={{ ...styles.mono, fontSize: 12, marginTop: 12 }}>
              {String(pendingDelete.fromUpdateId || '—')}
              <div style={{ color: Colors.text }}>→</div>
              {String(pendingDelete.toUpdateId || '—')}
            </div>
            <Text
              value="Removes the patch file and DB record. It will be regenerated on demand if still needed."
              style={{ marginTop: 16 }}
            />
          </>
        )}
      </ConfirmDialog>
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

    <SizesSection uploadId={update._id} />
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
          <StatusBadge status={update.status} />
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
        <TabPanel header="Patches">
          <div style={{ width: '100%', minHeight: 600 }}>
            <PatchesTab uploadId={update._id} project={update.project} />
          </div>
        </TabPanel>
        <TabPanel header="app.json">
          <div style={{ width: '100%', minHeight: 600 }}>
            <Input multiline value={JSON.stringify(update.appJson, null, 2)} rows={20} style={{ width: '100%' }} />
          </div>
        </TabPanel>
        <TabPanel header="package.json">
          <div style={{ width: '100%', minHeight: 600 }}>
            <Input multiline value={JSON.stringify(update.dependencies, null, 2)} rows={20} style={{ width: '100%' }} />
          </div>
        </TabPanel>
      </TabView>
    </div>
  )
}

UpdateInfo.OVERVIEW_TAB_INDEX = 0
