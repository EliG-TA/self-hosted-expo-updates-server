import { Flex, Input, Text, Button, Spinner, Colors } from '../../Components'
import { TabView, TabPanel } from 'primereact/tabview'
import { DataTable } from 'primereact/datatable'
import { Column } from 'primereact/column'
import { useCQuery, FC, invalidateQuery } from '../../Services'
import moment from 'moment'
import type { CSSProperties, ReactNode } from 'react'
import type { ListResult, PatchRecord, UploadRecord, UnknownRecord } from '../../types'
import { listFromResult } from '../../types'

interface UpdateSizes extends UnknownRecord {
  assetsCount?: number
  assetsSharedCount?: number
  assetsIosOnlyCount?: number
  assetsAndroidOnlyCount?: number
  zipBytes?: number
  bundleByPlatform?: { ios?: number, android?: number }
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

const formatDate = (date?: string | Date) => date ? moment(date).format('YYYY-MM-DD HH:mm:ss') : '—'

const STATUS_COLORS = {
  released: '#4caf50',
  obsolete: '#9e9e9e',
  ready: '#42a5f5',
  // patch lifecycle statuses (rendered in the Patches tab)
  pending: '#ffb300',
  generating: '#42a5f5',
  validating: '#42a5f5',
  failed: '#ef5350',
  'not-beneficial': '#9e9e9e'
}

const styles: Record<string, CSSProperties> = {
  section: {
    width: '100%',
    marginTop: 14,
    alignItems: 'flex-start'
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
    width: '100%'
  },
  row: {
    width: '100%',
    padding: '3px 0',
    alignItems: 'flex-start',
    gap: 8
  },
  label: {
    width: 130,
    flexShrink: 0,
    fontSize: 12,
    color: 'rgba(255,255,255,0.55)',
    paddingTop: 1
  },
  value: {
    flex: 1,
    fontSize: 13,
    color: Colors.text,
    wordBreak: 'break-all'
  },
  mono: {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace'
  },
  badge: {
    padding: '2px 8px',
    borderRadius: 4,
    color: '#fff',
    fontSize: 11,
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: 0.5
  },
  totalRow: {
    width: '100%',
    padding: '6px 0',
    marginTop: 4,
    borderTop: '1px solid rgba(159, 168, 218, 0.2)',
    alignItems: 'flex-start',
    gap: 8
  }
}

const StatusBadge = ({ status }: { status?: string }) => (
  <span style={{ ...styles.badge, backgroundColor: STATUS_COLORS[status as keyof typeof STATUS_COLORS] || '#666' }}>{status}</span>
)

const Row = ({ label, value, mono, children }: { label: string, value?: ReactNode, mono?: boolean, children?: ReactNode }) => (
  <Flex row style={styles.row}>
    <div style={styles.label}>{label}</div>
    <div style={{ ...styles.value, ...(mono ? styles.mono : {}) }}>
      {children !== undefined ? children : (value ?? '—')}
    </div>
  </Flex>
)

const Section = ({ title, children, style }: { title: string, children: ReactNode, style?: CSSProperties }) => (
  <Flex as style={{ ...styles.section, ...style }}>
    <div style={styles.sectionTitle}>{title}</div>
    {children}
  </Flex>
)

const SizesSection = ({ uploadId }: { uploadId: string }) => {
  const { data: sizes, isSuccess } = useCQuery<UpdateSizes>(['updateSizes', uploadId])
  if (!isSuccess || !sizes) return <Section title='Sizes'><Spinner /></Section>

  const assetsBreakdown = sizes.assetsCount
    ? `${sizes.assetsCount} files · ${sizes.assetsSharedCount} shared, ${sizes.assetsIosOnlyCount} iOS-only, ${sizes.assetsAndroidOnlyCount} Android-only`
    : null

  return (
    <Section title='Sizes'>
      <Row label='Zip archive' value={getSize(sizes.zipBytes)} />
      <Row label='Bundle iOS' value={getSize(sizes.bundleByPlatform?.ios)} />
      <Row label='Bundle Android' value={getSize(sizes.bundleByPlatform?.android)} />
      <Row label='Assets'>
        <div>{getSize(sizes.assetsBytes)}</div>
        {assetsBreakdown && (
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginTop: 2 }}>
            {assetsBreakdown}
          </div>
        )}
      </Row>
      <Row label='Patches' value={getSize(sizes.patchesBytes)} />
      <Flex row style={styles.totalRow}>
        <div style={{ ...styles.label, fontWeight: 700, color: Colors.text }}>Total</div>
        <div style={{ ...styles.value, fontWeight: 700, fontSize: 14 }}>{getSize(sizes.total)}</div>
      </Flex>
    </Section>
  )
}

