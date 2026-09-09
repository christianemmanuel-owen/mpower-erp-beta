import { useEffect, useState, type ReactNode } from 'react'
import { Trash2 } from 'lucide-react'
import { useTables } from '../../lib/data'
import { repos } from '../../data/repo'
import { useHrConfig, saveHrConfig } from '../../lib/hrConfig'
import {
  DEFAULT_LEAVE_TYPES, HOLIDAYS_2026, OFFICIAL_PAGIBIG, OFFICIAL_PHILHEALTH,
  OFFICIAL_PREMIUMS, OFFICIAL_SSS, OFFICIAL_WITHHOLDING,
} from '../../data/statutory'
import { label } from '../../lib/format'
import {
  Card, Chip, Dialog, Field, FormSection, GhostButton, Input, PanelNav, PrimaryButton, Select, Switch,
  TabBar, filterCls,
} from '../../components/ui'
import type {
  Holiday, HolidayKind, HrConfig, LeaveType, PaySchedule, PremiumRates, Shift,
  WithholdingBracket,
} from '../../data/types'

type Section = 'shifts' | 'holidays' | 'rules' | 'statutory' | 'leaveTypes'

const sections: { key: Section; title: string }[] = [
  { key: 'shifts', title: 'Shifts' },
  { key: 'holidays', title: 'Holiday calendar' },
  { key: 'rules', title: 'Pay rules' },
  { key: 'statutory', title: 'Government tables' },
  { key: 'leaveTypes', title: 'Leave types' },
]

export default function SetupTab() {
  const [section, setSection] = useState<Section>('shifts')
  const data = useTables(['shifts', 'holidays'] as const)
  if (!data) return null

  return (
    <div className="grid grid-cols-[220px_1fr] items-start gap-[18px]">
      <PanelNav
        items={sections}
        active={section}
        onSelect={setSection}
        note="Only admin seats see this tab. Every rate and table here feeds the payroll math directly."
      />

      <div className="flex flex-col gap-[18px]">
        {section === 'shifts' && <ShiftsSection shifts={data.shifts} />}
        {section === 'holidays' && <HolidaysSection holidays={data.holidays} />}
        {section === 'rules' && <RulesSection />}
        {section === 'statutory' && <StatutorySection />}
        {section === 'leaveTypes' && <LeaveTypesSection />}
      </div>
    </div>
  )
}

// ---- shared bits ------------------------------------------------------------

function SectionCard({ title, sub, right, children }: { title: string; sub?: string; right?: ReactNode; children: ReactNode }) {
  return (
    <Card delay={100}>
      <div className="flex flex-wrap items-center gap-[10px] border-b border-linesoft px-5 py-[12px]">
        <h3 className="m-0 text-[15px] font-semibold">{title}</h3>
        {sub && <span className="font-meta text-[12px] text-mut">{sub}</span>}
        <span className="ml-auto flex items-center gap-2">{right}</span>
      </div>
      <div className="px-5 py-4">{children}</div>
    </Card>
  )
}

function SaveRow({ dirty, saved, onSave, onRestore, restoreLabel, problem }: {
  dirty: boolean
  saved: boolean
  onSave: () => void
  onRestore: () => void
  restoreLabel: string
  /** Blocks the save and says why. Some of these numbers are divisors in the
   * payslip: saving a zero produces Infinity pesos for monthly staff, and for
   * daily staff silently drops every statutory deduction to its floor with
   * nothing on screen to show for it. */
  problem?: string
}) {
  return (
    <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-linesoft pt-4">
      <GhostButton onClick={onRestore}>{restoreLabel}</GhostButton>
      <span className="ml-auto flex items-center gap-3">
        {problem && <span className="font-meta text-[12px] font-semibold text-redtext">{problem}</span>}
        {/* Confirmation, not celebration: a green tick beside a Save button is
            the loudest thing on a page of tax tables. */}
        {saved && !problem && <span className="font-meta text-[12px] text-mut">Saved</span>}
        {/* Genuinely disabled rather than dimmed. It looked unavailable and was
            not: clicking a 50%-opacity button with nothing to save still wrote
            the config and reset everyone else's draft. */}
        <PrimaryButton onClick={onSave} disabled={!dirty || !!problem}>Save changes</PrimaryButton>
      </span>
    </div>
  )
}

