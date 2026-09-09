import { fmtCurrency, fmtDate } from '../../lib/format'
import { labelFor, prettify } from '../../lib/approvalFields'

/**
 * The parts of a payload that are not a single value.
 *
 * These were `JSON.stringify(value, null, 2)` in a <pre>, which is how an
 * approver came to be reading `"principal": 33689,` off a screen where the
 * question is whether to post a sale. An installment schedule is a table - a
 * row per payment - and it was a table before someone turned it into a string.
 * So draw the table.
 *
 * Read-only on purpose. Editing a schedule means recomputing the amounts that
 * hang off it, which is the module's own form and a different job; the approver
 * sees it in full and changes it on the record once it posts.
 */

/** Values that are money, wherever they turn up in a nested row. */
const MONEY = new Set(['amount', 'principal', 'total', 'balance', 'paid', 'pricePerLiter'])
/** Values that read better as a percentage than a bare number. */
const PERCENT = new Set(['interestPct'])
/** Never worth a column: ids the approver cannot act on. */
const NOISE = new Set(['id'])

function cell(key: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'number') {
    if (MONEY.has(key)) return fmtCurrency(value).replace('.00', '')
    if (PERCENT.has(key)) return `${value}%`
    return value.toLocaleString()
  }
  const text = String(value)
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return fmtDate(text)
  // Enum-ish values arrive as snake_case; nobody wants to read `bank_transfer`.
  return text.includes('_') ? prettify(text) : text
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** The union of keys across rows, so a row missing an optional field still
 * lines up with the ones that have it. */
function columnsOf(rows: Record<string, unknown>[]): string[] {
  const seen = new Set<string>()
  for (const row of rows) for (const k of Object.keys(row)) if (!NOISE.has(k)) seen.add(k)
  return [...seen]
}

export default function NestedValue({ value }: { value: unknown }) {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return <p className="m-0 font-meta text-[12px] text-faint">None.</p>
    }
    // A list of plain values needs no table.
    if (!value.every(isRecord)) {
      return <p className="m-0 text-[13px] text-lab">{value.map((v) => cell('', v)).join(' · ')}</p>
    }
    const rows = value as Record<string, unknown>[]
    const cols = columnsOf(rows)
    return (
      <div className="overflow-x-auto rounded-[6px] border border-line">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr>
              {cols.map((c) => (
                <th
                  key={c}
                  className="whitespace-nowrap border-b border-linesoft bg-paper px-[10px] py-[6px] text-left font-meta text-[10px] font-semibold uppercase tracking-[.09em] text-faint"
                >
                  {labelFor(c)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i}>
                {cols.map((c) => (
                  <td key={c} className="tnum whitespace-nowrap border-b border-linesoft px-[10px] py-[6px] text-sec">
                    {cell(c, row[c])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  if (isRecord(value)) {
    const keys = Object.keys(value).filter((k) => !NOISE.has(k))
    if (keys.length === 0) return <p className="m-0 font-meta text-[12px] text-faint">Empty.</p>
    return (
      <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-[3px]">
        {keys.map((k) => (
          <div key={k} className="contents">
            <dt className="font-meta text-[12px] text-mut">{labelFor(k)}</dt>
            <dd className="tnum m-0 text-[13px] text-lab">{cell(k, value[k])}</dd>
          </div>
        ))}
      </dl>
    )
  }

  return <p className="m-0 text-[13px] text-lab">{cell('', value)}</p>
}
