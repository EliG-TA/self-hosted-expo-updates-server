// Inline multi-toggle for DataTable filter popovers (filterDisplay="menu").
// Each option is its own row with a checkbox + label — no dropdown click
// needed to discover the available values. Per-option `color` paints the
// label so semantic palettes (status, severity, …) stay visible.

export interface InlineMultiToggleOption {
  label: string
  value: string
  color?: string
}

export const InlineMultiToggle = ({
  value,
  options,
  onChange,
}: {
  value?: string[]
  options: InlineMultiToggleOption[]
  onChange: (next: string[] | null) => void
}) => {
  const selected = new Set(value || [])
  const toggle = (v: string) => {
    const next = new Set(selected)
    if (next.has(v)) next.delete(v)
    else next.add(v)
    // null (not []) means "no filter" — passing [] would register an
    // active-but-empty $in that matches nothing.
    onChange(next.size ? Array.from(next) : null)
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 200 }}>
      {options.map((o) => {
        const active = selected.has(o.value)
        return (
          <label
            key={o.value}
            onClick={(e) => {
              e.preventDefault()
              toggle(o.value)
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '7px 10px',
              borderRadius: 4,
              cursor: 'pointer',
              fontSize: 14,
              userSelect: 'none',
            }}>
            <input
              type="checkbox"
              checked={active}
              readOnly
              style={{ cursor: 'pointer', margin: 0, width: 16, height: 16, flexShrink: 0 }}
            />
            <span style={{ color: o.color || 'inherit', fontWeight: active ? 600 : 400 }}>{o.label}</span>
          </label>
        )
      })}
    </div>
  )
}
