// @ts-nocheck
import { useState } from 'react'
import { Flex, Card, Spinner, Button, Text, Colors, StatusPill } from '../../Components'
import { DataTable } from 'primereact/datatable'
import { Column } from 'primereact/column'
import { useCQuery, useCollapsedState } from '../../Services'
import { Release } from '../App/Release'
import moment from 'moment'

const formatDate = (date) => date ? moment(date).format('YYYY-MM-DD HH:mm:ss') : '—'

const compareVersionsDesc = (a, b) => {
  const partsA = String(a).split(/[-.]/).map(x => isNaN(x) ? x : parseInt(x))
  const partsB = String(b).split(/[-.]/).map(x => isNaN(x) ? x : parseInt(x))
  for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
    const pa = partsA[i] || 0
    const pb = partsB[i] || 0
    if (pa > pb) return -1
    if (pa < pb) return 1
  }
  return 0
}

const embeddedLine = (row) => {
  const platforms = []
  if (row.embeddedIos) platforms.push('iOS')
  if (row.embeddedAndroid) platforms.push('Android')
  if (!platforms.length) return null
  return `embedded · ${platforms.join(', ')}`
}

const UpdateIdCell = ({ row, onOpen }) => {
  const clickable = !!row.uploadAvailable
  const embedded = embeddedLine(row)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span
        onClick={clickable ? (e) => { e.stopPropagation(); onOpen(row) } : undefined}
        style={{
          cursor: clickable ? 'pointer' : 'default',
          color: clickable ? Colors.primary : 'inherit',
          textDecoration: clickable ? 'underline dotted' : 'none',
          fontFamily: 'ui-monospace, Menlo, monospace',
          fontSize: 12,
          wordBreak: 'break-all',
          lineHeight: 1.3
        }}
        title={clickable ? 'Click to open update details' : 'No upload record — embedded in a native build'}
      >
        {row.updateId}
      </span>
      {row.status && (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          <StatusPill status={row.status} />
        </div>
      )}
      {embedded && (
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', lineHeight: 1.2 }}>
          {embedded}
        </div>
      )}
    </div>
  )
}

const CountWithPct = ({ count, pct, accent = Colors.primary }) => {
  if (!count) {
    return <span style={{ color: 'rgba(255,255,255,0.25)', fontVariantNumeric: 'tabular-nums' }}>—</span>
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, width: '100%' }}>
      <span style={{
        fontVariantNumeric: 'tabular-nums',
        fontWeight: 600,
        fontSize: 14,
        lineHeight: 1.1
      }}>{count}</span>
      <div style={{
        width: '100%',
        height: 4,
        borderRadius: 2,
        background: 'rgba(255,255,255,0.08)',
        overflow: 'hidden'
      }}>
        <div style={{
          width: `${Math.min(100, pct)}%`,
          height: '100%',
          background: accent
        }} />
      </div>
      <span style={{
        fontSize: 11,
        fontVariantNumeric: 'tabular-nums',
        color: 'rgba(255,255,255,0.6)',
        lineHeight: 1
      }}>
        {pct.toFixed(1)}%
      </span>
    </div>
  )
}

const RuntimeSection = ({ version, collapsed, onToggle, children }) => (
  <div style={{ width: '100%', marginTop: 28 }}>
    <div
      onClick={() => onToggle && onToggle(!collapsed)}
      style={{
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        paddingBottom: 6,
        marginBottom: 4,
        borderBottom: `2px solid ${Colors.primary}`,
        cursor: onToggle ? 'pointer' : 'default',
        userSelect: 'none'
      }}
    >
      <span style={{
        display: 'inline-block',
        transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
        transition: 'transform 0.2s ease',
        color: Colors.primary,
        fontSize: 14,
        lineHeight: 1
      }}>▾</span>
      <Text value={`Runtime ${version}`} title size={22} />
    </div>
    {!collapsed && children}
  </div>
)

