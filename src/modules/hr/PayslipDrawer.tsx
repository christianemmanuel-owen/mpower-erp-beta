import { Trash2 } from 'lucide-react'
import { Dialog, FormSection, GhostButton, Input, PrimaryButton } from '../../components/ui'
import { RailClose, RailRow, RailSection, RailTotal } from '../../components/SummaryRail'
import { fmtCurrency, label } from '../../lib/format'
import { r2 } from '../../lib/payroll'
import type { Payslip } from '../../data/types'

const peso = (v: number) => fmtCurrency(v).replace('.00', '')

/** A money field. 28px like every other in-row control, digits aligned, and no
 *  spinners - nobody nudges a salary by 0.01 with an arrow. */
function Money({ value, disabled, onCommit, label: aria }: {
  value: number
  disabled: boolean
  onCommit: (v: number) => void
  label: string
}) {
  return (
    <Input
      // Keyed on the value so a recomputed figure (tax, when another line
      // changes) replaces what is in the box rather than being ignored as
      // "uncontrolled input already has a value".
      key={value}
      type="number"
      step="0.01"
      aria-label={aria}
      defaultValue={value}
      disabled={disabled}
      onBlur={(e) => {
        const v = r2(Number(e.target.value) || 0)
        if (v !== value) onCommit(v)
      }}
      className="nospin tnum !h-[28px] !w-[120px] text-right disabled:border-transparent disabled:bg-transparent disabled:text-ink"
    />
  )
}

/** One labelled amount, with the arithmetic behind it said underneath. */
function Line({ label: l, note, control }: { label: string; note?: string; control: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 border-b border-linesoft py-[6px] last:border-b-0">
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] text-lab">{l}</span>
        {note && <span className="block font-meta text-[12px] text-faint">{note}</span>}
      </span>
      {control}
    </div>
  )
}

function ExtraLines({ lines, draft, taxable, onChange, addText }: {
  lines: { label: string; amount: number; taxable: boolean }[]
  draft: boolean
  taxable: boolean
  onChange: (lines: { label: string; amount: number; taxable: boolean }[]) => void
  addText: string
}) {
  return (
    <>
      {lines.map((l, i) => (
        <div key={i} className="flex items-center gap-2 border-b border-linesoft py-[6px]">
          <Input
            key={l.label}
            defaultValue={l.label}
            placeholder="What is this line?"
            disabled={!draft}
            aria-label="Line description"
            onBlur={(e) => {
              if (e.target.value !== l.label) onChange(lines.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))
            }}
            className="!h-[28px] min-w-0 flex-1 disabled:border-transparent disabled:bg-transparent"
          />
          {taxable && (
            <label className="flex shrink-0 items-center gap-[5px] font-meta text-[12px] text-mut">
              <input
                type="checkbox"
                checked={l.taxable}
                disabled={!draft}
                className="h-[14px] w-[14px] accent-ink"
                onChange={(e) => onChange(lines.map((x, j) => (j === i ? { ...x, taxable: e.target.checked } : x)))}
              />
              taxable
            </label>
          )}
          <Money
            value={l.amount}
            disabled={!draft}
            label={l.label || 'Amount'}
            onCommit={(v) => onChange(lines.map((x, j) => (j === i ? { ...x, amount: v } : x)))}
          />
          {draft && (
            <button
              type="button"
              onClick={() => onChange(lines.filter((_, j) => j !== i))}
              aria-label={`Remove ${l.label || 'this line'}`}
              className="inline-flex h-[26px] w-[26px] shrink-0 cursor-pointer items-center justify-center rounded-[6px] border-0 bg-transparent text-mut transition-colors hover:bg-fill2 hover:text-redtext"
            >
              <Trash2 size={14} strokeWidth={1.8} />
            </button>
          )}
        </div>
      ))}
      {draft && (
        <div className="pt-[10px]">
          <GhostButton size="sm" onClick={() => onChange([...lines, { label: '', amount: 0, taxable }])}>
            {addText}
          </GhostButton>
        </div>
      )}
    </>
  )
}

