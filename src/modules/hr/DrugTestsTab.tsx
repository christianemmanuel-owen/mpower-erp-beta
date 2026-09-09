import { useState } from 'react'
import { useToast } from '../../components/Toast'
import { useTables } from '../../lib/data'
import { repos } from '../../data/repo'
import { ExportButton, InfoTip, MiniDark,
  Card, Chip, DataTable, Field, GhostButton, Input, PrimaryButton, Select, Dialog, td,
} from '../../components/ui'
import { todayISO, fmtDate, label } from '../../lib/format'
import { exportTable } from '../../lib/exportXlsx'
import { isPending } from '../../lib/approvals'
import { compareValues, useSortableTable } from '../../lib/sort'
import type { DrugTest, DrugTestResult, Personnel } from '../../data/types'

/**
 * Annual drug test schedule and results - Exhibit A 1.7.
 *
 * Two things this screen has to do that a plain list would not.
 *
 * It shows who is **due or overdue**, not just what has been recorded. The spec
 * says "annual", so the useful question is "who has not been tested in the last
 * twelve months" - and an employee with no test record at all is the most
 * overdue of everyone, not an absentee from the table. They are listed first.
 *
 * It keeps the **scheduled date and the taken date apart**. A test booked for
 * March and taken in May is a compliance fact worth being able to see; storing
 * one date would erase it.
 */

const YEAR_MS = 365 * 86_400_000

const RESULTS: ReadonlyArray<{ value: DrugTestResult; label: string }> = [
  { value: 'pending', label: 'Awaiting result' },
  { value: 'negative', label: 'Negative' },
  { value: 'positive', label: 'Positive' },
  { value: 'inconclusive', label: 'Inconclusive' },
]

/** Chip tone per result - a negative result is the good outcome here, which is
 * the opposite of what the word suggests, so it gets the green treatment. */
const resultTone = (r: DrugTestResult) =>
  r === 'negative' ? 'collected' : r === 'positive' ? 'failed' : r === 'inconclusive' ? 'watch' : 'pending'

interface Row {
  person: Personnel
  latest: DrugTest | undefined
  /** Days since the last test was taken; null when never tested. */
  daysSince: number | null
  status: 'never' | 'overdue' | 'due_soon' | 'current'
}

