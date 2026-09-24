import { createContext, useContext, useState } from 'react'
import { Card, DataTable, Dialog, Field, FormSection, GhostButton, Input, PageHeader, Pager, Select, td } from '../../components/ui'
import { RailAside, RailRow, RailSection } from '../../components/SummaryRail'
import { GoArrow, ModuleLink } from '../../components/ModuleLink'
import { useAuth } from '../../lib/auth'
import { useTable, useTables, type TableName } from '../../lib/data'
import { recordHref } from '../../lib/deepLink'
import { departmentFor, displayReferenceFor, isIdField, labelFor, nameOf } from '../../lib/approvalFields'
import { fmtDate, fmtLiters } from '../../lib/format'
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
  const [filters, setFiltersState] = useState({ seat: '', action: '', since: '', until: '' })
  // Paged on the server: the log only grows, and every entry is one row of
  // someone's work. A filter change starts again from the first page.
  const PAGE = 25
  const [page, setPage] = useState(1)
  const setFilters = (fn: (f: typeof filters) => typeof filters) => { setFiltersState(fn); setPage(1) }
  const { data, isLoading } = useAudit({ ...filters, limit: PAGE, offset: (page - 1) * PAGE })

  const rows = data?.rows ?? []
  const total = data?.total ?? rows.length
  const totalPages = Math.max(1, Math.ceil(total / PAGE))

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
            cols={[{ label: 'When' }, { label: 'Who' }, { label: 'What' }, { label: 'Record' }, { label: '', align: 'right' }]}
            empty="No entries match these filters."
          >
            {rows.map((r) => <HistoryRow key={r.id} row={r} />)}
          </DataTable>
        )}
        <Pager page={page} totalPages={totalPages} setPage={setPage} total={total} pageSize={PAGE} noun="entries" />
      </Card>
    </div>
  )
}

/** Entries written before the server stopped naming records by id still
 *  carry one in their summary. Take it out; the dialog says what the record
 *  is in its own words. */
const scrub = (row: AuditRow) => (row.summary ?? '').split(row.recordId).join('').replace(/\s+/g, ' ').trim()

function HistoryRow({ row }: { row: AuditRow }) {
  const [open, setOpen] = useState(false)
  const changeCount = row.changes ? Object.keys(row.changes).length : 0
  const summary = scrub(row)

  return (
    <>
      <tr
        role="button"
        tabIndex={0}
        aria-label={`Open entry: ${ACTION_LABELS[row.action] ?? row.action}${summary ? `, ${summary}` : ''}`}
        onClick={() => setOpen(true)}
        onKeyDown={(e) => { if (e.key === 'Enter') setOpen(true) }}
        className="group cursor-pointer transition-colors hover:bg-paper focus:outline-none focus-visible:bg-paper"
      >
        <td className={td}>
          <span className="block text-[13px]">{new Date(row.at).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })}</span>
          <span className="block text-[11px] text-faint">{new Date(row.at).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' })}</span>
        </td>
        <td className={td}>{row.seatName}</td>
        <td className={td}>
          <span className="font-semibold text-lab">{ACTION_LABELS[row.action] ?? row.action}</span>
          {summary && <span className="block text-[12px] text-mut">{summary}</span>}
        </td>
        <td className={td}>
          <span className="text-mut">{departmentFor(row.tbl)}</span>
        </td>
        <td className={`${td} text-right`}>
          <span className="inline-flex items-center gap-[8px] font-meta text-[12px] text-mut">
            {changeCount > 0 && <span className="tnum">{changeCount} field{changeCount === 1 ? '' : 's'}</span>}
            <GoArrow className="text-faint opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
          </span>
        </td>
      </tr>
      {open && <HistoryDetail row={row} onClose={() => setOpen(false)} />}
    </>
  )
}

/**
 * One entry in full: who, when, what was done to which record, and every
 * field that changed with its old and new value side by side - plus a way
 * to open the record itself, when it still has a screen to open.
 */
/** The tables an entry's ids are resolved against. Seats are admin-only on
 *  the server; for anyone else a stamp still carries the name beside the id. */
const LOOKUPS = ['warehouses', 'suppliers', 'customers', 'personnel', 'agents', 'trucks', 'products', 'bankAccounts', 'sales', 'purchases', 'deliveries'] as const satisfies readonly TableName[]

const GONE: Partial<Record<TableName, string>> = {
  seats: 'a seat', personnel: 'a person', customers: 'a customer', suppliers: 'a supplier', warehouses: 'a depot',
  agents: 'an agent', trucks: 'a truck', products: 'a product', bankAccounts: 'a bank account',
  sales: 'a sale', purchases: 'a purchase', deliveries: 'a trip',
}

