
import React from 'react'
import type { CSSProperties } from 'react'
import { motion } from 'framer-motion'
import { Text, HamburgerMenu, Flex, SlidingMenu, Colors } from '..'
import { doLogout } from '../../State'
import { useCQuery } from '../../Services'
import menuItems from './MenuItems'
import { useLocation, useNavigate } from 'react-router-dom'
import type { DiskUsageRecord } from '../../types'

const formatBytes = (n: number) => {
  if (!n) return '0 B'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}

const DiskUsageChip = () => {
  const { data, isLoading, isError, error } = useCQuery<DiskUsageRecord>('diskUsage')

  if (isError) {
    return (
      <Flex row style={styles.chip}>
        <Text value={`disk usage error: ${error?.message || 'unknown'}`} size={11} color='#ff6b6b' />
      </Flex>
    )
  }
  if (isLoading || !data) {
    return (
      <Flex row style={styles.chip}>
        <Text value='disk usage…' size={11} color='rgba(255,255,255,0.5)' />
      </Flex>
    )
  }

  const { updatesBytes = 0, patchesBytes = 0, usedBytes = 0, freeBytes = 0, totalBytes = 0 } = data
  const usedPct = totalBytes > 0 ? Math.min(100, Math.round((usedBytes / totalBytes) * 100)) : 0
  return (
    <Flex row style={styles.chip}>
      <Text value={`Updates: ${formatBytes(updatesBytes)}`} size={11} color={Colors.text} />
      <Text value='·' size={11} color={Colors.text} style={{ margin: '0 6px' }} />
      <Text value={`Patches: ${formatBytes(patchesBytes)}`} size={11} color={Colors.text} />
      <Text value='·' size={11} color={Colors.text} style={{ margin: '0 6px' }} />
      <Text
        value={`Disk: ${formatBytes(usedBytes)} / ${formatBytes(totalBytes)} (${usedPct}%)`}
        size={11}
        color={usedPct > 90 ? '#ff6b6b' : Colors.text}
      />
      <Text value='·' size={11} color={Colors.text} style={{ margin: '0 6px' }} />
      <Text value={`Free: ${formatBytes(freeBytes)}`} size={11} color={Colors.text} />
    </Flex>
  )
}

export function TopMenu () {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const { label: currentPage } = menuItems?.find(item => pathname?.includes(item.path)) || { label: '' }

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
          <Text color={Colors.primary} title size='20px' style={{ marginLeft: 10 }} value={(currentPage || '').toUpperCase()} />
        </Flex>
        <Flex row fh style={{ marginRight: 20, gap: 16 }}>
          <DiskUsageChip />
          <a href='https://ghio.io' target='_blank' rel='noreferrer' style={{ textDecoration: 'none' }}>
            <Text value='free software by GHIO.IO' size={10} color={Colors.primary} style={{ width: 64, textAlign: 'right' }} />
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
    alignItems: 'center'
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
    opacity: 0
  }
}