const ChannelGroup = ({ releaseChannel, platformStats, project, onOpen, collapsed, onToggle }) => {
  // Roll up flat per-platform rows into one row per updateId.
  const byUpdate = new Map()
  for (const ps of platformStats) {
    const embeddedSet = new Set(ps.embeddedUpdates || [])
    for (const u of (ps.updates || [])) {
      if (!byUpdate.has(u.updateId)) {
        byUpdate.set(u.updateId, {
          updateId: u.updateId,
          ios: 0,
          android: 0,
          total: 0,
          lastSeen: null,
          embeddedIos: false,
          embeddedAndroid: false
        })
      }
      const r = byUpdate.get(u.updateId)
      r[ps.platform] = (r[ps.platform] || 0) + (u.onThisVersion || 0)
      r.total += u.onThisVersion || 0
      if (!r.lastSeen || moment(u.lastSeen).isAfter(r.lastSeen)) r.lastSeen = u.lastSeen
      if (ps.platform === 'ios' && embeddedSet.has(u.updateId)) r.embeddedIos = true
      if (ps.platform === 'android' && embeddedSet.has(u.updateId)) r.embeddedAndroid = true
    }
  }

  const rows = [...byUpdate.values()]
  const totalDevices = rows.reduce((acc, r) => acc + r.total, 0)
  const rowsWithPct = rows.map(r => ({
    ...r,
    // All percentages are relative to the group's total device count, so
    // a row's iosPct + androidPct == totalPct.
    iosPct: totalDevices > 0 ? ((r.ios || 0) / totalDevices) * 100 : 0,
    androidPct: totalDevices > 0 ? ((r.android || 0) / totalDevices) * 100 : 0,
    totalPct: totalDevices > 0 ? (r.total / totalDevices) * 100 : 0
  }))

  // Look up which updates have a matching upload record (clickable rows).
  const { data: uploadsData } = useCQuery(['uploads', project])
  const uploads = uploadsData?.data || uploadsData || []
  const uploadByUpdateId = new Map(uploads.map(u => [u.updateId, u]))
  const enrichedRows = rowsWithPct.map(r => {
    const upload = uploadByUpdateId.get(r.updateId) || null
    return {
      ...r,
      uploadAvailable: !!upload,
      upload,
      status: upload?.status || null
    }
  })

  return (
    <Card
      collapsable
      collapsed={collapsed}
      onToggle={onToggle}
      style={{ marginTop: 12, width: '100%' }}
      title={`Channel: ${releaseChannel}  ·  ${totalDevices} device${totalDevices === 1 ? '' : 's'}`}
    >
      <DataTable
        style={{ width: '100%', marginTop: 12, marginBottom: 12 }}
        value={enrichedRows}
        paginator={enrichedRows.length > 10}
        rows={10}
        emptyMessage='No client activity yet'
        sortField='total'
        sortOrder={-1}
      >
        <Column field='updateId' header='Update ID' filter sortable
          body={(row) => <UpdateIdCell row={row} onOpen={onOpen} />}
        />
        <Column field='ios' header='iOS' sortable style={{ width: 110 }} body={(row) => (
          <CountWithPct count={row.ios} pct={row.iosPct} accent='#7fb3ff' />
        )} />
        <Column field='android' header='Android' sortable style={{ width: 110 }} body={(row) => (
          <CountWithPct count={row.android} pct={row.androidPct} accent='#7fdc96' />
        )} />
        <Column field='total' header='Total' sortable style={{ width: 110 }} body={(row) => (
          <CountWithPct count={row.total} pct={row.totalPct} accent={Colors.primary} />
        )} />
        <Column field='lastSeen' header='Last Request' sortable style={{ width: 170 }}
          body={({ lastSeen }) => (
            <span style={{ fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>
              {formatDate(lastSeen)}
            </span>
          )}
        />
      </DataTable>
    </Card>
  )
}

// Container components wrap a hook call (which can't live inside .map()).
const ChannelGroupContainer = ({ project, version, releaseChannel, platformStats, onOpen }) => {
  const [collapsed, setCollapsed] = useCollapsedState(
    `stats:${project}:channel:${version}:${releaseChannel}`,
    false
  )
  return (
    <ChannelGroup
      releaseChannel={releaseChannel}
      platformStats={platformStats}
      project={project}
      onOpen={onOpen}
      collapsed={collapsed}
      onToggle={setCollapsed}
    />
  )
}

const RuntimeSectionContainer = ({ project, version, channelGroups, onOpen }) => {
  const [collapsed, setCollapsed] = useCollapsedState(
    `stats:${project}:runtime:${version}`,
    false
  )
  return (
    <RuntimeSection version={version} collapsed={collapsed} onToggle={setCollapsed}>
      {channelGroups.map((g) => (
        <ChannelGroupContainer
          key={`${version}-${g.releaseChannel}`}
          project={project}
          version={version}
          releaseChannel={g.releaseChannel}
          platformStats={g.platformStats}
          onOpen={onOpen}
        />
      ))}
    </RuntimeSection>
  )
}

export const AppDisplay = ({ app, goto }) => {
  const { data: stats, isSuccess, isFetching } = useCQuery(['stats', app._id])
  const [openedUpdate, setOpenedUpdate] = useState(null)

  const handleOpen = (row) => {
    if (row?.upload) setOpenedUpdate(row.upload)
  }

  // Two-level grouping: runtime version → release channel → per-platform stats.
  // Channel groups within a runtime are sorted by total device count (desc) so
  // the busiest channel is on top.
  const runtimeList = (() => {
    if (!isSuccess) return []

    // Step 1: collapse per-platform rows into (version, channel) buckets.
    const channelBuckets = new Map()
    for (const s of stats || []) {
      const key = `${s.version}__${s.releaseChannel}`
      if (!channelBuckets.has(key)) {
        channelBuckets.set(key, {
          version: s.version,
          releaseChannel: s.releaseChannel,
          platformStats: []
        })
      }
      channelBuckets.get(key).platformStats.push(s)
    }

    // Step 2: compute totalDevices per channel-bucket and group by runtime.
    const byRuntime = new Map()
    for (const group of channelBuckets.values()) {
      group.totalDevices = group.platformStats.reduce(
        (acc, ps) => acc + (ps.updates || []).reduce((a, u) => a + (u.onThisVersion || 0), 0),
        0
      )
      if (!byRuntime.has(group.version)) byRuntime.set(group.version, [])
      byRuntime.get(group.version).push(group)
    }

    // Step 3: sort channels by total devices desc, runtimes by semver desc.
    return [...byRuntime.entries()]
      .map(([version, channelGroups]) => ({
        version,
        channelGroups: channelGroups.sort((a, b) => b.totalDevices - a.totalDevices)
      }))
      .sort((a, b) => compareVersionsDesc(a.version, b.version))
  })()

  const header = (
    <Flex row style={{ alignItems: 'center', gap: 10 }}>
      <Text value={app._id.toUpperCase()} title size={20} />
      {isFetching && isSuccess && (
        <span title='Refreshing data…' style={{
          width: 8, height: 8, borderRadius: '50%',
          background: Colors.primary, opacity: 0.8,
          animation: 'pulse 1.2s ease-in-out infinite'
        }} />
      )}
      <Button icon='wrench' round onClick={goto} style={{ marginLeft: 20 }} />
    </Flex>
  )

  return (
    <Card fadein collapsable style={{ marginTop: 20, width: '100%' }} customHeader={header}>
      {!isSuccess && <Spinner />}
      {isSuccess && runtimeList.length === 0 && (
        <Text value='No clients have made requests for updates on this server yet.' style={{ marginBottom: 20 }} />
      )}
      {isSuccess && runtimeList.map(({ version, channelGroups }) => (
        <RuntimeSectionContainer
          key={version}
          project={app._id}
          version={version}
          channelGroups={channelGroups}
          onOpen={handleOpen}
        />
      ))}

      <Flex fw style={{ marginTop: 20, marginBottom: 20 }}>
        <Button icon='wrench' label='configure app & release updates' onClick={goto} style={{ width: 380 }} />
      </Flex>

      <Release update={openedUpdate} onHide={() => setOpenedUpdate(null)} />
    </Card>
  )
}
