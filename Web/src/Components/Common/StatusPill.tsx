// Shared upload-status pill. 'ready' (uploaded but never released) is
// surfaced as 'new' since that's the user-facing concept on dashboard
// screens — backend keeps the 'ready' status name.
//
// Color palette + the ready→new label remap come from statusColors.ts,
// so any other badge that renders upload status stays visually identical.

import { UPLOAD_STATUS_COLORS, UPLOAD_STATUS_LABELS } from './statusColors'

// Translucent backgrounds derive from the foreground color (alpha 0.22)
// so the existing visual treatment is preserved while the source of truth
// for the colour itself moves to statusColors.ts.
const TRANSLUCENT_BG: Record<string, string> = {
  released: 'rgba(76, 175, 80, 0.22)',
  ready: 'rgba(66, 165, 245, 0.22)',
  obsolete: 'rgba(255, 255, 255, 0.08)',
  deleted: 'rgba(239, 83, 80, 0.18)',
}

export const StatusPill = ({ status }: { status?: string }) => {
  if (!status) return null
  const fg = UPLOAD_STATUS_COLORS[status]
  if (!fg) return null
  const label = UPLOAD_STATUS_LABELS[status] || status
  return (
    <span
      style={{
        padding: '1px 6px',
        borderRadius: 3,
        fontSize: 10,
        fontWeight: 600,
        backgroundColor: TRANSLUCENT_BG[status] || 'rgba(255,255,255,0.08)',
        color: fg,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
      }}>
      {label}
    </span>
  )
}
