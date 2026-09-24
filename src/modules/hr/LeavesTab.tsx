import { useEffect, useMemo, useState } from 'react'
import { useTables } from '../../lib/data'
import { repos } from '../../data/repo'
import { usePaged } from '../../lib/paging'
import { useHrConfig } from '../../lib/hrConfig'
import {
  FALLBACK_SHIFT, employeeDefaults, leaveDaysInRange, leaveDaysUsed,
} from '../../lib/payroll'
import { todayISO, fmtDate } from '../../lib/format'
import { Pager, Meter, InfoTip, Card, Chip, DataTable, Dialog, Field, GhostButton, Input, PrimaryButton, Select, filterCls, td, PageSkeleton } from '../../components/ui'
import type { LeaveRecord, Shift } from '../../data/types'

const year = () => new Date().getFullYear()

export default function LeavesTab() {
  const { config } = useHrConfig()
  const data = useTables(['personnel', 'shifts', 'holidays', 'leaves'] as const)
  const [employeeFilter, setEmployeeFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [editing, setEditing] = useState<LeaveRecord | null>(null)
  // Owned here now. It used to be lifted into the module shell and threaded back
  // down through three props, which only made sense while the shell was a tab strip.
  const [balanceSearch, setBalanceSearch] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const onFormOpen = () => setFormOpen(true)
  const onFormClose = () => setFormOpen(false)

  // Derived above the early return below, because usePaged is a hook: calling it
  // after `if (!data) return <PageSkeleton />` runs a different number of hooks before and
  // after the tables load, which React refuses at exactly the moment the data
  // arrives.
  const employees = useMemo(
    () => (data?.personnel ?? [])
      .map((p) => employeeDefaults(p, config))
      .filter((e) => e.active)
      .sort((a, b) => a.name.localeCompare(b.name)),
    [data, config],
  )
  // The balances panel listed every active employee at full height beside a table
  // that pages at ten, so the left column ran several screens past the right one.
  const matchingEmployees = employees.filter((e) => e.name.toLowerCase().includes(balanceSearch.trim().toLowerCase()))
  // Four, not eight: each employee here is a name plus a bar per entitlement, so
  // a row is roughly six lines tall. Eight of them ran well past the records
  // table beside it, which is the scroll this panel was paged to avoid.
  const balancePage = usePaged(matchingEmployees, 4, balanceSearch)
  const balanceRows = balancePage.pageItems

  if (!data) return <PageSkeleton />
  const { personnel, shifts, holidays, leaves } = data
  const shiftOf = (shiftId?: string | null) => shifts.find((s) => s.id === shiftId) ?? (FALLBACK_SHIFT as Shift)
  const typeOf = (id: string) => config.leaveTypes.find((t) => t.id === id)

  const records = leaves
    .filter((l) => !employeeFilter || l.employeeId === employeeFilter)
    .filter((l) => !typeFilter || l.typeId === typeFilter)
    .sort((a, b) => b.dateFrom.localeCompare(a.dateFrom))


  return (
    <>
      <div className="grid grid-cols-[340px_1fr] items-start gap-[18px]">
        <Card delay={50}>
          <div className="border-b border-fill2 px-5 py-[14px]">
            <span className="flex items-center gap-[10px]">
              <h3 className="m-0 text-[15px] font-semibold">Balances · {year()}</h3>
              <InfoTip label="Reading the balances">
                Entitlement minus days used this year. Click a name to filter the
                records below to that employee, and click it again to clear.
              </InfoTip>
            </span>
            <input
              value={balanceSearch}
              onChange={(ev) => setBalanceSearch(ev.target.value)}
              placeholder="Find an employee…"
              className={`mt-[10px] w-full ${filterCls}`}
            />
          </div>
          <div className="px-5 py-2">
            {balanceRows.map((e, i) => {
              const shift = shiftOf(e.shiftId)
              const balances = e.leaveEntitlements
                .map((ent) => {
                  const t = typeOf(ent.typeId)
                  if (!t) return null
                  const used = leaveDaysUsed(leaves, e.id, ent.typeId, year(), holidays, shift)
                  return { t, used, total: ent.daysPerYear }
                })
                .filter((x): x is NonNullable<typeof x> => !!x)
              const selected = employeeFilter === e.id
              return (
                <div
                  key={e.id}
                  onClick={() => setEmployeeFilter(selected ? '' : e.id)}
                  role="button"
                  aria-pressed={selected}
                  title={selected ? 'Click to clear filter' : `Show only ${e.name}’s leaves`}
                  className={`-mx-5 cursor-pointer px-5 py-[10px] transition-colors ${i < balanceRows.length - 1 ? 'border-b border-fill2' : ''} ${selected ? 'bg-tealbadge' : 'hover:bg-hovrow'}`}
                >
                  <p className="m-0 text-[13px] font-semibold">{e.name}</p>
                  {balances.length === 0 ? (
                    <p className="m-0 mt-[3px] text-[12px] text-faint">No entitlements set</p>
                  ) : (
                    <span className="mt-[7px] flex flex-col gap-[7px]">
                      {balances.map(({ t, used, total }) => (
                        <span key={t.id} className="block">
                          <span className="flex items-baseline gap-2 font-meta text-[11px]">
                            <span className="text-mut">{t.label}</span>
                            <span className={`tnum ml-auto font-semibold ${used > total ? 'text-redtext' : 'text-sec'}`}>
                              {Math.max(total - used, 0)}
                              <span className="font-normal text-faint"> of {total} left</span>
                            </span>
                          </span>
                          <Meter value={used} max={total} tone={used > total ? 'alert' : 'accent'} className="mt-[4px]" />
                        </span>
                      ))}
                    </span>
                  )}
                </div>
              )
            })}
            {balanceRows.length === 0 && (
              <p className="py-4 text-center text-[13px] text-faint">
                {balanceSearch ? 'No employee matches that name.' : 'No active employees.'}
              </p>
            )}
          </div>
          <Pager
            page={balancePage.page}
            totalPages={balancePage.totalPages}
            setPage={balancePage.setPage}
            total={balancePage.total}
            pageSize={balancePage.pageSize}
            compact
          />
        </Card>

        <Card delay={100}>
          <div className="flex flex-wrap items-center gap-[10px] border-b border-fill2 px-5 py-[14px]">
            <h3 className="m-0 text-[15px] font-semibold">Leave records</h3>
            <select value={employeeFilter} onChange={(e) => setEmployeeFilter(e.target.value)} className={`ml-auto ${filterCls}`}>
              <option value="">All employees</option>
              {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
            <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className={filterCls}>
              <option value="">All types</option>
              {config.leaveTypes.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
            <PrimaryButton onClick={() => { setEditing(null); onFormOpen() }}>+ Record leave</PrimaryButton>
          </div>
          <DataTable
            pageSize={10}
            resetKey={`${employeeFilter}|${typeFilter}`}
            cols={[{ label: 'Employee' }, { label: 'Dates' }, { label: 'Type' }, { label: 'Days', align: 'right' }, { label: 'Notes' }, { label: '' }]}
            empty="No leaves recorded yet."
          >
            {records.map((l) => {
              const e = employees.find((x) => x.id === l.employeeId)
              const t = typeOf(l.typeId)
              const days = leaveDaysInRange(l, holidays, shiftOf(e?.shiftId)).length
              return (
                <tr key={l.id} onClick={() => { setEditing(l); onFormOpen() }} className="cursor-pointer hover:bg-hovrow">
                  <td className={`${td} pl-5 font-semibold`}>{e?.name ?? personnel.find((p) => p.id === l.employeeId)?.name ?? '—'}</td>
                  <td className={`${td} whitespace-nowrap`}>
                    {fmtDate(l.dateFrom)}{l.dateTo !== l.dateFrom ? ` – ${fmtDate(l.dateTo)}` : ''}
                  </td>
                  <td className={`${td} whitespace-nowrap`}>
                    <Chip status={t?.paid ? 'on_leave' : 'draft'} text={t ? `${t.label}${t.paid ? '' : ' (unpaid)'}` : l.typeId} />
                  </td>
                  <td className={`${td} text-right font-semibold`}>{days}</td>
                  <td className={`${td} max-w-[220px] truncate text-[12px] text-faint`}>{l.notes ?? ''}</td>
                  <td className={`${td} pr-5 text-right`}>
                    <button
                      onClick={(ev) => {
                        ev.stopPropagation()
                        if (confirm('Remove this leave record?')) repos.leaves.remove(l.id)
                      }}
                      className="cursor-pointer rounded-[6px] px-2 py-1 text-[13px] text-faint hover:bg-fill2 hover:text-redtext"
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              )
            })}
          </DataTable>
        </Card>
      </div>

      <LeaveForm open={formOpen} record={editing} onClose={() => { setEditing(null); onFormClose() }} />
    </>
  )
}

function LeaveForm({ open, record, onClose }: { open: boolean; record: LeaveRecord | null; onClose: () => void }) {
  const { config } = useHrConfig()
  const data = useTables(['personnel', 'shifts', 'holidays', 'leaves'] as const)
  const [form, setForm] = useState({ employeeId: '', typeId: '', dateFrom: '', dateTo: '', notes: '' })
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    if (record) {
      setForm({ employeeId: record.employeeId, typeId: record.typeId, dateFrom: record.dateFrom, dateTo: record.dateTo, notes: record.notes ?? '' })
    } else {
      const today = todayISO()
      setForm({ employeeId: '', typeId: config.leaveTypes[0]?.id ?? '', dateFrom: today, dateTo: today, notes: '' })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, record?.id])

  if (!open || !data) return null
  const { personnel, shifts, holidays, leaves } = data
  const employees = personnel.map((p) => employeeDefaults(p, config)).filter((e) => e.active).sort((a, b) => a.name.localeCompare(b.name))
  const emp = employees.find((e) => e.id === form.employeeId)
  const shift = shifts.find((s) => s.id === emp?.shiftId) ?? (FALLBACK_SHIFT as Shift)
  const type = config.leaveTypes.find((t) => t.id === form.typeId)

  const valid = form.employeeId && form.typeId && form.dateFrom && form.dateTo && form.dateFrom <= form.dateTo
  const burnDates = valid ? leaveDaysInRange({ dateFrom: form.dateFrom, dateTo: form.dateTo }, holidays, shift) : []
  const entitlement = emp?.leaveEntitlements.find((x) => x.typeId === form.typeId)?.daysPerYear ?? 0
  const usedAlready = emp
    ? leaveDaysUsed(leaves.filter((l) => l.id !== record?.id), emp.id, form.typeId, year(), holidays, shift)
    : 0
  const remaining = entitlement - usedAlready
  const overdraw = type?.paid ? Math.max(0, burnDates.length - Math.max(remaining, 0)) : 0

  /**
   * Order matters here. This used to delete the record being edited BEFORE asking
   * the overdraw question, so answering "no" re-created it under a fresh id - and a
   * failure anywhere after the delete lost the leave outright, silently, because
   * nothing caught it. Now: ask first, write the replacement first, and only then
   * remove what it replaces. A brief duplicate is visible and fixable; a leave that
   * quietly evaporates is neither.
   */
  async function save() {
    if (!valid || !type) return
    const splitting = overdraw > 0 && type.paid
    if (splitting && !confirm(`${emp?.name} only has ${Math.max(remaining, 0)} ${type.label} day(s) left - the ${overdraw} day(s) over will be recorded as Unpaid. Continue?`)) return

    setError('')
    try {
      if (splitting) {
        const paidDates = burnDates.slice(0, Math.max(remaining, 0))
        const unpaidDates = burnDates.slice(Math.max(remaining, 0))
        if (paidDates.length > 0) {
          await repos.leaves.add({ employeeId: form.employeeId, typeId: form.typeId, dateFrom: paidDates[0], dateTo: paidDates[paidDates.length - 1], notes: form.notes || undefined })
        }
        await repos.leaves.add({
          employeeId: form.employeeId, typeId: 'unpaid',
          dateFrom: unpaidDates[0], dateTo: unpaidDates[unpaidDates.length - 1],
          notes: `${type.label} balance exceeded${form.notes ? ` - ${form.notes}` : ''}`,
        })
        // The original is replaced by the pair above, so it goes last.
        if (record) await repos.leaves.remove(record.id)
      } else if (record) {
        // Not a split: keep the row's identity and history rather than
        // re-creating it, which is what the delete-then-add did.
        await repos.leaves.update(record.id, {
          employeeId: form.employeeId, typeId: form.typeId,
          dateFrom: form.dateFrom, dateTo: form.dateTo, notes: form.notes || null,
        })
      } else {
        await repos.leaves.add({ employeeId: form.employeeId, typeId: form.typeId, dateFrom: form.dateFrom, dateTo: form.dateTo, notes: form.notes || undefined })
      }
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save this leave.')
    }
  }

  return (
    <Dialog
      open
      title={record ? 'Edit leave' : 'Record leave'}
      onClose={onClose}
      width={480}
      footer={
        <>
          <PrimaryButton onClick={save} className={valid ? '' : 'opacity-50'}>Save</PrimaryButton>
          <GhostButton onClick={onClose}>Cancel</GhostButton>
          {error && <span className="text-[12px] font-semibold text-redtext">{error}</span>}
        </>
      }
    >
      <div className="flex flex-col gap-[14px]">
        <Field label="Employee">
          <Select value={form.employeeId} onChange={(e) => setForm({ ...form, employeeId: e.target.value })}>
            <option value="">Choose…</option>
            {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </Select>
        </Field>
        <Field label="Leave type">
          <Select value={form.typeId} onChange={(e) => setForm({ ...form, typeId: e.target.value })}>
            {config.leaveTypes.map((t) => <option key={t.id} value={t.id}>{t.label}{t.paid ? '' : ' (unpaid)'}</option>)}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-[14px]">
          <Field label="From"><Input type="date" value={form.dateFrom} onChange={(e) => setForm({ ...form, dateFrom: e.target.value, dateTo: form.dateTo < e.target.value ? e.target.value : form.dateTo })} /></Field>
          <Field label="To"><Input type="date" value={form.dateTo} onChange={(e) => setForm({ ...form, dateTo: e.target.value })} /></Field>
        </div>
        <Field label="Notes">
          <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Reason, doctor’s note, etc. (optional)" />
        </Field>

        {emp && valid && (
          <div className={`rounded-[10px] p-3 text-[13px] ${overdraw > 0 ? 'border border-redf/30 bg-redbadge text-redtext' : 'bg-fill2 text-sec'}`}>
            Burns <b>{burnDates.length}</b> workday{burnDates.length === 1 ? '' : 's'} (rest days &amp; holidays skipped).
            {type?.paid ? (
              overdraw > 0
                ? <> Only <b>{Math.max(remaining, 0)}</b> {type.label} day(s) left - <b>{overdraw}</b> will be saved as Unpaid.</>
                : <> {type.label} left after saving: <b>{remaining - burnDates.length}</b> of {entitlement}.</>
            ) : (
              <> Unpaid - these days simply won’t be paid.</>
            )}
          </div>
        )}
      </div>
    </Dialog>
  )
}