/** Local editable copy of one HrConfig slice with save/restore wiring. */
function useConfigDraft<T>(pick: (c: HrConfig) => T, official: T) {
  const { config, record } = useHrConfig()
  const [draft, setDraft] = useState<T>(() => pick(config))
  const [loadedFrom, setLoadedFrom] = useState(record?.updatedAt ?? 'defaults')
  const [saved, setSaved] = useState(false)
  // Refresh the draft when another admin's save lands (record stamp changes).
  const recordStamp = record?.updatedAt ?? 'defaults'
  useEffect(() => {
    if (recordStamp !== loadedFrom) {
      setDraft(pick(config))
      setLoadedFrom(recordStamp)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordStamp])

  const dirty = JSON.stringify(draft) !== JSON.stringify(pick(config))
  async function save(patch: Partial<HrConfig>) {
    await saveHrConfig(record, patch)
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }
  return { draft, setDraft, dirty, saved, save, restore: () => setDraft(official) }
}

/** Every rate and threshold on this page. Digits aligned, no spinners - a
 *  0.01 nudge arrow on a tax bracket is an invitation to a typo. */
function Num({ value, onChange, step = 0.01, min, label: aria }: {
  value: number
  onChange: (v: number) => void
  step?: number
  min?: number
  label?: string
}) {
  return (
    <Input
      type="number" step={step} min={min} aria-label={aria}
      value={String(value)}
      onChange={(e) => onChange(Number(e.target.value))}
      className="nospin tnum"
    />
  )
}

// ---- shifts -----------------------------------------------------------------

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function ShiftsSection({ shifts }: { shifts: Shift[] }) {
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Shift | null>(null)
  const [form, setForm] = useState({ name: '', startTime: '08:00', endTime: '17:00', breakMinutes: 60, restDays: [0] as number[] })
  const [error, setError] = useState('')

  function openNew() {
    setEditing(null)
    setForm({ name: '', startTime: '08:00', endTime: '17:00', breakMinutes: 60, restDays: [0] })
    setFormOpen(true)
  }

  function openEdit(s: Shift) {
    setEditing(s)
    setForm({ name: s.name, startTime: s.startTime, endTime: s.endTime, breakMinutes: s.breakMinutes, restDays: s.restDays })
    setFormOpen(true)
  }

  async function save() {
    if (!form.name.trim()) return setError('The shift needs a name.')
    setError('')
    const data = { ...form, name: form.name.trim(), breakMinutes: Number(form.breakMinutes) || 0 }
    if (editing) await repos.shifts.update(editing.id, data)
    else await repos.shifts.add(data)
    setFormOpen(false)
  }

  async function remove(s: Shift) {
    const personnel = await repos.personnel.all()
    if (personnel.some((p) => p.shiftId === s.id)) {
      setError(`${s.name} is assigned to employees - reassign them first.`)
      return
    }
    if (confirm(`Delete shift “${s.name}”?`)) await repos.shifts.remove(s.id)
  }

  return (
    <SectionCard
      title="Shifts"
      sub="attendance and OT are measured against these windows"
      right={<PrimaryButton onClick={openNew}>+ Add shift</PrimaryButton>}
    >
      {error && <div className="mb-3 rounded-[6px] border border-redf bg-redbadge px-3 py-2 text-[13px] font-semibold text-redtext">{error}</div>}
      {shifts.length === 0 && (
        <p className="py-4 text-center text-[13px] text-faint">
          No shifts yet - employees fall back to 08:00–17:00 with Sundays off. Add shifts to match how your crew actually works.
        </p>
      )}
      {shifts.map((s, i) => (
        <div key={s.id} className={`flex items-center gap-3 py-[11px] text-[13px] ${i < shifts.length - 1 ? 'border-b border-linesoft' : ''}`}>
          <div className="flex-1">
            <p className="m-0 font-semibold">{s.name}</p>
            <p className="m-0 text-[12px] text-faint">
              {s.startTime}–{s.endTime}{s.endTime <= s.startTime ? ' (+1 day)' : ''} · {s.breakMinutes} min break ·
              rest {s.restDays.length > 0 ? s.restDays.map((d) => WEEKDAYS[d]).join(', ') : 'none'}
            </p>
          </div>
          <button onClick={() => openEdit(s)} className="cursor-pointer px-[6px] py-1 text-[11px] font-semibold uppercase text-tealtext hover:underline">Edit</button>
          <button onClick={() => remove(s)} className="cursor-pointer px-[6px] py-1 text-[11px] font-semibold uppercase text-redtext hover:underline">Delete</button>
        </div>
      ))}

      <Dialog
        open={formOpen} title={editing ? `Edit shift - ${editing.name}` : 'New shift'} onClose={() => setFormOpen(false)} width={480}
        footer={
          <>
            <PrimaryButton onClick={save}>Save</PrimaryButton>
            <GhostButton onClick={() => setFormOpen(false)}>Cancel</GhostButton>
          </>
        }
      >
        <div className="flex flex-col gap-[14px]">
          <Field label="Name"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <div className="grid grid-cols-3 gap-[14px]">
            <Field label="Time in"><Input type="time" value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} /></Field>
            <Field label="Time out" hint={form.endTime <= form.startTime ? 'Crosses midnight' : undefined}>
              <Input type="time" value={form.endTime} onChange={(e) => setForm({ ...form, endTime: e.target.value })} />
            </Field>
            <Field label="Break (min)"><Num value={form.breakMinutes} step={5} onChange={(v) => setForm({ ...form, breakMinutes: v })} /></Field>
          </div>
          <Field label="Rest days" hint="Work on these days pays the rest-day premium.">
            <span className="flex gap-[6px]">
              {WEEKDAYS.map((w, d) => {
                const on = form.restDays.includes(d)
                return (
                  <button
                    key={w}
                    type="button"
                    onClick={() => setForm({ ...form, restDays: on ? form.restDays.filter((x) => x !== d) : [...form.restDays, d].sort() })}
                    className={`cursor-pointer rounded-[6px] border px-[10px] py-[6px] font-meta text-[12px] font-semibold transition-colors ${on ? 'border-ink bg-ink text-white' : 'border-inputline bg-white text-lab hover:bg-fill2'}`}
                  >
                    {w}
                  </button>
                )
              })}
            </span>
          </Field>
        </div>
      </Dialog>
    </SectionCard>
  )
}