export default function DrugTestsTab() {
  const [editing, setEditing] = useState<DrugTest | null>(null)
  const [creatingFor, setCreatingFor] = useState<Personnel | null>(null)
  const toast = useToast()
  const { sort, toggle: toggleSort } = useSortableTable()

  const data = useTables(['personnel', 'drugTests'] as const)
  if (!data) return null
  const { personnel, drugTests } = data

  const now = Date.now()
  const name = (id: string) => personnel.find((p) => p.id === id)?.name ?? '—'

  const rows: Row[] = personnel
    .filter((p) => p.active !== false)
    .map((person) => {
      const taken = drugTests
        .filter((t) => t.employeeId === person.id && t.takenDate)
        .sort((a, b) => (b.takenDate ?? '').localeCompare(a.takenDate ?? ''))
      const latest = taken[0]
      const daysSince = latest?.takenDate
        ? Math.floor((now - Date.parse(latest.takenDate)) / 86_400_000)
        : null
      const status: Row['status'] =
        daysSince === null ? 'never'
          : daysSince > 365 ? 'overdue'
            : daysSince > 305 ? 'due_soon'
              : 'current'
      return { person, latest, daysSince, status }
    })

  // Never-tested first, then longest since a test. This is the order the list is
  // actually read in - nobody opens this screen to admire compliant employees.
  const order: Record<Row['status'], number> = { never: 0, overdue: 1, due_soon: 2, current: 3 }
  const sortAccessors: Record<string, (r: Row) => string | number> = {
    employee: (r) => r.person.name,
    last: (r) => r.latest?.takenDate ?? '',
    result: (r) => r.latest?.result ?? '',
  }
  const sorted = [...rows].sort((a, b) => (sort
    ? compareValues(sortAccessors[sort.key](a), sortAccessors[sort.key](b), sort.dir)
    : order[a.status] - order[b.status] || (b.daysSince ?? 1e9) - (a.daysSince ?? 1e9)))

  const needsAttention = rows.filter((r) => r.status === 'never' || r.status === 'overdue').length
  const upcoming = drugTests
    .filter((t) => !t.takenDate && Date.parse(t.scheduledDate) >= now - 86_400_000)
    .sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate))

  function exportTests() {
    exportTable('drug-tests', 'Drug tests', [
      'Employee', 'Role', 'Last taken', 'Days since', 'Result', 'Provider', 'Status', 'Notes',
    ], sorted.map((r) => [
      r.person.name, r.person.role,
      r.latest?.takenDate ? r.latest.takenDate.slice(0, 10) : '',
      r.daysSince,
      r.latest ? label(r.latest.result) : '',
      r.latest?.provider ?? '',
      label(r.status === 'due_soon' ? 'due soon' : r.status),
      r.latest?.notes ?? '',
    ]))
  }

  return (
    <>

      <div className="mb-[14px] flex items-center gap-[10px]">
        {/* A status line, not a caption - it is the count the screen exists to
            surface. The rule behind it moved into the tip. */}
        <p className="m-0 text-[13px] text-mut">
          {needsAttention > 0
            ? <><b className="text-redtext">{needsAttention}</b> {needsAttention === 1 ? 'employee needs' : 'employees need'} a test</>
            : 'Everyone has been tested within the last year'}
        </p>
        <InfoTip label="When an employee is flagged">
          The requirement is annual. Someone is flagged once {Math.round(YEAR_MS / 86_400_000)} days
          have passed since their last taken test, and immediately if they have never
          been tested. Booked and taken dates are kept apart, so a test scheduled in
          March and taken in May still reads as taken in May.
        </InfoTip>
        <span className="ml-auto"><ExportButton onClick={exportTests} /></span>
      </div>

      {upcoming.length > 0 && (
        <Card className="mb-[18px] px-5 py-4" delay={40}>
          <p className="m-0 mb-2 text-[11px] font-semibold uppercase tracking-wide text-faint">Booked</p>
          <div className="flex flex-wrap gap-x-6 gap-y-1">
            {upcoming.map((t) => (
              <button
                key={t.id}
                onClick={() => setEditing(t)}
                className="cursor-pointer border-0 bg-transparent p-0 text-left text-[13px] hover:underline"
              >
                <span className="font-semibold">{name(t.employeeId)}</span>
                <span className="text-mut"> · {fmtDate(t.scheduledDate)}</span>
              </button>
            ))}
          </div>
        </Card>
      )}

      <Card delay={80}>
        <DataTable
          sort={sort}
          onSort={toggleSort}
          pageSize={12}
          cols={[
            { label: 'Employee', sortKey: 'employee' },
            { label: 'Last taken', sortKey: 'last' },
            { label: 'Result', sortKey: 'result' },
            { label: 'Standing' },
            { label: 'Provider' },
            { label: '' },
          ]}
        >
          {sorted.map((r) => (
            <tr key={r.person.id} className="hover:bg-hovrow">
              <td className={`${td} pl-5`}>
                <p className="m-0 font-semibold">{r.person.name}</p>
                <p className="m-0 text-[12px] capitalize text-faint">{r.person.role}</p>
              </td>
              <td className={`${td} whitespace-nowrap`}>
                {r.latest?.takenDate
                  ? <>
                      <p className="m-0">{fmtDate(r.latest.takenDate)}</p>
                      <p className="m-0 text-[12px] text-faint">{r.daysSince} days ago</p>
                    </>
                  : <span className="text-faint">Never</span>}
              </td>
              {/* Two different facts were sharing one column headed "Result": what
                  the lab said, and whether this employee is compliant. A negative
                  result and being a year overdue are not the same kind of thing. */}
              <td className={td}>
                {r.latest ? <Chip status={resultTone(r.latest.result)} text={label(r.latest.result)} /> : <span className="text-faint">—</span>}
              </td>
              <td className={td}>
                {r.status === 'never' && <Chip status="overdue" text="Never tested" />}
                {r.status === 'overdue' && <Chip status="overdue" text="Overdue" />}
                {r.status === 'due_soon' && <Chip status="watch" text="Due soon" />}
                {r.status === 'current' && <Chip status="active" text="Current" />}
              </td>
              <td className={`${td} text-mut`}>{r.latest?.provider ?? '—'}</td>
              <td className={`${td} pr-5 text-right`}>
                <span className="inline-flex items-center gap-3">
                  {r.latest && <MiniDark onClick={() => setEditing(r.latest as DrugTest)}>Edit</MiniDark>}
                  <MiniDark onClick={() => setCreatingFor(r.person)}>Schedule</MiniDark>
                </span>
              </td>
            </tr>
          ))}
        </DataTable>
      </Card>

      <TestForm
        test={editing}
        person={creatingFor}
        personnel={personnel}
        onClose={() => { setEditing(null); setCreatingFor(null) }}
        onNotice={toast}
      />
    </>
  )
}

