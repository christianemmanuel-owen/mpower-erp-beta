import { useEffect, useState } from 'react'
import { fetchTable, useTables } from '../../lib/data'
import { repos } from '../../data/repo'
import { useHrConfig } from '../../lib/hrConfig'
import {
  employeeDefaults, pagibigEmployeeMonthly, philhealthEmployeeMonthly, sssEmployeeMonthly,
} from '../../lib/payroll'
import { fmtCurrency, label } from '../../lib/format'
import {
  InfoTip, Avatar, Card, Chip, DataTable, Dialog, Field, FormSection, GhostButton, Input,
  PrimaryButton, Select, Switch, filterCls, td, WIDE_DIALOG, PageSkeleton,
} from '../../components/ui'
import { FormNav, useSectionNav, type FormNavSection } from '../../components/FormNav'
import { RailAside, RailClose, RailRow, RailSection } from '../../components/SummaryRail'
import { InlineNotice } from '../../components/Notice'
import { CREW_ROLES } from '../../data/types'
import type { CommissionRate, PaySchedule, Personnel, PersonnelRole, RateType } from '../../data/types'

const ROLES: PersonnelRole[] = [...CREW_ROLES, 'office', 'sales', 'manager']

export default function EmployeesTab() {
  const { config } = useHrConfig()
  const data = useTables(['personnel', 'agents', 'shifts'] as const)
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState('')
  const [showInactive, setShowInactive] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Personnel | null>(null)
  const [error, setError] = useState('')

  if (!data) return <PageSkeleton />
  const { personnel, agents, shifts } = data

  const employees = personnel
    .map((p) => employeeDefaults(p, config))
    .filter((e) => (showInactive ? true : e.active))
    .filter((e) => !roleFilter || e.role === roleFilter)
    .filter((e) => !search || e.name.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name))


  return (
    <>
      {error && <div className="mb-[14px] rounded-[10px] border border-redf/30 bg-redbadge p-3 text-[13px] text-redtext">{error}</div>}

      <Card delay={50}>
        {/* No "Employees" heading: the page is called Employees, and a card
            inside it saying so again is a line of type that answers a question
            nobody asked. The count is what the header is actually for. */}
        <div className="flex flex-wrap items-center gap-[10px] border-b border-linesoft px-5 py-[12px]">
          <span className="font-meta text-[12px] text-mut">{employees.length} on file</span>
          <InfoTip label="Who is on this list">
            One list for everyone: the crew Trips assigns to deliveries and office
            staff alike. Adding someone here is what makes them available to Trips,
            attendance and payroll.
          </InfoTip>
          <label className="ml-auto flex items-center gap-[6px] text-[12px] text-mut">
            <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
            show inactive
          </label>
          <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} className={filterCls}>
            <option value="">All roles</option>
            {ROLES.map((r) => <option key={r} value={r}>{label(r)}</option>)}
          </select>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filter by name…" className={`w-[170px] ${filterCls}`} />
          <PrimaryButton onClick={() => { setEditing(null); setFormOpen(true) }}>+ Add employee</PrimaryButton>
        </div>
        <DataTable
          pageSize={12}
          resetKey={`${search}|${roleFilter}|${showInactive}`}
          cols={[
            { label: 'Employee' }, { label: 'Rate', align: 'right' }, { label: 'Allowance', align: 'right' },
            { label: 'Schedule' }, { label: 'Shift' }, { label: 'Commission' }, { label: 'Status' },
          ]}
          empty="No employees match this filter."
        >
          {employees.map((e) => {
            const shift = shifts.find((s) => s.id === e.shiftId)
            const agent = agents.find((a) => a.id === e.agentId)
            return (
              <tr key={e.id} onClick={() => { setEditing(personnel.find((p) => p.id === e.id)!); setFormOpen(true) }} className="cursor-pointer hover:bg-hovrow">
                <td className={`${td} pl-5`}>
                  <span className="flex items-center gap-[10px]">
                    <Avatar name={e.name} tint={CREW_ROLES.includes(e.role) ? 'teal' : 'amber'} size={28} />
                    <span>
                      <p className="m-0 font-semibold">{e.name}</p>
                      <p className="m-0 text-[12px] text-faint">{label(e.role)}{e.contactNumber ? ` · ${e.contactNumber}` : ''}</p>
                    </span>
                  </span>
                </td>
                <td className={`${td} whitespace-nowrap text-right font-semibold`}>
                  {e.baseRate > 0
                    ? <>{fmtCurrency(e.baseRate).replace('.00', '')}<span className="font-normal text-faint">/{e.rateType === 'daily' ? 'day' : 'mo'}</span></>
                    : <Chip status="no_rate" text="No rate" />}
                </td>
                <td className={`${td} whitespace-nowrap text-right text-mut`}>{e.allowancePerDay > 0 ? `${fmtCurrency(e.allowancePerDay).replace('.00', '')}/day` : '—'}</td>
                <td className={`${td} whitespace-nowrap text-mut`}>{label(e.paySchedule)}</td>
                <td className={`${td} whitespace-nowrap text-mut`}>{shift ? shift.name : 'Default'}</td>
                <td className={`${td} whitespace-nowrap text-mut`}>
                  {agent && e.commissionRate
                    ? `${agent.name} · ${e.commissionRate.kind === 'per_liter' ? `₱${e.commissionRate.value}/L` : `${e.commissionRate.value}%`}`
                    : '—'}
                </td>
                <td className={`${td} whitespace-nowrap pr-5`}><Chip status={e.active ? 'active' : 'inactive'} text={e.active ? 'Active' : 'Inactive'} /></td>
              </tr>
            )
          })}
        </DataTable>
      </Card>

      <EmployeeForm
        open={formOpen}
        employee={editing}
        agents={agents}
        shifts={shifts}
        onClose={() => setFormOpen(false)}
        onError={setError}
      />
    </>
  )
}