const PatchesTab = ({ uploadId, project }: { uploadId: string, project?: string }) => {
  const { data: patches, isSuccess } = useCQuery<ListResult<PatchRecord>>(['patches', project])
  if (!isSuccess) return <Spinner />
  const related = listFromResult(patches).filter(p => p.toUploadId === uploadId)

  const handleDelete = async (id: string) => {
    if (!window.confirm('Delete this patch?')) return
    try {
      await FC.client.service('patches').remove(id)
      invalidateQuery(['patches', 'diskUsage'])
    } catch (e) {
      window.toast.show({ severity: 'error', summary: 'Error', detail: e.message })
    }
  }

  return (
    <div style={{ width: '100%', display: 'block', boxSizing: 'border-box' }}>
      {!related.length && <Text value='No patches generated yet.' size={12} color='rgba(255,255,255,0.5)' />}
      {related.length > 0 && (
        <DataTable value={related} size='small' style={{ width: '100%' }}>
          <Column field='fromUpdateId' header='From' body={(row) => <span style={styles.mono}>{row.fromUpdateId?.slice(0, 8) || '—'}</span>} />
          <Column field='platform' header='Platform' />
          <Column field='createdAt' header='Date' body={(row) => formatDate(row.createdAt)} />
          <Column field='status' header='Status' body={(row) => <StatusBadge status={row.status} />} />
          <Column field='size' header='Size' body={(row) => getSize(row.size || 0)} />
          <Column field='compressionRatio' header='Ratio' body={(row) => row.compressionRatio ? `${(row.compressionRatio * 100).toFixed(0)}%` : '—'} />
          <Column field='servedCount' header='Served' body={(row) => row.servedCount || 0} />
          <Column header='' body={(row) => (
            <Button icon='trash' danger onClick={() => handleDelete(row._id)} style={{ padding: 4 }} />
          )} />
        </DataTable>
      )}
    </div>
  )
}

const OverviewTab = ({ update }: { update: UploadRecord }) => (
  <div style={{ width: '100%', display: 'block', boxSizing: 'border-box' }}>
    <Section title='Identity' style={{ marginTop: 0 }}>
      <Row label='Update ID' value={update.updateId || 'Not Released'} mono />
      <Row label='Update Hash' value={update.updateHash} mono />
      <Row label='Path' value={update.path || 'none'} mono />
    </Section>

    <Section title='Release'>
      <Row label='Version' value={update.version} />
      <Row label='Release Channel' value={update.releaseChannel} />
      <Row label='Created' value={formatDate(update.createdAt)} />
      <Row label='Released On' value={update.releasedAt ? formatDate(update.releasedAt) : 'Not Released'} />
    </Section>

    <Section title='Source'>
      <Row label='Git Branch' value={update.gitBranch} mono />
      <Row label='Git Commit' value={update.gitCommit} mono />
      <Row label='Original File' value={String(update.originalname || '')} mono />
      <Row label='Uploaded File' value={update.filename} mono />
    </Section>

    <SizesSection uploadId={update._id} />
  </div>
)

export const UpdateInfo = ({ update, activeIndex, onTabChange }: { update: UploadRecord, activeIndex?: number, onTabChange?: (index: number) => void }) => {
  const tabProps = onTabChange !== undefined
    ? { activeIndex, onTabChange: (e) => onTabChange(e.index) }
    : {}

  return (
    <div style={{ width: '100%', display: 'block', boxSizing: 'border-box' }}>
      {/* Sticky strip with current status — stays visible as the body scrolls */}
      <div
        className='update-info-sticky-header'
        style={{
          width: '100%',
          display: 'flex',
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 12,
          flexWrap: 'wrap'
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          <StatusBadge status={update.status} />
          {update.releasedAt && (
            <Text value={`released ${formatDate(update.releasedAt)}`} size={11} color='rgba(255,255,255,0.6)' />
          )}
        </div>
      </div>

      <TabView
        {...tabProps}
        className='update-info-tabview'
        style={{ width: '100%' }}
        panelContainerStyle={{ width: '100%', padding: '16px 0 0 0' }}
      >
        <TabPanel header='Overview'>
          <OverviewTab update={update} />
        </TabPanel>
        <TabPanel header='Patches'>
          <div style={{ width: '100%', minHeight: 600 }}>
            <PatchesTab uploadId={update._id} project={update.project} />
          </div>
        </TabPanel>
        <TabPanel header='app.json'>
          <div style={{ width: '100%', minHeight: 600 }}>
            <Input multiline value={JSON.stringify(update.appJson, null, 2)} rows={20} style={{ width: '100%' }} />
          </div>
        </TabPanel>
        <TabPanel header='package.json'>
          <div style={{ width: '100%', minHeight: 600 }}>
            <Input multiline value={JSON.stringify(update.dependencies, null, 2)} rows={20} style={{ width: '100%' }} />
          </div>
        </TabPanel>
      </TabView>
    </div>
  )
}

UpdateInfo.OVERVIEW_TAB_INDEX = 0
