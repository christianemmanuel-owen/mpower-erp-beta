import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, Printer } from 'lucide-react'
import { useTables } from '../../lib/data'
import { repos } from '../../data/repo'
import { useAuth } from '../../lib/auth'
import { useHrConfig } from '../../lib/hrConfig'
import {
  computePayslip, employeeDefaults, r2, recomputeTax, recomputeTotals,
  suggestCutoff, thirteenthMonth,
} from '../../lib/payroll'
import { todayISO, fmtCompactPeso, fmtCurrency, fmtDate, label } from '../../lib/format'
import { InfoTip,
  Card, Chip, DataTable, Field, FormSection, GhostButton, Input, KpiStrip, PrimaryButton,
  Select, Dialog, td, PageSkeleton,
} from '../../components/ui'
import { useToast } from '../../components/Toast'
import PayslipDrawer from './PayslipDrawer'
import { InlineNotice } from '../../components/Notice'
import { printDocument } from '../../lib/printDoc'
import { payslipBlocks, payslipMeta } from '../../lib/payslipDoc'
import type { HrConfig, PaySchedule, Payslip, PayrollRun, Personnel } from '../../data/types'

const peso = (v: number) => fmtCurrency(v).replace('.00', '')

export default function PayrollTab() {
  const { seat } = useAuth()
  const { config } = useHrConfig()
  const data = useTables(['personnel', 'shifts', 'holidays', 'attendance', 'leaves', 'sales', 'payrollRuns'] as const)
  const [openRunId, setOpenRunId] = useState<string | null>(null)
  const [newRunOpen, setNewRunOpen] = useState(false)
  const [thirteenthOpen, setThirteenthOpen] = useState(false)
  const [error, setError] = useState('')

  if (!data) return <PageSkeleton />
  const { personnel, shifts, holidays, attendance, leaves, sales, payrollRuns } = data
  const runs = [...payrollRuns].sort((a, b) => b.periodStart.localeCompare(a.periodStart))
  const openRun = runs.find((x) => x.id === openRunId)

  function buildPayslips(schedule: PaySchedule, periodStart: string, periodEnd: string) {
    const matching = personnel
      .map((p) => ({ raw: p, view: employeeDefaults(p, config) }))
      .filter(({ view }) => view.active && view.paySchedule === schedule)
    const paid = matching.filter(({ view }) => view.baseRate > 0)
    const skipped = matching.filter(({ view }) => view.baseRate === 0)
    const payslips = paid.map(({ raw, view }) =>
      computePayslip({
        employee: raw,
        config,
        shift: shifts.find((s) => s.id === view.shiftId),
        holidays, attendance, leaves, sales,
        periodStart, periodEnd, paySchedule: schedule,
      }),
    )
    return { payslips, skipped: skipped.map(({ view }) => view.name) }
  }

  async function createRun(schedule: PaySchedule, periodStart: string, periodEnd: string) {
    setError('')
    // Every overlapping run, not just the first. `find` returned the newest-starting
    // one, so a stray draft overlapping the same dates hid an already-finalized run
    // behind it and the hard block below never fired - letting someone re-run, and
    // re-pay, a period that was already closed.
    const overlaps = runs.filter((x) => x.paySchedule === schedule && x.periodStart <= periodEnd && x.periodEnd >= periodStart)
    const finalized = overlaps.find((x) => x.status === 'finalized')
    if (finalized) {
      setError(`These dates overlap the finalized ${fmtDate(finalized.periodStart)} – ${fmtDate(finalized.periodEnd)} run.`)
      return
    }
    const draftOverlap = overlaps[0]
    if (draftOverlap && !confirm(`A draft run already covers ${fmtDate(draftOverlap.periodStart)} – ${fmtDate(draftOverlap.periodEnd)}. Create another anyway?`)) return
    const { payslips, skipped } = buildPayslips(schedule, periodStart, periodEnd)
    if (payslips.length === 0) {
      setError(`No active ${label(schedule).toLowerCase()} employees with a pay rate - set rates in the Employees tab first.`)
      return
    }
    const run = await repos.payrollRuns.add({
      periodStart, periodEnd, paySchedule: schedule, status: 'draft', payslips,
      notes: skipped.length > 0 ? `Skipped (no pay rate): ${skipped.join(', ')}` : null,
    })
    setNewRunOpen(false)
    setOpenRunId(run.id)
  }

  async function regenerate(run: PayrollRun) {
    if (!confirm('Recompute every payslip from current attendance, leaves, and rates? Manual edits on this draft will be lost.')) return
    const { payslips, skipped } = buildPayslips(run.paySchedule, run.periodStart, run.periodEnd)
    await repos.payrollRuns.update(run.id, {
      payslips,
      notes: skipped.length > 0 ? `Skipped (no pay rate): ${skipped.join(', ')}` : null,
    })
  }

  if (openRun) {
    return (
      <RunView
        run={openRun}
        personnel={personnel}
        config={config}
        isAdmin={!!seat?.isAdmin}
        onBack={() => setOpenRunId(null)}
        onRegenerate={() => regenerate(openRun)}
      />
    )
  }

  return (
    <>
      {error && <div className="mb-[14px] rounded-[10px] border border-redf/30 bg-redbadge p-3 text-[13px] text-redtext">{error}</div>}

      <Card delay={50}>
        <div className="flex items-center gap-[10px] border-b border-fill2 px-5 py-[14px]">
          <h3 className="m-0 text-[15px] font-semibold">Payroll runs</h3>
          <InfoTip label="How a run works">
            Generate a draft, review and adjust the payslips, then finalize. A
            finalized run is a snapshot: later changes to rates, statutory tables or
            employee records never alter what was already paid.
          </InfoTip>
          <span className="ml-auto flex gap-2">
            <PrimaryButton onClick={() => setThirteenthOpen(true)}>13th month</PrimaryButton>
            <PrimaryButton onClick={() => setNewRunOpen(true)}>+ Run payroll</PrimaryButton>
          </span>
        </div>
        <DataTable
          pageSize={10}
          cols={[
            { label: 'Cutoff' }, { label: 'Schedule' }, { label: 'Employees', align: 'right' },
            { label: 'Gross', align: 'right' }, { label: 'Deductions', align: 'right' },
            { label: 'Net pay', align: 'right' }, { label: 'Status' },
          ]}
          empty="No payroll runs yet - encode attendance for a cutoff, then hit “+ Run payroll”."
        >
          {runs.map((x) => {
            const gross = x.payslips.reduce((s, p) => s + p.grossPay, 0)
            const ded = x.payslips.reduce((s, p) => s + p.totalDeductions, 0)
            return (
              <tr key={x.id} onClick={() => setOpenRunId(x.id)} className="cursor-pointer hover:bg-hovrow">
                <td className={`${td} whitespace-nowrap pl-5 font-semibold`}>{fmtDate(x.periodStart)} – {fmtDate(x.periodEnd)}</td>
                <td className={`${td} whitespace-nowrap text-mut`}>{label(x.paySchedule)}</td>
                <td className={`${td} text-right`}>{x.payslips.length}</td>
                <td className={`${td} whitespace-nowrap text-right`}>{fmtCompactPeso(gross)}</td>
                <td className={`${td} whitespace-nowrap text-right text-mut`}>{fmtCompactPeso(ded)}</td>
                <td className={`${td} whitespace-nowrap text-right font-semibold`}>{fmtCompactPeso(gross - ded)}</td>
                <td className={`${td} whitespace-nowrap pr-5`}>
                  <Chip status={x.status} text={label(x.status)} />
                </td>
              </tr>
            )
          })}
        </DataTable>
      </Card>

      <NewRunForm open={newRunOpen} config={config} onClose={() => setNewRunOpen(false)} onCreate={createRun} />
      <ThirteenthMonth open={thirteenthOpen} runs={payrollRuns} onClose={() => setThirteenthOpen(false)} />
    </>
  )
}

