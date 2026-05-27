import React from 'react'
import type { CSSProperties } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import type { FontAwesomeIconProps } from '@fortawesome/react-fontawesome'
import { library } from '@fortawesome/fontawesome-svg-core'
import type { IconProp } from '@fortawesome/fontawesome-svg-core'

import {
  faHome,
  faPlus,
  faSignInAlt,
  faSignOutAlt,
  faBars,
  faChevronUp,
  faUpload,
  faDownload,
  faCheck,
  faBan,
  faWrench,
  faTrash,
  faSync,
  faBook
} from '@fortawesome/free-solid-svg-icons'

library.add(
  faHome,
  faSignOutAlt,
  faPlus,
  faSignInAlt,
  faBars,
  faChevronUp,
  faUpload,
  faDownload,
  faCheck,
  faBan,
  faWrench,
  faTrash,
  faSync,
  faBook
)

interface IconProps extends Omit<FontAwesomeIconProps, 'icon' | 'style' | 'color' | 'name' | 'size'> {
  name: string | IconProp
  size?: number
  style?: CSSProperties
  color?: string
}

export function Icon ({ name, size, style, color, ...props }: IconProps) {
  return (
    <FontAwesomeIcon {...props} icon={name as IconProp} style={{ fontSize: size || 36, color, ...style }} />
  )
}
