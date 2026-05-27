// Shared upload-status pill. 'ready' (uploaded but never released) is
// surfaced as 'new' since that's the user-facing concept on dashboard
// screens — backend keeps the 'ready' status name.

const STATUS_PILL = {
  released: { label: 'released', bg: 'rgba(76, 175, 80, 0.22)', fg: '#7fdc96' },
  obsolete: { label: 'obsolete', bg: 'rgba(255, 255, 255, 0.08)', fg: 'rgba(255,255,255,0.6)' },
  ready: { label: 'new', bg: 'rgba(66, 165, 245, 0.22)', fg: '#7fb3ff' },
}

export const StatusPill = ({ status }) => {
  const cfg = STATUS_PILL[status]
  if (!cfg) return null
  return (
    <span
      style={{
        padding: '1px 6px',
        borderRadius: 3,
        fontSize: 10,
        fontWeight: 600,
        backgroundColor: cfg.bg,
        color: cfg.fg,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
      }}>
      {cfg.label}
    </span>
  )
}
