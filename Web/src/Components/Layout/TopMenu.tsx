import React, { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'

import { FC, invalidateQuery, useCQuery } from '../../Services'
import { doLogout } from '../../State'
import type { DiskUsageRecord, ServerSettings } from '../../types'
import { Button, Colors, Flex, HamburgerMenu, SlidingMenu, Spinner, Text } from '..'
import menuItems from './MenuItems'

const formatBytes = (n: number) => {
  if (!n) return '0 B'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}

// Popover to tune how long the disk-usage breakdown is cached before the
// server re-walks the filesystem. Global web-app setting (server-settings),
// surfaced here because this is the chip it controls.
const DiskUsageSettings = ({ onClose }: { onClose: () => void }) => {
  const { data } = useCQuery<ServerSettings>('serverSettings')
  const [seconds, setSeconds] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (data) setSeconds(Math.round((data.diskUsageCacheMs ?? 30000) / 1000))
  }, [data])

  const save = async () => {
    if (seconds == null) return
    setSaving(true)
    try {
      await FC.client.service('server-settings').patch('global', { diskUsageCacheMs: Math.round(seconds * 1000) })
      // Refresh the chip immediately, not on the next 30s poll.
      invalidateQuery(['serverSettings', 'diskUsage'])
      window.toast?.show({ severity: 'info', summary: 'Disk-usage cache saved' })
      onClose()
    } catch (e) {
      window.toast?.show({ severity: 'error', summary: 'Save failed', detail: e.message })
    }
    setSaving(false)
  }

  return (
    <div style={styles.popover} onClick={(e) => e.stopPropagation()}>
      <Text value="Disk-usage cache" bold size={13} />
      <Text
        value="How long the storage breakdown is cached before re-scanning the disk."
        size={11}
        color="rgba(255,255,255,0.6)"
      />
      <Flex row style={{ gap: 8, alignItems: 'center', marginTop: 10 }}>
        <input
          type="number"
          min={1}
          max={3600}
          step={1}
          value={seconds ?? ''}
          disabled={saving || seconds == null}
          onChange={(e) => setSeconds(Math.max(1, parseInt(e.target.value) || 1))}
          style={styles.popoverInput as CSSProperties}
        />
        <Text value="seconds" size={11} color="rgba(255,255,255,0.6)" />
      </Flex>
      <Flex row style={{ gap: 8, marginTop: 14, justifyContent: 'flex-end' }}>
        <Button label="Cancel" onClick={onClose} />
        {saving ? <Spinner /> : <Button label="Save" icon="save" onClick={save} />}
      </Flex>
    </div>
  )
}

const DiskUsageChip = () => {
  const { data, isLoading, isError, error } = useCQuery<DiskUsageRecord>('diskUsage')
  const [open, setOpen] = useState(false)

  let content: React.ReactNode
  if (isError) {
    content = <Text value={`disk usage error: ${error?.message || 'unknown'}`} size={11} color="#ff6b6b" />
  } else if (isLoading || !data) {
    content = <Text value="disk usage…" size={11} color="rgba(255,255,255,0.5)" />
  } else {
    const { updatesBytes = 0, patchesBytes = 0, usedBytes = 0, freeBytes = 0, totalBytes = 0 } = data
    const usedPct = totalBytes > 0 ? Math.min(100, Math.round((usedBytes / totalBytes) * 100)) : 0
    content = (
      <>
        <Text value={`Updates: ${formatBytes(updatesBytes)}`} size={11} color={Colors.text} />
        <Text value="·" size={11} color={Colors.text} style={{ margin: '0 6px' }} />
        <Text value={`Patches: ${formatBytes(patchesBytes)}`} size={11} color={Colors.text} />
        <Text value="·" size={11} color={Colors.text} style={{ margin: '0 6px' }} />
        <Text
          value={`Disk: ${formatBytes(usedBytes)} / ${formatBytes(totalBytes)} (${usedPct}%)`}
          size={11}
          color={usedPct > 90 ? '#ff6b6b' : Colors.text}
        />
        <Text value="·" size={11} color={Colors.text} style={{ margin: '0 6px' }} />
        <Text value={`Free: ${formatBytes(freeBytes)}`} size={11} color={Colors.text} />
      </>
    )
  }

  return (
    <div style={{ position: 'relative' }}>
      <Flex
        row
        style={{ ...styles.chip, cursor: 'pointer' }}
        onClick={() => setOpen((o) => !o)}
        title="Disk-usage cache settings">
        {content}
      </Flex>
      {open && (
        <>
          <div style={styles.backdrop as CSSProperties} onClick={() => setOpen(false)} />
          <DiskUsageSettings onClose={() => setOpen(false)} />
        </>
      )}
    </div>
  )
}

export function TopMenu() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const { label: currentPage } = menuItems?.find((item) => pathname?.includes(item.path)) || { label: '' }

  const menuAction = (page: string, external?: boolean) => {
    if (page === 'Logout') return doLogout()
    console.log(page, external)
    if (external) return window.open(page, '_blank')
    return navigate(page)
  }

  return (
    <>
      <SlidingMenu menuAction={menuAction} menuItems={menuItems} />
      <motion.div style={styles.containerStyle} animate={{ opacity: 1, y: 0 }} transition={{ duration: 1 }}>
        <Flex row style={{ paddingLeft: 20 }}>
          <HamburgerMenu />
          <Text
            color={Colors.primary}
            title
            size="20px"
            style={{ marginLeft: 10 }}
            value={(currentPage || '').toUpperCase()}
          />
        </Flex>
        <Flex row fh style={{ marginRight: 20, gap: 16 }}>
          <DiskUsageChip />
          <a href="https://ghio.io" target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>
            <Text
              value="free software by GHIO.IO"
              size={10}
              color={Colors.primary}
              style={{ width: 64, textAlign: 'right' }}
            />
          </a>
        </Flex>
      </motion.div>
    </>
  )
}

const styles: Record<string, CSSProperties> = {
  chip: {
    padding: '4px 10px',
    borderRadius: 6,
    backgroundColor: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.1)',
    alignItems: 'center',
  },
  backdrop: {
    position: 'fixed',
    inset: 0,
    zIndex: 30,
  },
  popover: {
    position: 'absolute',
    top: 'calc(100% + 8px)',
    right: 0,
    zIndex: 31,
    width: 280,
    padding: 14,
    borderRadius: 8,
    backgroundColor: 'rgba(17, 25, 40, 0.98)',
    border: '1px solid rgba(255,255,255,0.15)',
    boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
    display: 'flex',
    flexDirection: 'column',
  },
  popoverInput: {
    width: 100,
    padding: '6px 10px',
    borderRadius: 4,
    border: '1px solid rgba(255,255,255,0.2)',
    background: 'rgba(20,26,37,1)',
    color: '#fff',
    fontSize: 14,
  },
  containerStyle: {
    width: '100%',
    height: 50,
    zIndex: 20,
    position: 'relative',
    display: 'flex',
    flexDirection: 'row',
    justifyContent: 'space-between',
    backdropFilter: 'blur(16px) saturate(180%)',
    backgroundColor: 'rgba(17, 25, 40, 0.5)',
    WebkitBackdropFilter: 'blur(16px) saturate(180%)',
    borderBottom: ' 1px solid rgba(255, 255, 255, 0.125)',
    y: -50,
    opacity: 0,
  },
}