// ---- holidays ---------------------------------------------------------------

function HolidaysSection({ holidays }: { holidays: Holiday[] }) {
  const years = [...new Set(holidays.map((h) => h.date.slice(0, 4)))].sort()
  const [year, setYear] = useState(() => (years.includes('2026') || years.length === 0 ? '2026' : years[years.length - 1]))
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Holiday | null>(null)
  const [form, setForm] = useState({ date: '', name: '', kind: 'regular' as HolidayKind })

  const inYear = holidays.filter((h) => h.date.startsWith(year)).sort((a, b) => a.date.localeCompare(b.date))
  const byMonth = new Map<string, Holiday[]>()
  for (const h of inYear) {
    const m = h.date.slice(0, 7)
    byMonth.set(m, [...(byMonth.get(m) ?? []), h])
  }
  const monthName = (ym: string) => new Date(`${ym}-01T00:00:00Z`).toLocaleDateString('en-PH', { month: 'long', timeZone: 'UTC' })

  async function loadOfficial() {
    const existing = new Set(holidays.map((h) => h.date + h.name))
    for (const h of HOLIDAYS_2026.filter((x) => !existing.has(x.date + x.name))) await repos.holidays.add(h)
  }

  async function save() {
    if (!form.date || !form.name.trim()) return
    const data = { ...form, name: form.name.trim() }
    if (editing) await repos.holidays.update(editing.id, data)
    else await repos.holidays.add(data)
    setFormOpen(false)
  }

  return (
    <SectionCard
      title="Holiday calendar"
      sub="payroll prices worked and unworked days off this list"
      right={
        <>
          <select value={year} onChange={(e) => setYear(e.target.value)} className={filterCls}>
            {[...new Set([...years, '2026', '2027'])].sort().map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
          <PrimaryButton
            onClick={() => { setEditing(null); setForm({ date: `${year}-01-01`, name: '', kind: 'regular' }); setFormOpen(true) }}
          >
            + Add holiday
          </PrimaryButton>
        </>
      }
    >
      {inYear.length === 0 && (
        <div className="flex flex-col items-center gap-3 py-6">
          <p className="m-0 text-[13px] text-faint">No holidays encoded for {year} yet.</p>
          {year === '2026' && <PrimaryButton onClick={loadOfficial}>Load the official 2026 list (Proclamation 1006)</PrimaryButton>}
        </div>
      )}
      {[...byMonth.entries()].map(([ym, list]) => (
        <div key={ym} className="mb-2">
          <p className="m-0 mb-1 mt-2 text-[11px] font-semibold uppercase tracking-[.05em] text-mut">{monthName(ym)}</p>
          {list.map((h) => (
            <div key={h.id} className="flex items-center gap-3 border-b border-linesoft py-[9px] text-[13px] last:border-b-0">
              <span className="w-[52px] font-semibold tabular-nums">{h.date.slice(5)}</span>
              <span className="flex-1">{h.name}</span>
              <Chip status={h.kind} text={label(h.kind)} />
              <button
                onClick={() => { setEditing(h); setForm({ date: h.date, name: h.name, kind: h.kind }); setFormOpen(true) }}
                className="cursor-pointer px-[6px] py-1 text-[11px] font-semibold uppercase text-tealtext hover:underline"
              >
                Edit
              </button>
              <button
                onClick={() => { if (confirm(`Remove ${h.name}?`)) repos.holidays.remove(h.id) }}
                className="cursor-pointer px-[6px] py-1 text-[11px] font-semibold uppercase text-redtext hover:underline"
              >
                Delete
              </button>
            </div>
          ))}
        </div>
      ))}
      {inYear.length > 0 && year === '2026' && (
        <button onClick={loadOfficial} className="mt-2 cursor-pointer p-0 text-[12px] font-semibold text-tealtext hover:underline">
          Re-add any missing official 2026 holidays
        </button>
      )}
      <p className="m-0 mt-3 border-t border-linesoft pt-3 text-[12px] text-faint">
        Eid’l Fitr and Eid’l Adha are proclaimed separately each year - add them here once the dates are announced.
      </p>

      <Dialog
        open={formOpen} title={editing ? 'Edit holiday' : 'New holiday'} onClose={() => setFormOpen(false)} width={440}
        footer={
          <>
            <PrimaryButton onClick={save}>Save</PrimaryButton>
            <GhostButton onClick={() => setFormOpen(false)}>Cancel</GhostButton>
          </>
        }
      >
        <div className="flex flex-col gap-[14px]">
          <Field label="Date"><Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field>
          <Field label="Name"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Type" hint="Regular: 200% worked / 100% unworked. Special non-working: 130% worked, no work no pay. Special working: ordinary pay.">
            <Select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as HolidayKind })}>
              <option value="regular">Regular holiday</option>
              <option value="special_nonworking">Special non-working day</option>
              <option value="special_working">Special working day</option>
            </Select>
          </Field>
        </div>
      </Dialog>
    </SectionCard>
  )
}

