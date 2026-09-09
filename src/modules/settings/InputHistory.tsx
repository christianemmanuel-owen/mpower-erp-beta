import { useState } from 'react'
import { Card, DataTable, Field, Input, PageHeader, Select, td } from '../../components/ui'
import { useAuth } from '../../lib/auth'
import { useTable } from '../../lib/data'
import { ACTION_LABELS, useAudit, type AuditRow } from '../../lib/approvals'

/**
 * Staff input history - Secondary Feature 2.2.
 *
 * "A log of staff data entries, with notifications, allowing administrators to
 * review each staff member's past inputs."
 *
 * The log is append-only and written server-side on every write, so it records
 * what actually happened rather than what a screen chose to report. A non-admin
 * seat can open this page but the server only ever returns that seat's own rows.
 */
export default function InputHistory() {
  const { seat } = useAuth()
  const seats = useTable('seats')
  const [filters, setFilters] = useState({ seat: '', action: '', since: '', until: '' })
  const { data, isLoading } = useAudit({ ...filters, limit: 200 })

  const rows = data?.rows ?? []

  return (
    <div className="p-6">
      <PageHeader
        title="Input history"
      />

      <Card className="mt-4 p-4">
        <div className="grid grid-cols-4 gap-3">
          {seat?.isAdmin && (
            <Field label="Staff member">
              <Select value={filters.seat} onChange={(e) => setFilters((f) => ({ ...f, seat: e.target.value }))}>
                <option value="">Everyone</option>
                {(seats ?? []).map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </Select>
            </Field>
          )}
          <Field label="Action">
            <Select value={filters.action} onChange={(e) => setFilters((f) => ({ ...f, action: e.target.value }))}>
              <option value="">All actions</option>
              {Object.entries(ACTION_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </Select>
          </Field>
          <Field label="From">
            <Input type="date" value={filters.since} onChange={(e) => setFilters((f) => ({ ...f, since: e.target.value }))} />
          </Field>
          <Field label="To">
            <Input type="date" value={filters.until} onChange={(e) => setFilters((f) => ({ ...f, until: e.target.value }))} />
          </Field>
        </div>
      </Card>

      <Card className="mt-4">
        {isLoading ? (
          <p className="p-6 text-[13px] text-faint">Loading…</p>
        ) : (
          <DataTable
            cols={[{ label: 'When' }, { label: 'Who' }, { label: 'What' }, { label: 'Record' }, { label: 'Changes' }]}
            empty="No entries match these filters."
          >
            {rows.map((r) => <HistoryRow key={r.id} row={r} />)}
          </DataTable>
        )}
      </Card>
    </div>
  )
}

function HistoryRow({ row }: { row: AuditRow }) {
  const [open, setOpen] = useState(false)
  const changeCount = row.changes ? Object.keys(row.changes).length : 0

  return (
    <>
      <tr>
        <td className={td}>
          <span className="block text-[13px]">{new Date(row.at).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })}</span>
          <span className="block text-[11px] text-faint">{new Date(row.at).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' })}</span>
        </td>
        <td className={td}>{row.seatName}</td>
        <td className={td}>
          <span className="font-semibold text-lab">{ACTION_LABELS[row.action] ?? row.action}</span>
          {row.summary && <span className="block text-[12px] text-mut">{row.summary}</span>}
        </td>
        <td className={td}>
          <span className="capitalize text-mut">{row.tbl}</span>
        </td>
        <td className={td}>
          {changeCount > 0 ? (
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="cursor-pointer text-[12px] font-semibold uppercase text-tealbtn hover:underline"
            >
              {open ? 'Hide' : `${changeCount} field${changeCount === 1 ? '' : 's'}`}
            </button>
          ) : (
            <span className="text-[12px] text-faint">—</span>
          )}
        </td>
      </tr>
      {open && row.changes && (
        <tr>
          <td className={td} colSpan={5}>
            <div className="rounded-[8px] bg-fill2 p-3">
              {Object.entries(row.changes).map(([field, [before, after]]) => (
                <p key={field} className="text-[12px] leading-6">
                  <span className="font-semibold text-lab">{field}</span>{' '}
                  <span className="text-red-600 line-through">{preview(before)}</span>{' '}
                  <span className="text-mut">→</span>{' '}
                  <span className="text-teal-700">{preview(after)}</span>
                </p>
              ))}
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

/** Renders any field value short enough to sit on one line - installments and
 * other nested shapes get summarised rather than dumped. */
function preview(v: unknown): string {
  if (v === null || v === undefined || v === '') return '(blank)'
  if (typeof v === 'boolean') return v ? 'yes' : 'no'
  if (Array.isArray(v)) return `${v.length} item${v.length === 1 ? '' : 's'}`
  if (typeof v === 'object') return '(details)'
  const s = String(v)
  return s.length > 48 ? `${s.slice(0, 48)}…` : s
}
