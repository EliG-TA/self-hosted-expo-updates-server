import React from 'react'
import type { CSSProperties, ReactNode } from 'react'
import type { IconProp } from '@fortawesome/fontawesome-svg-core'
import type { MotionStyle } from 'framer-motion'
import { motion } from 'framer-motion'

import { Colors, Icon, Text } from '..'

interface ButtonProps {
  round?: boolean
  disabled?: boolean
  icon?: string | IconProp
  label?: string
  onClick?: () => void | Promise<void>
  style?: CSSProperties
  iconStyle?: CSSProperties
  width?: CSSProperties['width']
  hidden?: boolean
  danger?: boolean
  children?: ReactNode
  tooltip?: string
  title?: string
}

export function Button({
  round,
  disabled,
  icon,
  label,
  onClick,
  style,
  iconStyle,
  width,
  hidden,
  danger,
  children,
  tooltip,
  title,
}: ButtonProps) {
  const bg = danger ? Colors.danger : Colors.primary
  const fg = danger ? Colors.textOnDanger : Colors.textOnPrimary
  const iconFg = danger ? Colors.iconOnDanger : Colors.iconOnPrimary
  const buttonStyle: MotionStyle = {
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    backgroundColor: bg,
    borderRadius: 8,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.6 : 1,
    userSelect: 'none',
    padding: 10,
    width,
    ...(label ? { paddingLeft: 20, paddingRight: 20 } : {}),
    ...(round ? { width: 30, height: 30 } : {}),
    ...(disabled ? { boxShadow: '', opacity: 0.6 } : { boxShadow: '0px 4px 13px 3px rgba(100, 100, 100, 0.14)' }),
    ...style,
  }

  return hidden ? null : (
    <motion.div
      whileTap={disabled ? '' : 'click'}
      whileHover={disabled ? '' : 'hovered'}
      variants={{
        click: { scale: 1, boxShadow: '5px 5px 13px 3px rgba(255, 255, 255, 0.24)' },
        hovered: { scale: 1.05, boxShadow: '0px 4px 13px 3px rgba(255, 255, 255, 0.44)' },
      }}
      onTap={disabled ? undefined : onClick}
      style={buttonStyle}
      title={tooltip || title}>
      {icon ? <Icon color={iconFg} name={icon} size={16} style={{ marginLeft: -2, ...iconStyle }} /> : null}
      {label ? (
        <Text
          color={fg}
          title
          bold
          upCase
          size={16}
          center
          value={label}
          style={{ marginLeft: icon ? 15 : 0, flexGrow: width ? 1 : 0, textAlign: 'center' }}
        />
      ) : null}
      {children}
    </motion.div>
  )
}