// ---- pay rules --------------------------------------------------------------

const premiumFields: { key: keyof PremiumRates; text: string }[] = [
  { key: 'ordinaryOt', text: 'OT, ordinary day (× hourly)' },
  { key: 'nightDiff', text: 'Night differential 22:00–06:00 (+× hourly)' },
  { key: 'restDay', text: 'Rest day worked (× daily)' },
  { key: 'restDayOt', text: 'OT on rest day (× hourly)' },
  { key: 'specialDay', text: 'Special day worked (× daily)' },
  { key: 'specialDayOt', text: 'OT on special day (× hourly)' },
  { key: 'specialRestDay', text: 'Special day on rest day (× daily)' },
  { key: 'specialRestDayOt', text: 'OT, special on rest day (× hourly)' },
  { key: 'regularHoliday', text: 'Regular holiday worked (× daily)' },
  { key: 'regularHolidayOt', text: 'OT on regular holiday (× hourly)' },
  { key: 'regularHolidayRestDay', text: 'Regular holiday on rest day (× daily)' },
  { key: 'regularHolidayRestDayOt', text: 'OT, holiday on rest day (× hourly)' },
]

function RulesSection() {
  const rules = useConfigDraft(
    (c) => ({ defaultPaySchedule: c.defaultPaySchedule, workdayHours: c.workdayHours, monthlyWorkDays: c.monthlyWorkDays, premiumRates: c.premiumRates }),
    { defaultPaySchedule: 'semi_monthly' as PaySchedule, workdayHours: 8, monthlyWorkDays: 26, premiumRates: OFFICIAL_PREMIUMS },
  )
  const d = rules.draft

  return (
    <SectionCard title="Pay rules" sub="DOLE multipliers and payroll defaults - edit only if company policy differs">
      <FormSection first>Defaults</FormSection>
      <div className="grid grid-cols-3 gap-[14px]">
        <Field label="Default pay schedule">
          <Select value={d.defaultPaySchedule} onChange={(e) => rules.setDraft({ ...d, defaultPaySchedule: e.target.value as PaySchedule })}>
            <option value="semi_monthly">Semi-monthly</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </Select>
        </Field>
        <Field label="Workday hours" hint="Divisor for the hourly rate.">
          <Num value={d.workdayHours} step={0.5} min={0.5} onChange={(v) => rules.setDraft({ ...d, workdayHours: v })} />
        </Field>
        <Field label="Days per month" hint="Turns monthly salaries into a daily rate (PH convention: 26).">
          <Num value={d.monthlyWorkDays} step={1} min={1} onChange={(v) => rules.setDraft({ ...d, monthlyWorkDays: v })} />
        </Field>
      </div>

      <FormSection>Premium multipliers</FormSection>
      <div className="grid grid-cols-2 gap-x-6 gap-y-[10px]">
        {premiumFields.map((p) => (
          <label key={p.key} className="flex items-center gap-3 text-[13px]">
            <span className="flex-1 text-lab">{p.text}</span>
            <span className="w-[90px]">
              <Num value={d.premiumRates[p.key]} onChange={(v) => rules.setDraft({ ...d, premiumRates: { ...d.premiumRates, [p.key]: v } })} />
            </span>
          </label>
        ))}
      </div>

      <SaveRow
        dirty={rules.dirty} saved={rules.saved} onSave={() => rules.save(d)} onRestore={rules.restore}
        restoreLabel="Restore DOLE defaults"
        problem={
          d.workdayHours > 0 && d.monthlyWorkDays > 0
            ? undefined
            : 'Workday hours and days per month must both be above zero - payroll divides by them.'
        }
      />
    </SectionCard>
  )
}