// ---- new run ----------------------------------------------------------------

function NewRunForm({ open, config, onClose, onCreate }: {
  open: boolean
  config: HrConfig
  onClose: () => void
  onCreate: (schedule: PaySchedule, periodStart: string, periodEnd: string) => void
}) {
  const [schedule, setSchedule] = useState<PaySchedule>(config.defaultPaySchedule)
  const [period, setPeriod] = useState(() => suggestCutoff(config.defaultPaySchedule, todayISO()))
  if (!open) return null

  const pick = (s: PaySchedule) => {
    setSchedule(s)
    setPeriod(suggestCutoff(s, todayISO()))
  }

  return (
    <Dialog
      open
      title="Run payroll"
      onClose={onClose}
      width={440}
      footer={
        <>
          <PrimaryButton onClick={() => onCreate(schedule, period.periodStart, period.periodEnd)}>Generate draft</PrimaryButton>
          <GhostButton onClick={onClose}>Cancel</GhostButton>
        </>
      }
    >
      <div className="flex flex-col gap-[14px]">
        <Field label="Pay schedule" hint="Only employees on this schedule are included.">
          <Select value={schedule} onChange={(e) => pick(e.target.value as PaySchedule)}>
            <option value="semi_monthly">Semi-monthly (kinsenas &amp; katapusan)</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-[14px]">
          <Field label="Cutoff start"><Input type="date" value={period.periodStart} onChange={(e) => setPeriod({ ...period, periodStart: e.target.value })} /></Field>
          <Field label="Cutoff end"><Input type="date" value={period.periodEnd} onChange={(e) => setPeriod({ ...period, periodEnd: e.target.value })} /></Field>
        </div>
        <p className="m-0 rounded-[10px] bg-fill2 p-3 text-[12px] leading-[1.5] text-sec">
          The draft computes basic pay, OT, night differential, rest-day and holiday premiums, allowances, and commissions from
          the encoded attendance, leaves, holiday calendar, and fulfilled sales - then SSS, PhilHealth, Pag-IBIG, and BIR
          withholding per the government tables. Everything stays editable until you finalize.
        </p>
      </div>
    </Dialog>
  )
}

