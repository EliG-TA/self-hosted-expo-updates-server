import { addLocale } from 'primereact/api'
import { Calendar } from 'primereact/calendar'
import type { Nullable } from 'primereact/ts-helpers'

// Input.tsx switches the global PrimeReact locale to 'it' at module load,
// which Calendar inherits. We register English here and pass `locale="en"`
// to scope the override to this component only.
addLocale('en', {
  firstDayOfWeek: 0,
  dayNames: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
  dayNamesShort: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  dayNamesMin: ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'],
  monthNames: [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ],
  monthNamesShort: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  today: 'Today',
  clear: 'Clear',
})

// DataTable column filter element: PrimeReact Calendar in range-selection
// mode, rendered INLINE inside the column-filter popover. Compared to popup
// mode this fixes three things at once:
//   * no overlap with the popover's Clear/Apply footer
//   * no auto-popup when PrimeReact focuses the first filter input
//   * onChange stages via filterCallback (not filterApplyCallback) so a
//     half-picked range [Date, null] doesn't commit + close the popover
//     before the user picks the second date.
//
// Value shape: [from: Date|null, to: Date|null] — matches PrimeReact's
// "between" matchMode and the useLazyTable.dateFields contract.

export const DateRangeFilter = ({
  value,
  onChange,
  minDate,
  maxDate,
}: {
  value?: unknown
  onChange: (next: [Date | null, Date | null] | null) => void
  minDate?: Date
  maxDate?: Date
}) => {
  const v = Array.isArray(value) ? (value as Nullable<(Date | null)[]>) : null
  return (
    <div className="date-range-filter-inline">
      <Calendar
        value={v}
        onChange={(e) => {
          const next = (e.value as [Date | null, Date | null] | null) || null
          if (!next || (!next[0] && !next[1])) onChange(null)
          else onChange(next)
        }}
        selectionMode="range"
        inline
        locale="en"
        dateFormat="yy-mm-dd"
        minDate={minDate}
        maxDate={maxDate}
      />
    </div>
  )
}
