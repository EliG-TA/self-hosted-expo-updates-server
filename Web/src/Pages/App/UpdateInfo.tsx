import { Flex, Input, Text, Colors } from '../../Components'
import { TabView, TabPanel } from 'primereact/tabview'
import moment from 'moment'

const formatDate = (date) => date ? moment(date).format('YYYY-MM-DD HH:mm:ss') : '—'

const STATUS_COLORS = {
  released: '#4caf50',
  obsolete: '#9e9e9e',
  ready: '#42a5f5'
}

const styles = {
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
  }
}

const StatusBadge = ({ status }) => (
  <span style={{ ...styles.badge, backgroundColor: STATUS_COLORS[status] || '#666' }}>{status}</span>
)

const Row = ({ label, value, mono, children }) => (
  <Flex row style={styles.row}>
    <div style={styles.label}>{label}</div>
    <div style={{ ...styles.value, ...(mono ? styles.mono : {}) }}>
      {children !== undefined ? children : (value ?? '—')}
    </div>
  </Flex>
)

const Section = ({ title, children, style }) => (
  <Flex as style={{ ...styles.section, ...style }}>
    <div style={styles.sectionTitle}>{title}</div>
    {children}
  </Flex>
)

const OverviewTab = ({ update }) => (
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
      <Row label='Original File' value={update.originalname} mono />
      <Row label='Uploaded File' value={update.filename} mono />
    </Section>
  </div>
)

export const UpdateInfo = ({ update, activeIndex, onTabChange }) => {
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
