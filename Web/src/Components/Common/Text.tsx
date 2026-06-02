import React from 'react'
import type { CSSProperties } from 'react'

import { Colors } from './Colors'

interface TextProps {
  style?: CSSProperties
  bold?: boolean
  italic?: boolean
  size?: number | string
  color?: string
  center?: boolean
  upCase?: boolean
  value?: string | number | null
  title?: boolean
}

export const Text = ({ style, bold, italic, size, color, center, upCase, value, title }: TextProps) => (
  <div
    style={{
      fontWeight: bold ? 'bold' : 'normal',
      fontStyle: italic ? 'italic' : 'normal',
      fontSize: size || 15,
      fontFamily: 'Inter',
      ...(color === 'inherit' ? {} : { color: color || Colors.text }),
      textAlign: center ? 'center' : 'start',
      ...(title ? { fontFamily: 'Inter', fontWeight: 700, color: color || Colors.primary } : {}),
      ...style,
    }}>
    {upCase && value ? String(value).toUpperCase() : value}
  </div>
)