// ---- statutory tables -------------------------------------------------------

function StatutorySection() {
  const stat = useConfigDraft(
    (c) => ({ sss: c.sss, philhealth: c.philhealth, pagibig: c.pagibig, withholding: c.withholding, statutoryDefaults: c.statutoryDefaults }),
    {
      sss: OFFICIAL_SSS, philhealth: OFFICIAL_PHILHEALTH, pagibig: OFFICIAL_PAGIBIG,
      withholding: OFFICIAL_WITHHOLDING,
      statutoryDefaults: { sss: true, philhealth: true, pagibig: true, withholdingTax: true },
    },
  )
  const d = stat.draft
  const [whTab, setWhTab] = useState<keyof typeof d.withholding>('semi_monthly')

  const toggle = (key: keyof typeof d.statutoryDefaults, text: string) => (
    <label className="flex items-center gap-[8px] text-[13px] font-semibold text-lab">
      <input
        type="checkbox"
        checked={d.statutoryDefaults[key]}
        onChange={(e) => stat.setDraft({ ...d, statutoryDefaults: { ...d.statutoryDefaults, [key]: e.target.checked } })}
      />
      {text}
    </label>
  )

  const setBracket = (i: number, patch: Partial<WithholdingBracket>) => {
    const rows = d.withholding[whTab].map((b, j) => (j === i ? { ...b, ...patch } : b))
    stat.setDraft({ ...d, withholding: { ...d.withholding, [whTab]: rows } })
  }

  return (
    <SectionCard title="Government tables" sub="seeded with the official 2026 values - deductions compute straight off these">
      <FormSection first>Deducted by default for new employees</FormSection>
      <div className="grid grid-cols-4 gap-[10px]">
        {toggle('sss', 'SSS')}
        {toggle('philhealth', 'PhilHealth')}
        {toggle('pagibig', 'Pag-IBIG')}
        {toggle('withholdingTax', 'Withholding tax')}
      </div>

      <FormSection>SSS (15% of MSC - 5% employee / 10% employer)</FormSection>
      <div className="grid grid-cols-6 gap-[10px]">
        <Field label="EE rate"><Num value={d.sss.eeRate} onChange={(v) => stat.setDraft({ ...d, sss: { ...d.sss, eeRate: v } })} /></Field>
        <Field label="ER rate"><Num value={d.sss.erRate} onChange={(v) => stat.setDraft({ ...d, sss: { ...d.sss, erRate: v } })} /></Field>
        <Field label="MSC floor"><Num value={d.sss.minMsc} step={500} onChange={(v) => stat.setDraft({ ...d, sss: { ...d.sss, minMsc: v } })} /></Field>
        <Field label="MSC ceiling"><Num value={d.sss.maxMsc} step={500} onChange={(v) => stat.setDraft({ ...d, sss: { ...d.sss, maxMsc: v } })} /></Field>
        <Field label="Bracket step"><Num value={d.sss.step} step={100} onChange={(v) => stat.setDraft({ ...d, sss: { ...d.sss, step: v } })} /></Field>
        <Field label="MPF above"><Num value={d.sss.mpfThresholdMsc} step={500} onChange={(v) => stat.setDraft({ ...d, sss: { ...d.sss, mpfThresholdMsc: v } })} /></Field>
      </div>

      <FormSection>PhilHealth (5% of basic salary, split equally)</FormSection>
      <div className="grid grid-cols-4 gap-[10px]">
        <Field label="Rate"><Num value={d.philhealth.rate} onChange={(v) => stat.setDraft({ ...d, philhealth: { ...d.philhealth, rate: v } })} /></Field>
        <Field label="Salary floor"><Num value={d.philhealth.floor} step={1000} onChange={(v) => stat.setDraft({ ...d, philhealth: { ...d.philhealth, floor: v } })} /></Field>
        <Field label="Salary ceiling"><Num value={d.philhealth.ceiling} step={1000} onChange={(v) => stat.setDraft({ ...d, philhealth: { ...d.philhealth, ceiling: v } })} /></Field>
        <Field label="Employee share"><Num value={d.philhealth.eeShare} onChange={(v) => stat.setDraft({ ...d, philhealth: { ...d.philhealth, eeShare: v } })} /></Field>
      </div>

      <FormSection>Pag-IBIG (2% + 2% on capped fund salary)</FormSection>
      <div className="grid grid-cols-4 gap-[10px]">
        <Field label="EE rate"><Num value={d.pagibig.eeRate} onChange={(v) => stat.setDraft({ ...d, pagibig: { ...d.pagibig, eeRate: v } })} /></Field>
        <Field label="ER rate"><Num value={d.pagibig.erRate} onChange={(v) => stat.setDraft({ ...d, pagibig: { ...d.pagibig, erRate: v } })} /></Field>
        <Field label="Max fund salary"><Num value={d.pagibig.maxFundSalary} step={1000} onChange={(v) => stat.setDraft({ ...d, pagibig: { ...d.pagibig, maxFundSalary: v } })} /></Field>
      </div>

      <FormSection>BIR withholding (TRAIN, 2023 onwards)</FormSection>
      <div className="mb-3">
        <TabBar
          tabs={['daily', 'weekly', 'semi_monthly', 'monthly'] as const}
          active={whTab}
          onChange={setWhTab}
          labels={{ daily: label('daily'), weekly: label('weekly'), semi_monthly: label('semi_monthly'), monthly: label('monthly') }}
        />
      </div>
      <div className="grid grid-cols-3 gap-[10px]">
        <p className="m-0 text-[11px] font-semibold uppercase tracking-[.05em] text-mut">Compensation over (₱)</p>
        <p className="m-0 text-[11px] font-semibold uppercase tracking-[.05em] text-mut">Base tax (₱)</p>
        <p className="m-0 text-[11px] font-semibold uppercase tracking-[.05em] text-mut">Rate on excess</p>
        {d.withholding[whTab].map((b, i) => (
          <div key={i} className="contents">
            <Num value={b.over} step={1} onChange={(v) => setBracket(i, { over: v })} />
            <Num value={b.baseTax} onChange={(v) => setBracket(i, { baseTax: v })} />
            <Num value={b.rate} onChange={(v) => setBracket(i, { rate: v })} />
          </div>
        ))}
      </div>

      <SaveRow dirty={stat.dirty} saved={stat.saved} onSave={() => stat.save(d)} onRestore={stat.restore} restoreLabel="Restore official values" />
    </SectionCard>
  )
}

