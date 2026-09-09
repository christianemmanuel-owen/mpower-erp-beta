import { useState } from 'react'
import { nanoid } from 'nanoid'
import { ChevronDown, ChevronRight, Plus, X } from 'lucide-react'
import { todayISO, addDaysISO, fmtCurrency } from '../lib/format'
import { Input, Select } from './ui'

export interface InstallmentRow {
  id: string
  /** This installment's share of the actual invoice value - principals across the whole
   * plan should sum to the transaction's total price. */
  principal: number
  /** Optional financing charge on top of principal, e.g. 2 for 2%. 0 means no interest. */
  interestPct: number
  dueDate: string // yyyy-MM-dd
  status: string
  /** Per-installment person in charge - only rendered when the host form passes
   * collectorOptions (sales do, purchases don't). Empty = the sale-level default. */
  collectorId?: string
  /** Per-installment receiving account override; empty = the sale-level account. */
  bankAccountId?: string
  /** Not edited here - carried through so saving an edited plan doesn't wipe the
   * collection timestamp Collection screens stamped on it. */
  collectedAt?: string
}

/** The actual money due for an installment once its interest is applied. */
export function installmentTotal(principal: number, interestPct: number): number {
  return Math.round(principal * (1 + interestPct / 100) * 100) / 100
}

export interface InstallmentPreset {
  label: string
  build: () => InstallmentRow[]
}

/** The standard quick-apply templates offered on both the Sale and Purchase forms: pay it all
 * now, a 50/50 split, or equal monthly installments. `termDays` seeds the 50/50 split's two due
 * dates (half the term, then the full term) - falls back to a plain 30-day term when there's no
 * selected customer/supplier yet to read a standing term from. */
export function standardInstallmentPresets({ date, totalPrice, termDays, pendingStatus }: {
  date: string
  totalPrice: number
  termDays?: number
  pendingStatus: string
}): InstallmentPreset[] {
  const term = termDays ?? 30
  const split = (n: number, dueDaysOut: (k: number) => number): InstallmentRow[] => {
    const share = Math.round((totalPrice / n) * 100) / 100
    return Array.from({ length: n }, (_, k) => ({
      id: nanoid(8),
      principal: k === n - 1 ? Math.round((totalPrice - share * (n - 1)) * 100) / 100 : share,
      interestPct: 0,
      dueDate: addDaysISO(date, dueDaysOut(k)),
      status: pendingStatus,
    }))
  }
  return [
    {
      label: 'Full amount (COD)',
      build: () => [{ id: nanoid(8), principal: totalPrice, interestPct: 0, dueDate: date, status: pendingStatus }],
    },
    { label: '50/50 split', build: () => split(2, (k) => (k === 0 ? Math.round(term / 2) : term)) },
    { label: '3 monthly', build: () => split(3, (k) => (k + 1) * 30) },
    { label: '6 monthly', build: () => split(6, (k) => (k + 1) * 30) },
  ]
}

/** Fully custom installment builder shared by the Sale and Purchase forms: each installment is
 * added by hand with its own base amount, optional interest, due date, and status - no forced
 * auto-split. A single row is just the plain "pay/collect it all by this date" case that most
 * transactions still use. Preset buttons and "Split evenly" are conveniences on top, not
 * replacements - every field they fill in stays hand-editable afterward. */