/** The field name whose reference table is this one, so the dialog can name
 *  the record an entry is about through the same resolver as any field. */
const REF_KEY: Partial<Record<string, string>> = {
  sales: 'saleId', purchases: 'purchaseId', deliveries: 'deliveryId', personnel: 'driverId', customers: 'customerId',
  suppliers: 'supplierId', warehouses: 'warehouseId', trucks: 'truckId', agents: 'agentId', products: 'productId', bankAccounts: 'bankAccountId', seats: 'by',
}

type Resolver = (key: string, id: unknown) => string
const ResolverCtx = createContext<Resolver>(() => '(hidden)')

function useResolver(): Resolver {
  const tables = useTables(LOOKUPS)
  const seats = useTable('seats') as Record<string, unknown>[] | undefined
  return (key, id) => {
    if (typeof id !== 'string' || !id) return '(blank)'
    const tbl = displayReferenceFor(key)
    if (!tbl) return '(hidden)'
    const rows = tbl === 'seats' ? seats : (tables?.[tbl as keyof typeof tables] as Record<string, unknown>[] | undefined)
    if (!rows) return tbl === 'seats' ? '(a seat)' : '(not available to you)'
    const found = rows.find((r) => r.id === id)
    if (!found) return `(${GONE[tbl] ?? 'a record'} no longer on file)`
    // Sales, purchases and trips have no name: say what they are instead.
    if (tbl === 'sales' || tbl === 'purchases') {
      return `${tbl === 'sales' ? 'Sale' : 'Purchase'} of ${fmtLiters(Number(found.volumeLiters) || 0)} on ${fmtDate(String(found.date ?? ''))}`
    }
    if (tbl === 'deliveries') return `Trip on ${fmtDate(String(found.scheduleDate ?? ''))}`
    return nameOf(found, id)
  }
}

