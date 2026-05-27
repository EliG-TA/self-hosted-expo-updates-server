import React from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { background } from '../../Resources'

function Background ({ children }: { children?: ReactNode }) {
  const backgroundStyle: CSSProperties = {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    overflow: 'hidden',
    backgroundImage: `url(${background})`,
    backgroundPosition: 'center',
    backgroundSize: 'cover',
    backgroundRepeat: 'noRepeat'
  }

  return <div style={backgroundStyle}>{children}</div>
}

export { Background }
