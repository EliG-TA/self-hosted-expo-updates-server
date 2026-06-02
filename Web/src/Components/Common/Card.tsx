import React, { useEffect, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import type { MotionStyle } from 'framer-motion'
import { motion } from 'framer-motion'

import { Flex, Icon, Text } from '..'
import { Colors } from './Colors'

const transition = { default: { duration: 0.4 } }

interface CardProps {
  fadeIn?: boolean
  fadein?: boolean
  collapsable?: boolean
  title?: string
  titleCollapsed?: string
  titleStyle?: CSSProperties
  collapsed?: boolean
  children?: ReactNode
  style?: CSSProperties
  customHeader?: ReactNode
  onExpand?: () => void
  onToggle?: (collapsed: boolean) => void
}

type CardState = 'open' | 'closed'

export function Card({
  fadeIn,
  fadein,
  collapsable,
  title,
  titleCollapsed,
  titleStyle,
  collapsed,
  children,
  style,
  customHeader,
  onExpand,
  onToggle,
}: CardProps) {
  const [state, setState] = useState<CardState>('closed')
  const isCollapsed = state === 'closed'

  const toggleCollapse = (newState?: CardState) => {
    const applyNewState = newState || (isCollapsed ? 'open' : 'closed')
    setState(applyNewState)
    applyNewState === 'open' && onExpand && onExpand()
    onToggle && onToggle(applyNewState === 'closed')
  }

  useEffect(() => {
    collapsable && setState(collapsed ? 'closed' : 'open')
  }, [collapsable, collapsed])

  const cardStyle: MotionStyle = {
    backdropFilter: 'blur(16px) saturate(180%)',
    WebkitBackdropFilter: 'blur(16px) saturate(180%)',
    backgroundColor: 'rgba(17, 25, 40, 0.5)',
    borderRadius: 8,
    border: '1px solid rgba(255, 255, 255, 0.125)',
    padding: 20,
    opacity: fadeIn || fadein ? 0 : 1,
    boxShadow: '10px 10px 20px 0px  rgba(100, 100, 100, 0.24)',
    ...(collapsable ? { position: 'relative' } : {}),
    ...(collapsable && isCollapsed && !customHeader ? { cursor: 'pointer' } : {}),
    ...style,
    width: undefined,
  }

  return (
    <motion.div
      animate={{ opacity: 1 }}
      transition={{ duration: 1 }}
      style={{ ...cardStyle, ...(style ? { width: style.width, height: style.height } : {}) }}
      onClick={isCollapsed && !customHeader ? () => toggleCollapse('open') : undefined}>
      {!customHeader && !title ? null : (
        <Flex row jb fw>
          <Flex row js fw style={{ paddingRight: 30 }}>
            {title ? (
              <Text
                title
                bold
                value={titleCollapsed ? (isCollapsed ? titleCollapsed : title) : title}
                style={{ ...titleStyle, marginRight: 20 }}
                size={20}
              />
            ) : null}
            {customHeader}
          </Flex>
          {collapsable && (
            <motion.div
              initial="closed"
              animate={state}
              style={{ cursor: 'pointer' }}
              onClick={() => (customHeader || !isCollapsed) && toggleCollapse()}
              variants={{
                open: { rotate: 0, transition },
                closed: { rotate: 180, transition },
              }}>
              <Icon name="chevron-up" color={Colors.primary} />
            </motion.div>
          )}
        </Flex>
      )}
      {!collapsable ? (
        children
      ) : (
        <motion.div
          initial="closed"
          style={{ overflow: 'hidden' }}
          animate={state}
          variants={{
            open: { height: 'auto', opacity: 1, marginTop: 10, transition },
            closed: { height: 0, opacity: 0, marginTop: 0, transition },
          }}>
          {children}
        </motion.div>
      )}
    </motion.div>
  )
}