// ---- leave types ------------------------------------------------------------

function LeaveTypesSection() {
  const lt = useConfigDraft((c) => ({ leaveTypes: c.leaveTypes }), { leaveTypes: DEFAULT_LEAVE_TYPES })
  const d = lt.draft
  const [newLabel, setNewLabel] = useState('')

  const setType = (i: number, patch: Partial<LeaveType>) =>
    lt.setDraft({ leaveTypes: d.leaveTypes.map((t, j) => (j === i ? { ...t, ...patch } : t)) })

  function add() {
    const text = newLabel.trim()
    if (!text) return
    const id = text.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || `type_${d.leaveTypes.length}`
    if (d.leaveTypes.some((t) => t.id === id)) return
    lt.setDraft({ leaveTypes: [...d.leaveTypes, { id, label: text, paid: true }] })
    setNewLabel('')
  }

  return (
    <SectionCard title="Leave types" sub="paid types count as paid days in payroll; entitlements are set per employee">
      {d.leaveTypes.map((t, i) => (
        <div key={t.id} className="flex items-center gap-3 border-b border-linesoft py-[8px] text-[13px] last:border-b-0">
          <Input
            value={t.label}
            aria-label={`Name of ${t.label || 'this leave type'}`}
            onChange={(e) => setType(i, { label: e.target.value })}
            className="!w-[280px]"
          />
          <Switch
            checked={t.paid}
            onChange={(v) => setType(i, { paid: v })}
            label={`${t.label} is paid leave`}
            text="Paid"
          />
          <span className="font-meta text-[12px] text-faint">id: {t.id}</span>
          <button
            type="button"
            onClick={() => lt.setDraft({ leaveTypes: d.leaveTypes.filter((_, j) => j !== i) })}
            aria-label={`Remove ${t.label || 'this leave type'}`}
            className="ml-auto inline-flex h-[26px] w-[26px] cursor-pointer items-center justify-center rounded-[6px] border-0 bg-transparent text-mut transition-colors hover:bg-fill2 hover:text-redtext"
          >
            <Trash2 size={14} strokeWidth={1.8} />
          </button>
        </div>
      ))}
      <div className="mt-3 flex items-center gap-2">
        <Input
          value={newLabel}
          aria-label="New leave type"
          placeholder="New leave type"
          onChange={(e) => setNewLabel(e.target.value)}
          className="!w-[280px]"
        />
        <PrimaryButton onClick={add}>+ Add</PrimaryButton>
      </div>
      <p className="m-0 mt-3 text-[12px] text-faint">
        Removing a type keeps old leave records but new leaves can’t use it. The 5-day Service Incentive Leave is the Labor Code minimum after one year of service.
      </p>
      <SaveRow dirty={lt.dirty} saved={lt.saved} onSave={() => lt.save(d)} onRestore={lt.restore} restoreLabel="Restore defaults" />
    </SectionCard>
  )
}