// ---- run view ---------------------------------------------------------------

function RunView({ run, personnel, config, isAdmin, onBack, onRegenerate }: {
  run: PayrollRun
  personnel: Personnel[]
  config: HrConfig
  isAdmin: boolean
  onBack: () => void
  onRegenerate: () => void
}) {
  const [openSlip, setOpenSlip] = useState<string | null>(null)
  /** The issues found when Finalize was pressed, held for the confirm dialog. */
  const [finalizing, setFinalizing] = useState<string[] | null>(null)
  // A blocked pop-up is something that just happened, not a state the screen is
  // in - so it goes to the toast channel like every other one-off message,
  // rather than pushing the payroll run down the page until dismissed.
  const setPrintNotice = useToast()
  const draft = run.status === 'draft'
  const gross = run.payslips.reduce((s, p) => s + p.grossPay, 0)
  const ded = run.payslips.reduce((s, p) => s + p.totalDeductions, 0)

  /**
   * Payslip edits are serialised through this queue.
   *
   * Each edit rewrites the WHOLE payslips array, and `run` only refreshes once a
   * refetch lands. Tabbing quickly from Bonus to Cash advance fired the second
   * write from the same pre-edit snapshot as the first, so the bonus silently
   * reverted. Chaining the writes means each one starts from the array the
   * previous one produced.
   */
  const pending = useRef<Promise<unknown>>(Promise.resolve())
  const localSlips = useRef<Payslip[] | null>(null)

  function persistSlip(slip: Payslip) {
    pending.current = pending.current
      .catch(() => {})
      .then(async () => {
        const base = localSlips.current ?? run.payslips
        const next = base.map((p) => (p.employeeId === slip.employeeId ? slip : p))
        localSlips.current = next
        await repos.payrollRuns.update(run.id, { payslips: next })
      })
    return pending.current
  }

  // Once the refetch catches up, drop the local chain state so later edits start
  // from server truth rather than from an ever-growing local copy.
  useEffect(() => { localSlips.current = null }, [run.payslips])

  /** Field edited → recompute (tax unless the tax itself was edited) → persist. */
  function commit(slip: Payslip, editedTax = false) {
    const emp = personnel.find((p) => p.id === slip.employeeId)
    const withholdEnabled = emp ? employeeDefaults(emp, config).statutory.withholdingTax : true
    const next = editedTax ? recomputeTotals(slip) : recomputeTax(slip, config, run.paySchedule, withholdEnabled)
    persistSlip({ ...next })
  }

  /**
   * What is wrong with this run, per employee.
   *
   * These were assembled into a `\n·`-separated string and handed to the
   * browser's confirm box, which renders it in whatever font the OS feels like
   * and cannot be read against the table it is about. Same checks, shown as a
   * list in the app.
   */
  function runIssues() {
    const issues: string[] = []
    for (const p of run.payslips) {
      if (p.baseRate === 0) issues.push(`${p.employeeName} has no pay rate.`)
      if (p.netPay < 0) issues.push(`${p.employeeName} has negative net pay (${peso(p.netPay)}).`)
      if (p.netPay === 0) issues.push(`${p.employeeName} nets nothing.`)
    }
    return issues
  }

  async function finalize() {
    setFinalizing(null)
    await repos.payrollRuns.update(run.id, { status: 'finalized' })
  }

  async function reopen() {
    if (confirm('Reopen this finalized run as a draft?')) await repos.payrollRuns.update(run.id, { status: 'draft' })
  }

  async function removeRun() {
    if (confirm('Delete this draft run? Attendance and leaves are untouched - you can regenerate anytime.')) {
      await repos.payrollRuns.remove(run.id)
      onBack()
    }
  }

  /** One employee's payslip as its own document. */
  function printSlip(slip: Payslip) {
    const ok = printDocument(payslipMeta(slip, run), payslipBlocks(slip, run))
    if (!ok) setPrintNotice('Your browser blocked the print window - allow pop-ups for this site and try again.')
  }

  /** Every payslip in the run, opened one window at a time. Browsers throttle
   * rapid window.open calls, so they are staggered; the first blocked one stops
   * the rest rather than spraying failed popups. */
  function printAll() {
    run.payslips.forEach((slip, i) => {
      window.setTimeout(() => {
        const ok = printDocument(payslipMeta(slip, run), payslipBlocks(slip, run))
        if (!ok && i === 0) {
          setPrintNotice(
            'Your browser blocked the print windows - allow pop-ups for this site, or print payslips one at a time from each row.',
          )
        }
      }, i * 700)
    })
  }

  return (
    <>
      {/* The run's identity reads as a heading with its facts under it, rather
          than a 17px size that exists nowhere else in the type scale with four
          chips trailing along the same line. */}
      <div className="mb-[18px] flex flex-wrap items-end gap-3">
        <span className="min-w-0">
          <button
            type="button"
            onClick={onBack}
            className="mb-[6px] flex cursor-pointer items-center gap-[5px] border-0 bg-transparent p-0 font-meta text-[12px] font-semibold text-mut transition-colors hover:text-ink"
          >
            <ChevronLeft size={13} strokeWidth={2} /> All runs
          </button>
          <h2 className="m-0 flex items-center gap-[10px] text-[20px] font-semibold leading-[1.15] tracking-[-0.01em]">
            {fmtDate(run.periodStart)} – {fmtDate(run.periodEnd)}
            <Chip status={run.status} text={label(run.status)} />
          </h2>
          <p className="m-0 mt-[3px] font-meta text-[12px] text-mut">
            {label(run.paySchedule)} · {run.payslips.length} payslip{run.payslips.length === 1 ? '' : 's'}
          </p>
        </span>
        <span className="ml-auto flex flex-wrap items-center gap-2">
          {/* Was window.print(), which put the navigation, the filters and every
              other employee's pay onto the sheet handed to one person. Each
              payslip is now its own document through printDoc. */}
          <GhostButton onClick={printAll}>Print payslips</GhostButton>
          {draft && <GhostButton onClick={onRegenerate}>Regenerate</GhostButton>}
          {/* Deleting the run sat between Regenerate and Finalize, one button
              away from the thing everybody actually presses. */}
          {draft && (
            <>
              <span aria-hidden className="mx-[2px] h-[20px] w-px bg-line" />
              <GhostButton onClick={removeRun}>Delete draft</GhostButton>
            </>
          )}
          {draft && <PrimaryButton onClick={() => setFinalizing(runIssues())}>Finalize run</PrimaryButton>}
          {!draft && isAdmin && <GhostButton onClick={reopen}>Reopen run</GhostButton>}
        </span>
      </div>

      {run.notes && <InlineNotice className="mb-[14px]">{run.notes}</InlineNotice>}

      <KpiStrip
        delay={60}
        items={[
          { label: 'Employees', value: run.payslips.length },
          { label: 'Gross pay', value: peso(gross) },
          { label: 'Deductions', value: peso(ded) },
          { label: 'Net payout', value: peso(gross - ded) },
        ]}
      />

      <Card delay={120} className="mt-[18px]">
        <div className="flex items-center gap-[10px] border-b border-fill2 px-5 py-[14px]">
          <h3 className="m-0 text-[15px] font-semibold">Payslips</h3>
          <span className="font-meta text-[12px] text-mut">
            {draft ? 'Open a row to review and adjust before finalizing' : 'Finalized - a read-only snapshot'}
          </span>
        </div>
        <DataTable
          cols={[
            { label: 'Employee' }, { label: 'Days', align: 'right' }, { label: 'OT hrs', align: 'right' },
            { label: 'Gross', align: 'right' }, { label: 'Govt + tax', align: 'right' },
            { label: 'Other ded.', align: 'right' }, { label: 'Net pay', align: 'right' }, { label: '' },
          ]}
        >
          {run.payslips.map((p) => {
            const govt = p.deductions.sss + p.deductions.philhealth + p.deductions.pagibig + p.deductions.withholdingTax
            const otherDed = p.totalDeductions - govt
            const otHours = p.days.regularOtHours + p.days.restDayOtHours + p.days.specialDayOtHours + p.days.regularHolidayOtHours
            return (
                <tr
                  key={p.employeeId}
                  onClick={() => setOpenSlip(p.employeeId)}
                  title={`${p.employeeName}'s payslip`}
                  className="cursor-pointer hover:bg-hovrow"
                >
                  <td className={`${td} pl-5`}>
                    <p className="m-0 font-semibold">{p.employeeName}</p>
                    <p className="m-0 text-[12px] text-faint">
                      {label(p.role)} · {p.rateType === 'daily' ? `${peso(p.baseRate)}/day` : `${peso(p.baseRate)}/mo`}
                    </p>
                  </td>
                  <td className={`${td} whitespace-nowrap text-right`}>
                    {p.days.daysWorked}{p.days.paidLeaveDays > 0 ? ` +${p.days.paidLeaveDays} leave` : ''}
                    {p.days.daysAbsent > 0 ? <span className="text-redtext"> −{p.days.daysAbsent} abs</span> : ''}
                  </td>
                  <td className={`${td} text-right`}>{r2(otHours)}</td>
                  <td className={`${td} whitespace-nowrap text-right`}>{peso(p.grossPay)}</td>
                  <td className={`${td} whitespace-nowrap text-right text-mut`}>{peso(govt)}</td>
                  <td className={`${td} whitespace-nowrap text-right text-mut`}>{peso(r2(otherDed))}</td>
                  <td className={`${td} whitespace-nowrap text-right font-semibold`}>{peso(p.netPay)}</td>
                  <td className={`${td} pr-5 text-right`}>
                    <button
                      type="button"
                      onClick={(ev) => { ev.stopPropagation(); printSlip(p) }}
                      title={`Print ${p.employeeName}'s payslip`}
                      aria-label={`Print ${p.employeeName}'s payslip`}
                      className="inline-flex h-[26px] w-[26px] cursor-pointer items-center justify-center rounded-[6px] border-0 bg-transparent text-mut transition-colors hover:bg-fill2 hover:text-ink"
                    >
                      <Printer size={14} strokeWidth={1.8} />
                    </button>
                  </td>
                </tr>
            )
          })}
        </DataTable>
      </Card>

      <PayslipDrawer
        slip={run.payslips.find((p) => p.employeeId === openSlip) ?? null}
        draft={draft}
        onClose={() => setOpenSlip(null)}
        onCommit={commit}
        onPrint={printSlip}
      />

      {/* Finalizing is the one irreversible step on this screen for anyone who
          is not an admin, and it used to be a browser confirm carrying a list
          of employee problems as newline-separated text. */}
      <Dialog
        open={finalizing !== null}
        title="Finalize this run"
        subtitle={`${fmtDate(run.periodStart)} – ${fmtDate(run.periodEnd)} · ${run.payslips.length} payslip${run.payslips.length === 1 ? '' : 's'}`}
        onClose={() => setFinalizing(null)}
        width={560}
        footer={
          <>
            <GhostButton onClick={() => setFinalizing(null)}>Cancel</GhostButton>
            <PrimaryButton onClick={finalize}>
              {finalizing && finalizing.length > 0 ? 'Finalize anyway' : 'Finalize run'}
            </PrimaryButton>
          </>
        }
      >
        <p className="m-0 text-[13px] text-lab">
          The figures lock when a run is finalized. Only an admin can reopen it.
        </p>
        {finalizing && finalizing.length > 0 && (
          <>
            <FormSection>Worth checking first</FormSection>
            <ul className="m-0 list-none p-0">
              {finalizing.map((issue) => (
                <li key={issue} className="border-b border-linesoft py-[7px] text-[13px] font-semibold text-redtext last:border-b-0">
                  {issue}
                </li>
              ))}
            </ul>
          </>
        )}
      </Dialog>

      <PrintSheet run={run} />
    </>
  )
}