type FormState = Partial<Personnel> & {
  statutory: NonNullable<Personnel['statutory']>
  govIds: NonNullable<Personnel['govIds']>
  leaveEntitlements: NonNullable<Personnel['leaveEntitlements']>
}

function EmployeeForm({ open, employee, agents, shifts, onClose, onError }: {
  open: boolean
  employee: Personnel | null
  agents: { id: string; name: string }[]
  shifts: { id: string; name: string; startTime: string; endTime: string }[]
  onClose: () => void
  onError: (msg: string) => void
}) {
  const { config } = useHrConfig()
  const [form, setForm] = useState<FormState | null>(null)
  /** Said on the field, not on the page behind the dialog - see save(). */
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [confirming, setConfirming] = useState<'delete' | null>(null)
  const [blocked, setBlocked] = useState<string | null>(null)
  const { active: activeSection, jump } = useSectionNav(EMPLOYEE_SECTIONS.map((s) => s.id))

  useEffect(() => {
    if (!open) {
      setForm(null)
      return
    }
    setErrors({})
    setBlocked(null)
    setConfirming(null)
    if (employee) {
      const e = employeeDefaults(employee, config)
      setForm({ ...e, govIds: e.govIds ?? {}, leaveEntitlements: e.leaveEntitlements })
    } else {
      setForm({
        role: 'driver', rateType: 'daily', baseRate: 0, allowancePerDay: 0,
        paySchedule: config.defaultPaySchedule, active: true,
        statutory: { ...config.statutoryDefaults },
        leaveEntitlements: [{ typeId: 'sil', daysPerYear: 5 }],
        govIds: {},
      })
    }
    // config identity changes every render (merged object) - keying on open/employee is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, employee?.id])

  if (!open || !form) return null
  const f = form
  const set = (patch: Partial<FormState>) => setForm((x) => (x ? { ...x, ...patch } : x))
  const commission: CommissionRate = f.commissionRate ?? { kind: 'per_liter', value: 0 }
  const paidTypes = config.leaveTypes.filter((t) => t.paid)

  // What payroll will actually deduct, at the rate typed above. The figures
  // existed only inside computePayslip, so the first time anyone saw the effect
  // of a rate or a toggle was on a payslip in a finalized run.
  const rate = Number(f.baseRate) || 0
  const monthlyBasic = f.rateType === 'monthly' ? rate : rate * config.monthlyWorkDays
  const statutoryPreview = [
    { key: 'sss' as const, label: 'SSS', value: sssEmployeeMonthly(monthlyBasic, config.sss) },
    { key: 'philhealth' as const, label: 'PhilHealth', value: philhealthEmployeeMonthly(monthlyBasic, config.philhealth) },
    { key: 'pagibig' as const, label: 'Pag-IBIG', value: pagibigEmployeeMonthly(monthlyBasic, config.pagibig) },
  ]
  const deducted = statutoryPreview.filter((s) => f.statutory[s.key])
  const deductedTotal = deducted.reduce((s, x) => s + x.value, 0)

  async function save() {
    const bad: Record<string, string> = {}
    if (!String(f.name ?? '').trim()) bad.name = 'The employee needs a name.'
    if (rate < 0) bad.baseRate = 'A rate cannot be negative.'
    if (f.agentId && commission.value <= 0) bad.commission = 'An agent on commission needs a rate, or unlink the agent.'
    setErrors(bad)
    if (Object.keys(bad).length > 0) {
      const firstBad = EMPLOYEE_SECTIONS.find((s) => Object.keys(bad).some((k) => EMPLOYEE_SECTION_OF[k] === s.id))
      if (firstBad) jump(firstBad.id)
      return
    }

    onError('')
    const data: Partial<Personnel> = {
      name: String(f.name).trim(),
      role: f.role as PersonnelRole,
      contactNumber: String(f.contactNumber ?? ''),
      rateType: f.rateType as RateType,
      baseRate: rate,
      allowancePerDay: Number(f.allowancePerDay) || 0,
      paySchedule: f.paySchedule as PaySchedule,
      shiftId: f.shiftId || null,
      hireDate: f.hireDate || null,
      active: !!f.active,
      agentId: f.agentId || null,
      commissionRate: f.agentId && commission.value > 0 ? { kind: commission.kind, value: Number(commission.value) } : null,
      govIds: f.govIds,
      statutory: f.statutory,
      leaveEntitlements: f.leaveEntitlements,
    }
    if (employee) await repos.personnel.update(employee.id, data)
    else await repos.personnel.add(data as never)
    onClose()
  }

  /**
   * Whether this employee can be deleted at all.
   *
   * The answer used to arrive by closing the dialog and writing a sentence onto
   * the page behind it, which is a message shown where the person is not
   * looking. It is answered before the confirmation is offered now, and stays
   * inside the dialog either way.
   */
  async function askDelete() {
    if (!employee) return
    const [deliveries, attendance, leaves, runs] = await Promise.all([
      fetchTable('deliveries'), fetchTable('attendance'), fetchTable('leaves'), fetchTable('payrollRuns'),
    ])
    const used =
      deliveries.some((d) => [d.driverId, d.pahinanteId, d.loaderId, d.guardId].includes(employee.id)) ||
      attendance.some((a) => a.employeeId === employee.id) ||
      leaves.some((l) => l.employeeId === employee.id) ||
      runs.some((r) => r.payslips.some((s) => s.employeeId === employee.id))
    if (used) {
      setBlocked('This employee has trips, attendance, leaves or payslips on record. Mark them inactive instead - the history has to keep pointing at somebody.')
      return
    }
    setConfirming('delete')
  }

  async function remove() {
    if (!employee) return
    setConfirming(null)
    await repos.personnel.remove(employee.id)
    onClose()
  }

  const deductionSwitch = (key: keyof NonNullable<Personnel['statutory']>, text: string) => (
    <Switch
      checked={f.statutory[key]}
      onChange={(v) => set({ statutory: { ...f.statutory, [key]: v } })}
      label={text}
      text={text}
    />
  )

  const navSections: FormNavSection[] = EMPLOYEE_SECTIONS.map((s) => {
    const done = {
      'emp-basics': String(f.name ?? '').trim() !== '',
      'emp-pay': rate > 0,
      'emp-commission': Boolean(f.agentId),
      'emp-government': Object.values(f.govIds).some((v) => (v ?? '') !== ''),
      'emp-leave': f.leaveEntitlements.length > 0,
    }[s.id]
    const bad = Object.keys(errors).some((k) => EMPLOYEE_SECTION_OF[k] === s.id)
    return { id: s.id, title: s.title, state: bad ? 'problem' : done ? 'done' : 'todo' }
  })

  return (
    <Dialog
      open
      title={employee ? employee.name : 'New employee'}
      subtitle={employee
        ? `${label(String(f.role))}${f.active ? '' : ' · Inactive'}`
        : 'Everyone Trips, attendance and payroll can see'}
      onClose={onClose}
      width={WIDE_DIALOG}
      nav={<FormNav sections={navSections} active={activeSection} onJump={jump} />}
      rail={
        <>
          <RailSection title="Pay setup">
            <RailRow
              label={f.rateType === 'monthly' ? 'Monthly salary' : 'Daily rate'}
              value={rate > 0 ? fmtCurrency(rate).replace('.00', '') : '—'}
            />
            {Number(f.allowancePerDay) > 0 && (
              <RailRow label="Allowance / day" value={fmtCurrency(Number(f.allowancePerDay)).replace('.00', '')} />
            )}
            <RailRow label="Paid" value={label(String(f.paySchedule))} />
            {rate <= 0 && <RailAside tone="bad">No rate set - payroll will flag this employee when a run is finalized.</RailAside>}
          </RailSection>

          {/* The toggles below say whether to deduct; this says how much, which
              is the question anyone actually has when they flip one. */}
          <RailSection title="Monthly deductions">
            {deducted.length > 0 ? (
              <>
                {deducted.map((d) => (
                  <RailRow key={d.key} label={d.label} value={fmtCurrency(d.value).replace('.00', '')} />
                ))}
                <RailClose label="Employee share" value={fmtCurrency(deductedTotal).replace('.00', '')} />
                <RailAside>
                  At {fmtCurrency(monthlyBasic).replace('.00', '')} a month
                  {f.rateType === 'daily' ? ` (${config.monthlyWorkDays} working days)` : ''}. Split across the pay schedule on each run.
                </RailAside>
              </>
            ) : (
              <RailAside>Nothing is being deducted for this employee.</RailAside>
            )}
            {!f.statutory.withholdingTax && <RailAside>Income tax is not withheld.</RailAside>}
          </RailSection>
        </>
      }
      footer={
        <>
          {employee && (
            <>
              <GhostButton onClick={askDelete}>Delete employee</GhostButton>
              <span aria-hidden className="mx-[2px] h-[20px] w-px bg-line" />
            </>
          )}
          <GhostButton onClick={onClose}>Cancel</GhostButton>
          <PrimaryButton onClick={save}>{employee ? 'Save changes' : 'Add employee'}</PrimaryButton>
        </>
      }
    >
      {blocked && (
        <div className="mb-3">
          <InlineNotice tone="act">{blocked}</InlineNotice>
        </div>
      )}

      <FormSection first id="emp-basics">Basics</FormSection>
      <div className="grid grid-cols-2 gap-x-4 gap-y-[14px]">
        <Field label="Full name" span2 error={errors.name}>
          <Input value={String(f.name ?? '')} onChange={(e) => set({ name: e.target.value })} />
        </Field>
        <Field label="Role">
          <Select value={String(f.role)} onChange={(e) => set({ role: e.target.value as PersonnelRole })}>
            {ROLES.map((r) => <option key={r} value={r}>{label(r)}</option>)}
          </Select>
        </Field>
        <Field label="Contact number">
          <Input value={String(f.contactNumber ?? '')} onChange={(e) => set({ contactNumber: e.target.value })} />
        </Field>
        <Field label="Hire date">
          <Input type="date" value={String(f.hireDate ?? '')} onChange={(e) => set({ hireDate: e.target.value })} />
        </Field>
        <Field label="Status" hint="Inactive employees stay on record but drop out of attendance and payroll.">
          <Select value={f.active ? 'active' : 'inactive'} onChange={(e) => set({ active: e.target.value === 'active' })}>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </Select>
        </Field>
      </div>

      <FormSection id="emp-pay">Pay</FormSection>
      <div className="grid grid-cols-2 gap-x-4 gap-y-[14px]">
        <Field label="Rate type">
          <Select value={String(f.rateType)} onChange={(e) => set({ rateType: e.target.value as RateType })}>
            <option value="daily">Daily - no work, no pay</option>
            <option value="monthly">Monthly - fixed salary</option>
          </Select>
        </Field>
        <Field label={f.rateType === 'monthly' ? 'Monthly salary (₱)' : 'Daily rate (₱)'} error={errors.baseRate}>
          <Input
            type="number" min={0} className="nospin tnum"
            value={String(f.baseRate ?? 0)}
            onChange={(e) => set({ baseRate: Number(e.target.value) })}
          />
        </Field>
        <Field label="Daily allowance (₱)" hint="Non-taxable; paid per day worked or on paid leave.">
          <Input
            type="number" min={0} className="nospin tnum"
            value={String(f.allowancePerDay ?? 0)}
            onChange={(e) => set({ allowancePerDay: Number(e.target.value) })}
          />
        </Field>
        <Field label="Pay schedule">
          <Select value={String(f.paySchedule)} onChange={(e) => set({ paySchedule: e.target.value as PaySchedule })}>
            <option value="semi_monthly">Semi-monthly (kinsenas &amp; katapusan)</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </Select>
        </Field>
        <Field label="Shift" span2>
          <Select value={String(f.shiftId ?? '')} onChange={(e) => set({ shiftId: e.target.value || undefined })}>
            <option value="">Default (08:00–17:00, Sundays off)</option>
            {shifts.map((s) => <option key={s.id} value={s.id}>{s.name} · {s.startTime}–{s.endTime}</option>)}
          </Select>
        </Field>
      </div>

      <FormSection id="emp-commission">Commission</FormSection>
      <div className="grid grid-cols-2 gap-x-4 gap-y-[14px]">
        <Field label="Linked sales agent" span2 hint="Payroll pre-fills commission from this agent’s fulfilled sales in the cutoff.">
          <Select value={String(f.agentId ?? '')} onChange={(e) => set({ agentId: e.target.value || undefined })}>
            <option value="">Not on commission</option>
            {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </Select>
        </Field>
        {f.agentId && (
          <>
            <Field label="Commission basis">
              <Select
                value={commission.kind}
                onChange={(e) => set({ commissionRate: { ...commission, kind: e.target.value as CommissionRate['kind'] } })}
              >
                <option value="per_liter">₱ per liter sold</option>
                <option value="percent_of_sale">% of sale amount</option>
              </Select>
            </Field>
            <Field label={commission.kind === 'per_liter' ? 'Rate (₱/L)' : 'Rate (%)'} error={errors.commission}>
              <Input
                type="number" step="0.01" min={0} className="nospin tnum"
                value={String(commission.value)}
                onChange={(e) => set({ commissionRate: { ...commission, value: Number(e.target.value) } })}
              />
            </Field>
          </>
        )}
      </div>

      <FormSection id="emp-government">Government</FormSection>
      <div className="grid grid-cols-2 gap-x-4 gap-y-[14px]">
        <Field label="SSS number"><Input value={String(f.govIds.sss ?? '')} onChange={(e) => set({ govIds: { ...f.govIds, sss: e.target.value } })} /></Field>
        <Field label="PhilHealth number"><Input value={String(f.govIds.philhealth ?? '')} onChange={(e) => set({ govIds: { ...f.govIds, philhealth: e.target.value } })} /></Field>
        <Field label="Pag-IBIG MID"><Input value={String(f.govIds.pagibig ?? '')} onChange={(e) => set({ govIds: { ...f.govIds, pagibig: e.target.value } })} /></Field>
        <Field label="TIN"><Input value={String(f.govIds.tin ?? '')} onChange={(e) => set({ govIds: { ...f.govIds, tin: e.target.value } })} /></Field>
      </div>
      {/* Four switches, because these are settings that stay on rather than
          boxes ticked once - and the rail beside them says what each one costs. */}
      <div className="mt-[14px] grid grid-cols-2 gap-[10px]">
        {deductionSwitch('sss', 'Deduct SSS')}
        {deductionSwitch('philhealth', 'Deduct PhilHealth')}
        {deductionSwitch('pagibig', 'Deduct Pag-IBIG')}
        {deductionSwitch('withholdingTax', 'Withhold income tax')}
      </div>

      <FormSection id="emp-leave">Leave entitlements</FormSection>
      <p className="m-0 mb-[12px] font-meta text-[12px] text-mut">Days per year, per paid leave type.</p>
      <div className="grid grid-cols-2 gap-x-4 gap-y-[14px]">
        {paidTypes.map((t) => {
          const ent = f.leaveEntitlements.find((x) => x.typeId === t.id)
          return (
            <Field key={t.id} label={t.label}>
              <Input
                type="number" min={0} className="nospin tnum"
                value={String(ent?.daysPerYear ?? 0)}
                onChange={(e) => {
                  const days = Number(e.target.value) || 0
                  const rest = f.leaveEntitlements.filter((x) => x.typeId !== t.id)
                  set({ leaveEntitlements: days > 0 ? [...rest, { typeId: t.id, daysPerYear: days }] : rest })
                }}
              />
            </Field>
          )
        })}
      </div>

      {/* Deleting a person is not a thing to confirm in a browser dialog that
          renders outside the app and cannot say what is at stake. */}
      <Dialog
        open={confirming === 'delete'}
        title={`Delete ${employee?.name ?? 'this employee'}?`}
        subtitle="This cannot be undone."
        onClose={() => setConfirming(null)}
        width={480}
        footer={
          <>
            <GhostButton onClick={() => setConfirming(null)}>Cancel</GhostButton>
            <PrimaryButton onClick={remove}>Delete</PrimaryButton>
          </>
        }
      >
        <p className="m-0 text-[13px] text-lab">
          They have no trips, attendance, leaves or payslips on record, so nothing else points at them.
          If you only want them off attendance and payroll, set their status to Inactive instead.
        </p>
      </Dialog>
    </Dialog>
  )
}

const EMPLOYEE_SECTIONS = [
  { id: 'emp-basics', title: 'Basics' },
  { id: 'emp-pay', title: 'Pay' },
  { id: 'emp-commission', title: 'Commission' },
  { id: 'emp-government', title: 'Government' },
  { id: 'emp-leave', title: 'Leave' },
] as const

/** Which section a message belongs to, so the nav can mark it and Save can jump. */
const EMPLOYEE_SECTION_OF: Record<string, string> = {
  name: 'emp-basics',
  baseRate: 'emp-pay',
  commission: 'emp-commission',
}