function TestForm({ test, person, personnel, onClose, onNotice }: {
  test: DrugTest | null
  person: Personnel | null
  personnel: Personnel[]
  onClose: () => void
  onNotice: (m: string) => void
}) {
  const open = Boolean(test || person)
  const [form, setForm] = useState<Partial<DrugTest>>({})
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Reset when the drawer target changes, not on every render.
  const [key, setKey] = useState('')
  const currentKey = test?.id ?? person?.id ?? ''
  if (currentKey !== key) {
    setKey(currentKey)
    setForm(test ? { ...test } : {
      employeeId: person?.id,
      scheduledDate: todayISO(),
      result: 'pending',
    })
    setError(null)
  }

  if (!open) return null

  const set = (k: keyof DrugTest, v: unknown) => setForm((f) => ({ ...f, [k]: v }))

  async function save() {
    if (!form.employeeId) {
      setError('Select the employee this test is for.')
      return
    }
    if (!form.scheduledDate) {
      setError('Give the date the test is booked for.')
      return
    }
    // A result without a date taken is a result for a test that never happened.
    if (form.result && form.result !== 'pending' && !form.takenDate) {
      setError('Record the date the test was taken before entering a result.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const payload = {
        employeeId: form.employeeId,
        scheduledDate: new Date(form.scheduledDate).toISOString(),
        takenDate: form.takenDate ? new Date(form.takenDate).toISOString() : null,
        result: (form.result ?? 'pending') as DrugTestResult,
        provider: form.provider?.trim() || null,
        notes: form.notes?.trim() || null,
      }
      const result = test
        ? await repos.drugTests.update(test.id, payload)
        : await repos.drugTests.add(payload)
      if (isPending(result)) onNotice(result.message)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t save this test.')
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    if (!test) return
    setSaving(true)
    try {
      await repos.drugTests.remove(test.id)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t delete this test.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog
      open
      title={test ? 'Drug test' : 'Schedule drug test'}
      onClose={onClose}
      width={520}
      footer={
        <>
          {test && (
            <button
              type="button"
              onClick={remove}
              className="cursor-pointer border-0 bg-transparent px-2 text-[12px] font-semibold text-redtext hover:underline"
            >
              Delete
            </button>
          )}
          <span className="flex-1" />
          <GhostButton onClick={onClose}>Cancel</GhostButton>
          <PrimaryButton onClick={save}>{saving ? 'Saving…' : 'Save'}</PrimaryButton>
        </>
      }
    >
      {error && (
        <p className="mb-3 rounded-[6px] border border-redf bg-redbadge px-3 py-2 text-[13px] font-semibold text-redtext">{error}</p>
      )}
      <div className="grid grid-cols-2 gap-x-4 gap-y-[14px]">
        <Field label="Employee" span2>
          <Select value={form.employeeId ?? ''} onChange={(e) => set('employeeId', e.target.value)}>
            <option value="" disabled>Select an employee…</option>
            {personnel.filter((p) => p.active !== false).map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="Scheduled for">
          <Input
            type="date"
            value={(form.scheduledDate ?? '').slice(0, 10)}
            onChange={(e) => set('scheduledDate', e.target.value)}
          />
        </Field>
        <Field label="Date taken" hint="Leave blank while the test is still booked.">
          <Input
            type="date"
            value={(form.takenDate ?? '').slice(0, 10)}
            onChange={(e) => set('takenDate', e.target.value)}
          />
        </Field>
        <Field label="Result">
          <Select value={form.result ?? 'pending'} onChange={(e) => set('result', e.target.value)}>
            {RESULTS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </Select>
        </Field>
        <Field label="Provider">
          <Input value={form.provider ?? ''} placeholder="e.g. Hi-Precision" onChange={(e) => set('provider', e.target.value)} />
        </Field>
        <Field label="Notes" span2>
          <Input value={form.notes ?? ''} onChange={(e) => set('notes', e.target.value)} />
        </Field>
      </div>

    </Dialog>
  )
}