// ---- printable payslips -----------------------------------------------------

/** Hidden on screen; @media print shows only this, one payslip per page. */
function PrintSheet({ run }: { run: PayrollRun }) {
  const printLine = (text: string, amount: number) =>
    amount !== 0 && (
      <tr>
        <td style={{ padding: '2px 0' }}>{text}</td>
        <td style={{ padding: '2px 0', textAlign: 'right' }}>{fmtCurrency(amount)}</td>
      </tr>
    )

  return (
    <div className="payslip-print">
      <style>{`
        .payslip-print { display: none; }
        @media print {
          body * { visibility: hidden; }
          .payslip-print { display: block; visibility: visible; position: absolute; left: 0; top: 0; width: 100%; background: #fff; }
          .payslip-print * { visibility: visible; }
          .payslip-page { page-break-after: always; padding: 32px; font-size: 12px; color: #111; }
        }
      `}</style>
      {run.payslips.map((p) => {
        const e = p.earnings
        const d = p.deductions
        return (
          <div key={p.employeeId} className="payslip-page">
            <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'inherit' }}>
              <tbody>
                <tr>
                  <td style={{ fontSize: 16, fontWeight: 700, paddingBottom: 2 }}>MPower Diesel Trading</td>
                  <td style={{ textAlign: 'right', fontSize: 14, fontWeight: 700 }}>PAYSLIP{run.status === 'draft' ? ' (DRAFT)' : ''}</td>
                </tr>
                <tr>
                  <td style={{ paddingBottom: 12, color: '#555' }}>
                    {p.employeeName} · {label(p.role)}
                  </td>
                  <td style={{ textAlign: 'right', paddingBottom: 12, color: '#555' }}>
                    {fmtDate(run.periodStart)} – {fmtDate(run.periodEnd)} · {label(run.paySchedule)}
                  </td>
                </tr>
              </tbody>
            </table>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <tbody>
                <tr>
                  <td style={{ verticalAlign: 'top', width: '50%', paddingRight: 16 }}>
                    <p style={{ margin: '0 0 4px', fontWeight: 700, borderBottom: '1px solid #000', paddingBottom: 2 }}>EARNINGS</p>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <tbody>
                        {printLine(`Basic pay (${p.days.daysWorked} day/s${p.days.paidLeaveDays > 0 ? ` + ${p.days.paidLeaveDays} leave` : ''})`, e.basicPay)}
                        {printLine('Overtime', e.overtimePay)}
                        {printLine('Night differential', e.nightDiffPay)}
                        {printLine('Rest day pay', e.restDayPay)}
                        {printLine('Holiday pay', e.holidayPay)}
                        {printLine('Allowance', e.allowance)}
                        {printLine('Commission', e.commission)}
                        {printLine('Bonus', e.bonus)}
                        {printLine('Incentive', e.incentive)}
                        {e.otherEarnings.map((l, i) => <tr key={i}><td style={{ padding: '2px 0' }}>{l.label || 'Other'}</td><td style={{ padding: '2px 0', textAlign: 'right' }}>{fmtCurrency(l.amount)}</td></tr>)}
                        <tr><td style={{ paddingTop: 6, fontWeight: 700, borderTop: '1px solid #999' }}>GROSS PAY</td><td style={{ paddingTop: 6, fontWeight: 700, textAlign: 'right', borderTop: '1px solid #999' }}>{fmtCurrency(p.grossPay)}</td></tr>
                      </tbody>
                    </table>
                  </td>
                  <td style={{ verticalAlign: 'top', width: '50%', paddingLeft: 16 }}>
                    <p style={{ margin: '0 0 4px', fontWeight: 700, borderBottom: '1px solid #000', paddingBottom: 2 }}>DEDUCTIONS</p>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <tbody>
                        {printLine('SSS', d.sss)}
                        {printLine('PhilHealth', d.philhealth)}
                        {printLine('Pag-IBIG', d.pagibig)}
                        {printLine('Withholding tax', d.withholdingTax)}
                        {printLine(`Late / undertime${p.days.lateUndertimeMinutes > 0 ? ` (${p.days.lateUndertimeMinutes} min)` : ''}`, d.lateUndertime)}
                        {printLine('Absences', d.absences)}
                        {d.otherDeductions.map((l, i) => <tr key={i}><td style={{ padding: '2px 0' }}>{l.label || 'Other'}</td><td style={{ padding: '2px 0', textAlign: 'right' }}>{fmtCurrency(l.amount)}</td></tr>)}
                        <tr><td style={{ paddingTop: 6, fontWeight: 700, borderTop: '1px solid #999' }}>TOTAL DEDUCTIONS</td><td style={{ paddingTop: 6, fontWeight: 700, textAlign: 'right', borderTop: '1px solid #999' }}>{fmtCurrency(p.totalDeductions)}</td></tr>
                      </tbody>
                    </table>
                  </td>
                </tr>
              </tbody>
            </table>
            <p style={{ marginTop: 16, fontSize: 15, fontWeight: 700, textAlign: 'right', borderTop: '2px solid #000', paddingTop: 8 }}>
              NET PAY: {fmtCurrency(p.netPay)}
            </p>
            <table style={{ width: '100%', marginTop: 40 }}>
              <tbody>
                <tr>
                  <td style={{ width: '50%', paddingRight: 24 }}><div style={{ borderTop: '1px solid #000', paddingTop: 4 }}>Prepared by</div></td>
                  <td style={{ width: '50%', paddingLeft: 24 }}><div style={{ borderTop: '1px solid #000', paddingTop: 4 }}>Received by - {p.employeeName}</div></td>
                </tr>
              </tbody>
            </table>
          </div>
        )
      })}
    </div>
  )
}