/**
 * One payslip, as its own record.
 *
 * It used to open as an extra <tr> inside the payslips table - a two-column
 * editor squeezed into a colspan, with the totals it is about at the bottom of
 * its right-hand column, below the fold. As a drawer the arithmetic sits in the
 * rail where it stays in view while the figure that changes it is being typed,
 * and the same shape as every other record in the app.
 */
export default function PayslipDrawer({ slip, draft, onClose, onCommit, onPrint }: {
  slip: Payslip | null
  draft: boolean
  onClose: () => void
  onCommit: (slip: Payslip, editedTax?: boolean) => void
  onPrint: (slip: Payslip) => void
}) {
  if (!slip) return null

  const e = slip.earnings
  const d = slip.deductions
  const set = (patch: Partial<Payslip['earnings']>) => onCommit({ ...slip, earnings: { ...e, ...patch } })
  const setD = (patch: Partial<Payslip['deductions']>, editedTax = false) =>
    onCommit({ ...slip, deductions: { ...d, ...patch } }, editedTax)

  const otHours = r2(
    slip.days.regularOtHours + slip.days.restDayOtHours
    + slip.days.specialDayOtHours + slip.days.regularHolidayOtHours,
  )
  const govt = d.sss + d.philhealth + d.pagibig + d.withholdingTax

  const taxableToggle = (checked: boolean, onToggle: (v: boolean) => void) => (
    <label className="flex shrink-0 items-center gap-[5px] font-meta text-[12px] text-mut">
      <input
        type="checkbox"
        checked={checked}
        disabled={!draft}
        className="h-[14px] w-[14px] accent-ink"
        onChange={(ev) => onToggle(ev.target.checked)}
      />
      taxable
    </label>
  )

  return (
    <Dialog
      open
      title={slip.employeeName}
      subtitle={`${label(slip.role)} · ${slip.rateType === 'daily' ? `${peso(slip.baseRate)}/day` : `${peso(slip.baseRate)}/month`}`}
      aside={
        <span className="text-right">
          <span className="block font-meta text-[12px] text-mut">{draft ? 'Draft' : 'Finalized'}</span>
          <span className="tnum block text-[13px] font-semibold leading-[1.2]">{peso(slip.netPay)}</span>
        </span>
      }
      onClose={onClose}
      width={960}
      rail={
        <>
          <RailSection title="This payslip">
            <RailRow label="Gross pay" value={peso(slip.grossPay)} />
            <RailRow label="Government + tax" value={`−${peso(r2(govt))}`} />
            <RailRow label="Other deductions" value={`−${peso(r2(slip.totalDeductions - govt))}`} />
            <RailTotal label="Net pay" value={peso(slip.netPay)} />
          </RailSection>

          <RailSection title="What it was computed from">
            <RailRow label="Days worked" value={slip.days.daysWorked} />
            {slip.days.paidLeaveDays > 0 && <RailRow label="Paid leave" value={slip.days.paidLeaveDays} />}
            <RailRow label="Overtime" value={`${otHours} h`} />
            {slip.days.nightDiffHours > 0 && <RailRow label="Night hours" value={`${r2(slip.days.nightDiffHours)} h`} />}
            <RailRow label="Taxable income" value={peso(slip.taxableIncome)} />
            {slip.days.daysAbsent > 0 && (
              <RailClose label="Days absent" tone="bad" value={slip.days.daysAbsent} />
            )}
            {slip.days.lateUndertimeMinutes > 0 && (
              <RailRow label="Late / undertime" value={`${slip.days.lateUndertimeMinutes} min`} />
            )}
          </RailSection>
        </>
      }
      footer={
        <>
          <GhostButton onClick={() => onPrint(slip)}>Print payslip</GhostButton>
          <PrimaryButton onClick={onClose}>Done</PrimaryButton>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-x-6">
        <div className="min-w-0">
          <FormSection first>Earnings</FormSection>
          <Line
            label="Basic pay"
            note={`${slip.days.daysWorked} day(s) worked${slip.days.paidLeaveDays > 0 ? `, ${slip.days.paidLeaveDays} paid leave` : ''}`}
            control={<Money value={e.basicPay} disabled={!draft} label="Basic pay" onCommit={(v) => set({ basicPay: v })} />}
          />
          <Line
            label="Overtime"
            note={`${otHours} OT hour(s), premium rates applied`}
            control={<Money value={e.overtimePay} disabled={!draft} label="Overtime pay" onCommit={(v) => set({ overtimePay: v })} />}
          />
          <Line
            label="Night differential"
            note={slip.days.nightDiffHours > 0 ? `${r2(slip.days.nightDiffHours)} hour(s) between 22:00 and 06:00` : undefined}
            control={<Money value={e.nightDiffPay} disabled={!draft} label="Night differential" onCommit={(v) => set({ nightDiffPay: v })} />}
          />
          <Line
            label="Rest day pay"
            control={<Money value={e.restDayPay} disabled={!draft} label="Rest day pay" onCommit={(v) => set({ restDayPay: v })} />}
          />
          <Line
            label="Holiday pay"
            note={slip.days.unworkedRegularHolidays > 0 ? `includes ${slip.days.unworkedRegularHolidays} unworked regular holiday(s)` : undefined}
            control={<Money value={e.holidayPay} disabled={!draft} label="Holiday pay" onCommit={(v) => set({ holidayPay: v })} />}
          />
          <Line
            label="Allowance"
            note="Non-taxable"
            control={<Money value={e.allowance} disabled={!draft} label="Allowance" onCommit={(v) => set({ allowance: v })} />}
          />
          <Line
            label="Commission"
            note="Auto from fulfilled sales - adjust freely"
            control={<Money value={e.commission} disabled={!draft} label="Commission" onCommit={(v) => set({ commission: v })} />}
          />
          <Line
            label="Bonus"
            control={
              <span className="flex items-center gap-2">
                {taxableToggle(e.bonusTaxable, (v) => set({ bonusTaxable: v }))}
                <Money value={e.bonus} disabled={!draft} label="Bonus" onCommit={(v) => set({ bonus: v })} />
              </span>
            }
          />
          <Line
            label="Incentive"
            control={
              <span className="flex items-center gap-2">
                {taxableToggle(e.incentiveTaxable, (v) => set({ incentiveTaxable: v }))}
                <Money value={e.incentive} disabled={!draft} label="Incentive" onCommit={(v) => set({ incentive: v })} />
              </span>
            }
          />
          <ExtraLines
            lines={e.otherEarnings}
            draft={draft}
            taxable
            onChange={(lines) => set({ otherEarnings: lines })}
            addText="+ Add earning"
          />
        </div>

        <div className="min-w-0">
          <FormSection first>Deductions</FormSection>
          <Line label="SSS" control={<Money value={d.sss} disabled={!draft} label="SSS" onCommit={(v) => setD({ sss: v })} />} />
          <Line label="PhilHealth" control={<Money value={d.philhealth} disabled={!draft} label="PhilHealth" onCommit={(v) => setD({ philhealth: v })} />} />
          <Line label="Pag-IBIG" control={<Money value={d.pagibig} disabled={!draft} label="Pag-IBIG" onCommit={(v) => setD({ pagibig: v })} />} />
          <Line
            label="Withholding tax"
            note={`On ${peso(slip.taxableIncome)} taxable - recomputed when other lines change`}
            control={<Money value={d.withholdingTax} disabled={!draft} label="Withholding tax" onCommit={(v) => setD({ withholdingTax: v }, true)} />}
          />
          <Line
            label="Late / undertime"
            note={slip.days.lateUndertimeMinutes > 0 ? `${slip.days.lateUndertimeMinutes} minute(s)` : undefined}
            control={<Money value={d.lateUndertime} disabled={!draft} label="Late or undertime" onCommit={(v) => setD({ lateUndertime: v })} />}
          />
          <Line
            label="Absences"
            note={slip.rateType === 'daily' ? 'Daily rate: absences simply are not paid' : undefined}
            control={<Money value={d.absences} disabled={!draft} label="Absences" onCommit={(v) => setD({ absences: v })} />}
          />
          <ExtraLines
            lines={d.otherDeductions}
            draft={draft}
            taxable={false}
            onChange={(lines) => setD({ otherDeductions: lines })}
            addText="+ Add deduction"
          />
        </div>
      </div>
    </Dialog>
  )
}