function HistoryDetail({ row, onClose }: { row: AuditRow; onClose: () => void }) {
  const resolve = useResolver()
  const changes = Object.entries(row.changes ?? {})
  const href = row.action === 'delete' ? null : recordHref(row.tbl, row.recordId)
  const when = new Date(row.at)

  return (
    <ResolverCtx.Provider value={resolve}>
    <Dialog
      open
      title={ACTION_LABELS[row.action] ?? row.action}
      subtitle={[scrub(row), row.action === 'delete' ? '' : resolve(REF_KEY[row.tbl] ?? '', row.recordId)].filter((x) => x && !x.startsWith('(')).join(' · ') || departmentFor(row.tbl)}
      aside={<span className="text-mut">{row.seatName} · {fmtDate(row.at)}, {when.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' })}</span>}
      onClose={onClose}
      width={860}
      rail={
        <>
          <RailSection title="Entry">
            <RailRow label="Who" value={row.seatName} />
            <RailRow label="When" value={`${fmtDate(row.at)} ${when.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' })}`} />
            <RailRow label="Action" value={ACTION_LABELS[row.action] ?? row.action} />
            <RailRow label="Record" value={departmentFor(row.tbl)} />
            <RailRow label="Fields changed" value={changes.length} />
          </RailSection>
          {href ? (
            <RailAside>
              <span className="flex items-center justify-between gap-[8px]">
                <span>Open the record</span>
                <span onClick={onClose}><ModuleLink to={href} destination="the record" /></span>
              </span>
            </RailAside>
          ) : (
            <RailAside>{row.action === 'delete' ? 'The record was deleted, so there is nothing to open.' : 'This kind of record has no screen of its own.'}</RailAside>
          )}
        </>
      }
      footer={<GhostButton onClick={onClose}>Close</GhostButton>}
    >
      <FormSection first>Changes {changes.length > 0 && <span className="ml-[6px] font-normal normal-case tracking-normal text-mut">{changes.length}</span>}</FormSection>
      {changes.length === 0 ? (
        <p className="m-0 font-meta text-[12px] text-mut">
          {row.action === 'create' ? 'A new record - every field is new, so there is nothing to compare.'
            : row.action === 'delete' ? 'The whole record was removed.'
            : 'Nothing field-level was recorded for this entry.'}
        </p>
      ) : (
        <table className="w-full table-fixed border-collapse">
          <thead>
            <tr className="border-b border-linesoft font-meta text-[10.5px] font-semibold uppercase tracking-[.08em] text-faint">
              <th className="pb-[6px] pl-0 text-left font-semibold">Field</th>
              <th className="pb-[6px] text-left font-semibold">Before</th>
              <th className="pb-[6px] pr-0 text-left font-semibold">After</th>
            </tr>
          </thead>
          <tbody>
            {changes.map(([field, [before, after]]) => (
              <tr key={field} className="border-b border-linesoft align-top last:border-b-0">
                <td className="w-[130px] py-[7px] pl-0 pr-[10px] text-[13px] font-semibold text-lab">{labelFor(field)}</td>
                <td className="py-[7px] pr-[10px] text-[13px] text-redtext"><Value k={field} v={before} tone="before" /></td>
                <td className="py-[7px] pr-0 text-[13px] text-tealtext"><Value k={field} v={after} tone="after" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Dialog>
    </ResolverCtx.Provider>
  )
}

/** Keys inside a nested value that say nothing to a person reading it. */
const HOUSEKEEPING = new Set(['id', 'createdAt', 'updatedAt'])
const ISO_DATE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}|$)/

/** One primitive, as a person would write it. */
function plain(v: unknown): string {
  if (v === null || v === undefined || v === '') return '(blank)'
  if (typeof v === 'boolean') return v ? 'yes' : 'no'
  if (typeof v === 'number') return v.toLocaleString('en-PH')
  if (typeof v === 'string' && ISO_DATE.test(v)) return fmtDate(v)
  if (typeof v === 'string') return v.replace(/_/g, ' ')
  return String(v)
}

/**
 * A field's value, before or after, in words rather than JSON. Installments,
 * a checklist, a hauler, a return's resolution - all of these are objects or
 * lists of objects on the record, and "{ amount: 250000, dueDate: … }" is not
 * something a manager should have to read. Each nested object becomes
 * "Label: value" lines; a list of them is numbered.
 */
function Value({ k, v, tone }: { k?: string; v: unknown; tone: 'before' | 'after' }) {
  const resolve = useContext(ResolverCtx)
  // A struck-through paragraph is hard to read; nested "before" values are
  // simply muted, and only a single old value gets the line through it.
  const strike = tone === 'before' ? 'line-through decoration-redf/60' : ''
  const nested = tone === 'before' ? 'text-mut' : ''
  if (Array.isArray(v)) {
    if (v.length === 0) return <span className={strike}>(none)</span>
    if (v.every((x) => typeof x !== 'object' || x === null)) return <span className={strike}>{v.map(plain).join(', ')}</span>
    return (
      <ol className={`m-0 flex list-none flex-col gap-[4px] p-0 ${nested}`}>
        {v.map((item, i) => (
          <li key={i} className="flex gap-[6px]">
            <span className="tnum shrink-0 font-meta text-[11px] text-faint">{i + 1}.</span>
            <span className="min-w-0"><Fields obj={item as Record<string, unknown>} /></span>
          </li>
        ))}
      </ol>
    )
  }
  if (v && typeof v === 'object') return <span className={nested}><Fields obj={v as Record<string, unknown>} /></span>
  // An id is never printed - it is resolved to the record's name, or withheld.
  if (k && isIdField(k) && v !== null && v !== undefined && v !== '') return <span className={strike}>{resolve(k, v)}</span>
  return <span className={strike}>{plain(v)}</span>
}

function Fields({ obj }: { obj: Record<string, unknown> }) {
  const entries = Object.entries(obj).filter(([k, val]) =>
    !HOUSEKEEPING.has(k) && val !== undefined && val !== null && val !== ''
    // A stamp carries both `by` (a seat id) and `byName`: the name is the one
    // to show, so the id line is dropped rather than resolved twice.
    && !(isIdField(k) && `${k}Name` in obj))
  if (entries.length === 0) return <>(blank)</>
  // "Amount 125,000 · Due date Sep 30, 2026 · Status pending" - one line
  // that wraps like a sentence, rather than a column per field.
  return (
    <span className="leading-[1.5]">
      {entries.map(([k, val], i) => (
        <span key={k} className="inline-block">
          {i > 0 && <span className="mx-[5px] text-faint">·</span>}
          <span className="font-meta text-[11px] text-mut">{labelFor(k)}{val && typeof val === 'object' ? ':' : ''}</span>{' '}
          {Array.isArray(val) || (val && typeof val === 'object')
            ? <Value k={k} v={val} tone="after" />
            : <span className="font-medium"><Value k={k} v={val} tone="after" /></span>}
        </span>
      ))}
    </span>
  )
}