export function InstallmentEditor({ rows, onChange, statusOptions, totalPrice, presets, collectorOptions, bankOptions }: {
  rows: InstallmentRow[]
  onChange: (rows: InstallmentRow[]) => void
  /** statusOptions[0] is the "still open" status a freshly added row starts in. */
  statusOptions: { value: string; label: string }[]
  /** The transaction's total price - installment base amounts should sum to this. Shown as a
   * running check, not a hard block, since a plan can legitimately be mid-edit. */
  totalPrice: number
  /** Quick-apply templates rendered as buttons above the rows (e.g. "Full amount (COD)",
   * "50/50 split"). Each fully replaces the current rows when clicked. */
  presets?: InstallmentPreset[]
  /** Per-row collector picker (sales only). The empty option means "use the sale's default" -
   * the picker stays collapsed behind a per-row toggle so the common case adds no clutter. */
  collectorOptions?: { value: string; label: string }[]
  /** Per-row receiving-account override picker (sales only) - same collapsed treatment. */
  bankOptions?: { value: string; label: string }[]
}) {
  // Rows with an override already set start expanded so the override is never invisible.
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const hasCollectionFields = !!(collectorOptions || bankOptions)
  const isExpanded = (r: InstallmentRow) => expanded[r.id] ?? !!(r.collectorId || r.bankAccountId)
  const principalSum = rows.reduce((s, r) => s + r.principal, 0)
  const diff = Math.round((totalPrice - principalSum) * 100) / 100
  const balanced = Math.abs(diff) < 0.01
  const totalDue = rows.reduce((s, r) => s + installmentTotal(r.principal, r.interestPct), 0)
  const hasInterest = rows.some((r) => r.interestPct > 0)

  function update(id: string, patch: Partial<InstallmentRow>) {
    onChange(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  }
  function remove(id: string) {
    if (rows.length <= 1) return
    onChange(rows.filter((r) => r.id !== id))
  }
  function add() {
    const due = rows[rows.length - 1]?.dueDate ?? todayISO()
    onChange([...rows, { id: nanoid(8), principal: Math.max(diff, 0), interestPct: 0, dueDate: due, status: statusOptions[0].value }])
  }
  /** Redistributes the base amount evenly across whatever rows already exist - due dates,
   * interest rates, and statuses are left exactly as they are. */
  function splitEvenly() {
    const n = rows.length
    if (n === 0) return
    const share = Math.round((totalPrice / n) * 100) / 100
    onChange(rows.map((r, i) => ({
      ...r,
      principal: i === n - 1 ? Math.round((totalPrice - share * (n - 1)) * 100) / 100 : share,
    })))
  }

  /**
   * The plan is tabular data, so it is drawn as a table.
   *
   * It used to be one bordered card per installment holding two rows of
   * unlabelled inputs, identified only by placeholder text - which disappears
   * the moment a value is typed. A filled three-row plan was nine bare numbers
   * with nothing saying which was interest and which was principal, and each
   * card's border made the rows look like separate objects rather than one
   * schedule. Column headings, stated once, do the work all those placeholders
   * were failing to do.
   */
  /**
   * Base amount is the widest column, and the one nobody can afford to have
   * truncated - it was `minmax(0,1.3fr)` competing with a 1fr Due column, which
   * on the narrower panes left about 80px of text room and rendered ₱475,110 as
   * "47…". Due is `auto` now: it is computed text, so it takes exactly what it
   * needs and gives the rest back. Interest holds two digits and Status holds
   * one word, so both were oversized.
   */
  const GRID = 'grid grid-cols-[18px_minmax(104px,1fr)_58px_146px_112px_auto_26px] items-center gap-x-[6px]'

  return (
    // The row template has six fixed or minimum tracks and does not compress
    // past about 610px. The dialog body it lives in is narrower than that once
    // a nav and a rail are beside it, so the plan scrolls sideways in its own
    // box rather than losing its last column off the edge of the page.
    <div className="overflow-x-auto rounded-[8px] border border-line">
      {/* One width for every part of the editor. Without it the rows would set
          the scroll width and the preset bar and the footer would stop short of
          it, ending mid-air as soon as you scrolled right. */}
      <div className="min-w-[620px]">
      {presets && presets.length > 0 && (
        <div className="flex flex-wrap items-center gap-[6px] border-b border-linesoft px-[10px] py-[8px]">
          <span className="mr-[2px] font-meta text-[12px] text-mut">Start from</span>
          {presets.map((p) => (
            <button
              key={p.label} type="button" onClick={() => onChange(p.build())}
              className="cursor-pointer rounded-[6px] border border-inputline bg-white px-[9px] py-[4px] font-meta text-[12px] font-semibold text-lab transition-colors hover:bg-fill2"
            >
              {p.label}
            </button>
          ))}
        </div>
      )}

      {/* nowrap throughout: at the narrower widths this sits in - the approval
          drawer, a laptop - "Base amount" would otherwise wrap to two lines and
          push the header taller than the rows it labels. */}
      <div className={`${GRID} border-b border-linesoft bg-paper px-[10px] py-[6px] font-meta text-[10px] font-semibold uppercase tracking-[.09em] text-faint [&>span]:truncate`}>
        <span />
        <span>Base amount</span>
        <span>Interest</span>
        <span>Due date</span>
        <span>Status</span>
        <span className="text-right">Due</span>
        <span />
      </div>

      {rows.map((r, i) => (
        <div key={r.id} className="border-b border-linesoft last:border-0">
          <div className={`${GRID} px-[10px] py-[7px]`}>
            <span className="tnum text-center font-meta text-[12px] text-faint">{i + 1}</span>
            <Input
              type="number" step="0.01" min={0} className="nospin tnum"
              value={r.principal || ''} onChange={(e) => update(r.id, { principal: Number(e.target.value) })}
            />
            <Input
              type="number" step="0.1" min={0} placeholder="0" className="nospin tnum"
              value={r.interestPct || ''} onChange={(e) => update(r.id, { interestPct: Number(e.target.value) })}
            />
            <Input type="date" value={r.dueDate} onChange={(e) => update(r.id, { dueDate: e.target.value })} />
            <Select value={r.status} onChange={(e) => update(r.id, { status: e.target.value })}>
              {statusOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
            {/* The one number on the row nobody types - what this installment
                actually collects once its interest is on. */}
            <span className="tnum whitespace-nowrap text-right text-[13px] font-semibold text-ink">
              {fmtCurrency(installmentTotal(r.principal, r.interestPct)).replace('.00', '')}
            </span>
            <button
              type="button" onClick={() => remove(r.id)} disabled={rows.length <= 1}
              aria-label={`Remove installment ${i + 1}`}
              title={rows.length <= 1 ? 'A plan requires at least one entry' : 'Remove'}
              className="flex h-[26px] w-[26px] cursor-pointer items-center justify-center rounded-[6px] border-0 bg-transparent text-faint transition-colors hover:bg-fill2 hover:text-redtext disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-faint"
            >
              <X size={14} strokeWidth={2} />
            </button>
          </div>

          {hasCollectionFields && (
            <div className="px-[10px] pb-[8px] pl-[38px]">
              <button
                type="button"
                onClick={() => setExpanded((m) => ({ ...m, [r.id]: !isExpanded(r) }))}
                aria-expanded={isExpanded(r)}
                className="flex cursor-pointer items-center gap-[3px] border-0 bg-transparent p-0 font-meta text-[12px] font-semibold text-sec transition-colors hover:text-ink"
              >
                {isExpanded(r) ? <ChevronDown size={13} strokeWidth={2} /> : <ChevronRight size={13} strokeWidth={2} />}
                {r.collectorId || r.bankAccountId ? 'Overrides applied' : 'Collector and receiving account'}
              </button>
              {isExpanded(r) && (
                <div className="mt-[6px] flex items-center gap-[8px]">
                  {collectorOptions && (
                    <div className="w-0 flex-1">
                      <Select value={r.collectorId ?? ''} onChange={(e) => update(r.id, { collectorId: e.target.value || undefined })}>
                        <option value="">Collector — sale default</option>
                        {collectorOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </Select>
                    </div>
                  )}
                  {bankOptions && (
                    <div className="w-0 flex-1">
                      <Select value={r.bankAccountId ?? ''} onChange={(e) => update(r.id, { bankAccountId: e.target.value || undefined })}>
                        <option value="">Account — sale default</option>
                        {bankOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </Select>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      ))}

      <div className="flex items-center justify-between gap-3 border-t border-linesoft bg-paper px-[10px] py-[7px]">
        <span className="flex shrink-0 items-center gap-[10px] whitespace-nowrap">
          <button
            type="button" onClick={add}
            className="flex cursor-pointer items-center gap-[4px] rounded-[6px] border border-inputline bg-white px-[9px] py-[4px] font-meta text-[12px] font-semibold text-lab transition-colors hover:bg-fill2"
          >
            <Plus size={13} strokeWidth={2} /> Add installment
          </button>
          {rows.length > 1 && (
            <button
              type="button" onClick={splitEvenly}
              className="cursor-pointer border-0 bg-transparent p-0 font-meta text-[12px] font-semibold text-sec transition-colors hover:text-ink"
            >
              Split evenly
            </button>
          )}
        </span>
        {/* The rail says the same thing at a glance; this says it at the point
            of edit, which is where the number is actually being fixed. */}
        <span className="flex items-baseline gap-[10px] whitespace-nowrap">
          {/* With interest on the plan, what is collected is not what was
              agreed - both numbers have to be sayable. */}
          {hasInterest && (
            <span className="tnum font-meta text-[12px] text-mut">
              Total due {fmtCurrency(totalDue).replace('.00', '')}
            </span>
          )}
          <span className={`tnum font-meta text-[12px] ${balanced ? 'text-mut' : 'font-semibold text-redtext'}`}>
            {balanced
              ? `Base total ${fmtCurrency(principalSum).replace('.00', '')}`
              : `${diff > 0 ? 'Short' : 'Over'} by ${fmtCurrency(Math.abs(diff)).replace('.00', '')}`}
          </span>
        </span>
      </div>
      </div>
    </div>
  )
}