// ---- 13th month -------------------------------------------------------------

function ThirteenthMonth({ open, runs, onClose }: { open: boolean; runs: PayrollRun[]; onClose: () => void }) {
  const [yr, setYr] = useState(() => new Date().getFullYear())
  const [includeDrafts, setIncludeDrafts] = useState(false)
  if (!open) return null
  const report = thirteenthMonth(runs, yr, includeDrafts)
  const total = report.reduce((s, x) => s + x.amount, 0)

  return (
    <Dialog
      open
      title={`13th month pay · ${yr}`}
      onClose={onClose}
      width={560}
      footer={
        <>
          <span className="text-[13px] text-mut">Total: <b className="text-lab">{peso(total)}</b></span>
          <span className="ml-auto"><GhostButton onClick={onClose}>Close</GhostButton></span>
        </>
      }
    >
      <div className="mb-3 flex items-center gap-3">
        <Select value={String(yr)} onChange={(e) => setYr(Number(e.target.value))}>
          {[...new Set(runs.map((r) => Number(r.periodStart.slice(0, 4))))].sort().reverse().map((y) => <option key={y} value={y}>{y}</option>)}
          {runs.length === 0 && <option value={yr}>{yr}</option>}
        </Select>
        <label className="flex items-center gap-[6px] whitespace-nowrap text-[12px] text-mut">
          <input type="checkbox" checked={includeDrafts} onChange={(e) => setIncludeDrafts(e.target.checked)} />
          include drafts (preview)
        </label>
      </div>
      <p className="m-0 mb-3 text-[12px] leading-[1.5] text-faint">
        PD 851: 1/12 of the basic salary earned within the calendar year, due by December 24. Pay it through a payroll run’s
        Bonus line - amounts up to the ₱90,000 cap (13th month + other benefits combined) can be marked non-taxable.
      </p>
      <DataTable cols={[{ label: 'Employee' }, { label: 'Basic earned (YTD)', align: 'right' }, { label: '13th month', align: 'right' }]} empty="No finalized runs for this year yet.">
        {report.map((x) => (
          <tr key={x.employeeId}>
            <td className={`${td} pl-5 font-semibold`}>{x.employeeName}</td>
            <td className={`${td} text-right`}>{peso(x.basicEarned)}</td>
            <td className={`${td} pr-5 text-right font-semibold`}>{peso(x.amount)}</td>
          </tr>
        ))}
      </DataTable>
    </Dialog>
  )
}
