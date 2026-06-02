// Inline multi-toggle for DataTable filter popovers (filterDisplay="menu").
// Each option is its own row with a checkbox + label — no dropdown click
// needed to discover the available values. Per-option `color` paints the
// label so semantic palettes (status, severity, …) stay visible.
//
// Mental model: all-checked == "no filter, show everything". Three states:
//   value == null/undefined → default, every checkbox rendered checked
//   value is non-empty array → only listed values are checked (narrowed)
//   value is empty array     → all unchecked (user clicked Clear, about to
//                              pick specific values). Backend treats this
//                              the same as "no filter" so the table doesn't
//                              flash empty.
//
// `defaultValue` (optional): when the caller wants Clear to revert to a
// specific subset rather than empty. Used e.g. by All Updates → Status, where
// "everything except deleted" is the intended starting point and Clear should
// snap back to that, not blank out the whole filter.

export interface InlineMultiToggleOption {
  label: string
  value: string
  color?: string
}

const sameSet = (a: string[] | null | undefined, b: string[] | null | undefined) => {
  if (!a || !b) return false
  if (a.length !== b.length) return false
  const setB = new Set(b)
  return a.every((v) => setB.has(v))
}

export const InlineMultiToggle = ({
  value,
  options,
  defaultValue,
  onChange,
}: {
  value?: string[] | null
  options: InlineMultiToggleOption[]
  defaultValue?: string[]
  onChange: (next: string[] | null) => void
}) => {
  const isDefault = value == null
  const isCleared = Array.isArray(value) && value.length === 0
  // Effective display set: default ⇒ all options; otherwise the listed set.
  const selected = isDefault ? new Set(options.map((o) => o.value)) : new Set(value || [])
  const toggle = (v: string) => {
    const next = new Set(selected)
    if (next.has(v)) next.delete(v)
    else next.add(v)
    // Collapse "all selected" back to the canonical default so the filter
    // state stays clean. Empty stays as [] so the cleared-visual is preserved.
    if (next.size === options.length) onChange(null)
    else onChange(Array.from(next))
  }
  const allSelected = isDefault || (Array.isArray(value) && value.length === options.length)
  // Clear: when a caller-supplied default exists, "Clear" snaps back to it.
  // The button is disabled when we're already there. Otherwise the legacy
  // semantic applies: clearing empties the selection (visual "none checked").
  const isAtDefault = !!defaultValue && Array.isArray(value) && sameSet(value, defaultValue)
  const clearTarget: string[] | null = defaultValue ? [...defaultValue] : []
  const clearDisabled = defaultValue ? isAtDefault : isCleared
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 200 }}>
      <div
        style={{
          display: 'flex',
          gap: 8,
          padding: '4px 10px 6px',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
          marginBottom: 2,
        }}>
        <button
          type="button"
          disabled={allSelected}
          onClick={(e) => {
            e.preventDefault()
            onChange(null)
          }}
          style={{
            background: 'none',
            border: 'none',
            padding: 0,
            cursor: allSelected ? 'default' : 'pointer',
            fontSize: 11,
            color: allSelected ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.7)',
            textDecoration: allSelected ? 'none' : 'underline',
          }}>
          Select all
        </button>
        <button
          type="button"
          disabled={clearDisabled}
          onClick={(e) => {
            e.preventDefault()
            onChange(clearTarget)
          }}
          style={{
            background: 'none',
            border: 'none',
            padding: 0,
            cursor: clearDisabled ? 'default' : 'pointer',
            fontSize: 11,
            color: clearDisabled ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.7)',
            textDecoration: clearDisabled ? 'none' : 'underline',
          }}>
          Clear
        </button>
      </div>
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
