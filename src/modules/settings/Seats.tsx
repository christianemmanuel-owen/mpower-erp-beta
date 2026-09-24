import { useState } from 'react'
import { useTable, useTables } from '../../lib/data'
import { ApiError } from '../../lib/api'
import { repos } from '../../data/repo'
import { CREW_ROLES, type Agent, type ModuleKey, type Personnel, type Seat } from '../../data/types'
import { FIELD_PAGES, FIELD_TASKS_PAGE, MODULES, useAuth } from '../../lib/auth'
import { label as labelOf } from '../../lib/format'
import { RailAside, RailSection } from '../../components/SummaryRail'
import {
  Avatar, Card, Chip, Dialog, Field, FormSection, GhostButton, InfoTip, Input, PrimaryButton, Select, WIDE_DIALOG, RowAction,
} from '../../components/ui'

/**
 * Seats, set up by answering what kind of seat it is.
 *
 * The form used to ask for the parts and leave the assembly to you: eight module
 * checkboxes, an admin toggle, and - once field seats existed - an employee link
 * and a scope picker, with nothing saying which combinations mean anything. A
 * crew login is modules=['logistics'] + scope='own' + a personnel id, and every
 * one of those three had to be got right separately or the person signed in to
 * an empty app.
 *
 * So the question is the job, and the machinery follows. The kinds are the
 * dialog's nav - picking one is the first and largest decision - the details sit
 * in the middle, and the right-hand column draws the app the seat produces: the
 * rail they get, the screen they land on, what the server will and will not let
 * them do. A seat is four settings that only mean something together, and until
 * you can see what they add up to, the only way to check one was to sign in as
 * them. The modules stay adjustable underneath for the cases the presets do not
 * cover.
 */

type Kind = 'admin' | 'office' | 'treasurer' | 'crew' | 'agent' | 'collector'

interface KindDef {
  key: Kind
  title: string
  /** One line, in the nav, for telling the five apart at a glance. */
  short: string
  modules: ModuleKey[]
  scope: 'own' | 'all'
  isAdmin: boolean
  /** Which employees can hold this seat, when it is one person's login. */
  roles?: readonly string[]
}

const KINDS: KindDef[] = [
  {
    key: 'admin',
    title: 'Administrator',
    short: 'All modules and seat management',
    modules: [], scope: 'all', isAdmin: true,
  },
  {
    key: 'office',
    title: 'Office staff',
    short: 'Full access to assigned modules',
    modules: ['dashboard'], scope: 'all', isAdmin: false,
  },
  {
    // An office seat, not a field one: Treasury sees every collector's in-hand
    // items, so it cannot be scoped to one person's records. A preset rather
    // than "Office staff + tick Treasury" because it is the other half of the
    // Collector preset, and the whole point is that the two are different
    // people - the seat list should show that at a glance.
    key: 'treasurer',
    title: 'Treasurer',
    short: 'Deposits, clearing and supplier payments',
    modules: ['treasury'], scope: 'all', isAdmin: false,
  },
  {
    key: 'crew',
    title: 'Crew',
    short: 'Driver or pahinante',
    modules: ['logistics'], scope: 'own', isAdmin: false,
    roles: CREW_ROLES,
  },
  {
    key: 'agent',
    title: 'Sales agent',
    short: 'Own sales only',
    modules: ['sales'], scope: 'own', isAdmin: false,
    roles: ['sales'],
  },
  {
    key: 'collector',
    title: 'Collector',
    short: 'Assigned installments only',
    modules: ['collection'], scope: 'own', isAdmin: false,
  },
]

const kindOf = (s: Seat): Kind => {
  if (s.isAdmin) return 'admin'
  if (s.scope !== 'own') return s.modules.includes('treasury') && s.modules.every((m) => m === 'treasury') ? 'treasurer' : 'office'
  if (s.modules.includes('logistics')) return 'crew'
  if (s.modules.includes('collection')) return 'collector'
  return 'agent'
}

interface SeatForm {
  kind: Kind
  name: string
  username: string
  role: string
  password: string
  modules: ModuleKey[]
  personnelId: string
  /**
   * The Agent record the chosen employee sells under.
   *
   * Not a property of the seat - it lives on the Personnel row - but it is asked
   * for here because here is where its absence bites. A sales seat whose
   * employee has no agent behind them signs in to a screen that cannot file
   * anything: `Sale.agentId` points at an Agent, a login points at Personnel,
   * and `Personnel.agentId` is the only bridge. The form used to let you build
   * exactly that seat and say nothing.
   */
  agentId: string
}

const emptyForm = (): SeatForm => ({
  kind: 'office', name: '', username: '', role: '', password: '',
  modules: ['dashboard'], personnelId: '', agentId: '',
})

/** "Reyes, Ramon" and "Ramon Reyes" both want to be r.reyes. */
function suggestUsername(name: string, taken: Set<string>): string {
  const parts = name.toLowerCase().replace(/[^a-z\s.-]/g, '').split(/\s+/).filter(Boolean)
  if (parts.length === 0) return ''
  const base = parts.length === 1
    ? parts[0]
    : `${parts[0][0]}.${parts[parts.length - 1]}`
  if (!taken.has(base)) return base
  for (let n = 2; n < 50; n++) if (!taken.has(`${base}${n}`)) return `${base}${n}`
  return base
}

/** Something sayable over the phone, not something they will write on a sticky
 *  note because it cannot be read aloud. */
function suggestPassword(): string {
  const words = ['river', 'copper', 'lantern', 'harbor', 'mango', 'anchor', 'pebble', 'saddle', 'orchid', 'timber']
  const w = () => words[Math.floor(Math.random() * words.length)]
  return `${w()}-${w()}-${Math.floor(10 + Math.random() * 89)}`
}

export default function Seats() {
  const { seat: me } = useAuth()
  const seats = useTable('seats')
  const staff = useTables(['personnel', 'agents'] as const)
  const [formOpen, setFormOpen] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState<SeatForm>(emptyForm)
  const [showModules, setShowModules] = useState(false)
  const [error, setError] = useState('')
  const [deleting, setDeleting] = useState<Seat | null>(null)

  const people = (staff?.personnel ?? []).filter((p) => p.active !== false)
  const agents = staff?.agents ?? []
  const def = KINDS.find((k) => k.key === form.kind)!
  const takenNames = new Set((seats ?? []).filter((s) => s.id !== editId).map((s) => s.username.toLowerCase()))
  const personName = (id?: string) => people.find((p) => p.id === id)?.name

  function openNew() {
    setEditId(null)
    setForm(emptyForm())
    setShowModules(false)
    setError('')
    setFormOpen(true)
  }

  function openEdit(s: Seat) {
    const kind = kindOf(s)
    setEditId(s.id)
    setForm({
      kind, name: s.name, username: s.username, role: s.role, password: '',
      modules: s.modules, personnelId: s.personnelId ?? '',
      agentId: people.find((p) => p.id === s.personnelId)?.agentId ?? '',
    })
    // Opened already showing the modules when they are not this kind's default,
    // so an existing seat never hides a setting somebody deliberately chose.
    setShowModules(JSON.stringify([...s.modules].sort()) !== JSON.stringify([...KINDS.find((k) => k.key === kind)!.modules].sort()))
    setError('')
    setFormOpen(true)
  }

  /** Choosing the job sets the machinery behind it. */
  function chooseKind(kind: Kind) {
    const next = KINDS.find((k) => k.key === kind)!
    setForm((f) => {
      const prev = KINDS.find((k) => k.key === f.kind)
      return {
        ...f,
        kind,
        modules: next.modules,
        // A field seat that keeps an office seat's employee link would be somebody
        // else's trips; an office seat has no business holding one at all.
        personnelId: next.scope === 'own' ? f.personnelId : '',
        agentId: next.key === 'agent' ? f.agentId : '',
        // The role label follows the seat type until somebody types their own.
        // Without the `prev` check, switching Crew → Sales agent left "Crew".
        role: f.role === '' || f.role === prev?.title ? next.title : f.role,
      }
    })
    setShowModules(false)
  }

  function setName(name: string) {
    setForm((f) => ({
      ...f,
      name,
      // Only while it is still the suggestion - never overwrite a typed one.
      username: f.username === '' || f.username === suggestUsername(f.name, takenNames)
        ? suggestUsername(name, takenNames)
        : f.username,
    }))
  }

  /** Choosing the person carries over the agent they are already linked to, so
   *  the common case (HR set it up) needs no second answer. */
  function choosePerson(personnelId: string) {
    const person = people.find((p) => p.id === personnelId)
    setForm((f) => {
      // A field seat is the employee, so their name is the seat's name. Filled
      // in only while the name is still blank or still the last prefill - a
      // typed name is never overwritten.
      const prevPrefill = people.find((p) => p.id === f.personnelId)?.name
      const takeName = person && (f.name === '' || f.name === prevPrefill)
      const name = takeName ? person.name : f.name
      const username = takeName && (f.username === '' || f.username === suggestUsername(f.name, takenNames))
        ? suggestUsername(name, takenNames)
        : f.username
      return { ...f, personnelId, name, username, agentId: person?.agentId ?? '' }
    })
  }

  function toggleModule(key: ModuleKey) {
    setForm((f) => ({ ...f, modules: f.modules.includes(key) ? f.modules.filter((m) => m !== key) : [...f.modules, key] }))
  }

  async function save() {
    setError('')
    const name = form.name.trim()
    const username = form.username.trim().toLowerCase()
    if (!name || !username) return setError('Full name and username are required.')
    if (!/^[a-z0-9._-]+$/.test(username)) return setError('Usernames may contain only letters, numbers, dots, dashes and underscores.')
    if (!editId && !form.password) return setError('A password is required for a new seat.')
    if (form.password && form.password.length < 4) return setError('Password must be at least 4 characters.')
    if (!def.isAdmin && form.modules.length === 0) return setError('Select at least one module for this seat.')
    if (def.scope === 'own' && !form.personnelId) return setError(`A ${def.title.toLowerCase()} seat must be linked to an employee.`)
    // Refused here rather than discovered on the agent's phone, where every sale
    // they file would come back "not yours" from the server.
    if (def.key === 'agent' && !form.agentId) return setError('Select the sales agent record this employee sells under.')

    const clash = (seats ?? []).find((s) => s.username.toLowerCase() === username && s.id !== editId)
    if (clash) return setError(`The username "${username}" is already in use by ${clash.name}.`)
    const twice = (seats ?? []).find((s) => s.personnelId && s.personnelId === form.personnelId && s.id !== editId)
    if (form.personnelId && twice) return setError(`${personName(form.personnelId)} is already linked to the seat for ${twice.name}.`)

    // Demoting or de-moduling the last admin would lock everyone out of seat management.
    if (editId && !def.isAdmin) {
      const otherAdmins = (seats ?? []).filter((s) => s.isAdmin && s.id !== editId)
      const editing = (seats ?? []).find((s) => s.id === editId)
      if (editing?.isAdmin && otherAdmins.length === 0) return setError('This is the only administrator seat. Assign another administrator before changing it.')
    }

    // The server hashes the password and re-checks every guard (unique username,
    // last-admin protection) - the checks above just give friendlier, faster errors.
    const data = {
      name,
      username,
      role: form.role.trim() || def.title,
      isAdmin: def.isAdmin,
      modules: def.isAdmin ? [] : form.modules,
      scope: def.scope,
      personnelId: def.scope === 'own' ? form.personnelId : undefined,
      ...(form.password ? { password: form.password } : {}),
    }

    try {
      // The link lives on the employee, so it is written there - but it is
      // asked for and saved here, because a seat that lacks it does not work.
      if (def.key === 'agent' && people.find((p) => p.id === form.personnelId)?.agentId !== form.agentId) {
        await repos.personnel.update(form.personnelId, { agentId: form.agentId })
      }
      if (editId) await repos.seats.update(editId, data)
      else await repos.seats.add(data)
    } catch (e) {
      return setError(e instanceof ApiError ? e.message : 'Unable to save this seat.')
    }
    setFormOpen(false)
  }

  async function remove() {
    if (!deleting) return
    setError('')
    const s = deleting
    setDeleting(null)
    if (s.id === me?.id) return setError('The seat you are currently signed in with cannot be deleted.')
    if (s.isAdmin && (seats ?? []).filter((x) => x.isAdmin).length <= 1) {
      return setError('This is the only administrator seat. Assign another administrator before deleting it.')
    }
    try {
      await repos.seats.remove(s.id)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Unable to delete this seat.')
    }
  }

  /**
   * Grouped by what a seat can do, because that is the question this page is
   * opened with - who can approve, who is out in the field - and a flat list
   * answers it only by reading every row.
   */
  const groups = [
    { key: 'admin', title: 'Administrators' },
    { key: 'office', title: 'Office staff' },
    { key: 'field', title: 'Field seats' },
  ].map((g) => ({
    ...g,
    rows: (seats ?? []).filter((s) => {
      const k = kindOf(s)
      return g.key === 'admin' ? k === 'admin'
        : g.key === 'office' ? k === 'office' || k === 'treasurer'
          : k !== 'admin' && k !== 'office' && k !== 'treasurer'
    }),
  })).filter((g) => g.rows.length > 0)

  const kindTitle = (s: Seat) => KINDS.find((k) => k.key === kindOf(s))?.title ?? ''

  return (
    <>
      {error && !formOpen && (
        <div className="mb-[18px] rounded-[6px] border border-redf bg-redbadge px-3 py-2 text-[13px] font-semibold text-redtext">{error}</div>
      )}

      <Card delay={100}>
        <div className="flex items-center gap-[10px] border-b border-linesoft px-5 py-[12px]">
          <h3 className="m-0 text-[15px] font-semibold">Seats</h3>
          <span className="font-meta text-[12px] text-mut">{seats?.length ?? 0}</span>
          <span className="ml-auto"><PrimaryButton size="sm" onClick={openNew}>+ Add seat</PrimaryButton></span>
        </div>

        {/* One row per seat on a fixed grid, so the same fact is in the same
            place on every row: who, what kind, which employee, which modules,
            and anything wrong with it. The old row said all of that in one
            sentence per seat, which is read rather than scanned. */}
        {groups.map((g) => (
          <div key={g.key}>
            <div className="flex items-baseline gap-[10px] border-b border-linesoft bg-paper px-5 py-[7px]">
              <p className="m-0 font-meta text-[10px] font-semibold uppercase tracking-[.09em] text-mut">{g.title}</p>
              <span className="tnum font-meta text-[12px] text-faint">{g.rows.length}</span>
            </div>
            {g.rows.map((s) => {
              const kind = kindOf(s)
              const person = people.find((p) => p.id === s.personnelId)
              const problem = kind === 'agent' && !person?.agentId ? 'Agent not linked'
                : kind !== 'admin' && kind !== 'office' && !s.personnelId ? 'No employee'
                : !s.isAdmin && s.modules.length === 0 ? 'No modules'
                : null
              return (
                <div key={s.id} className="flex items-center gap-[14px] border-b border-linesoft px-5 py-[9px] text-[13px] last:border-b-0">
                  <Avatar name={s.name} size={26} />
                  <div className="w-[190px] min-w-0 shrink-0">
                    <p className="m-0 flex items-center gap-2 font-semibold">
                      <span className="truncate">{s.name}</span>
                      {s.id === me?.id && <Chip status="neutral" text="You" />}
                    </p>
                    <p className="m-0 truncate font-meta text-[12px] text-faint">@{s.username}</p>
                  </div>
                  {/* The role label is what the administrator typed and what
                      Dashboard per role keys on; the seat type is what it does. */}
                  <span className="w-[130px] min-w-0 shrink-0">
                    <span className="block truncate text-lab">{s.role || kindTitle(s)}</span>
                    {s.role && s.role !== kindTitle(s) && (
                      <span className="block truncate font-meta text-[12px] text-faint">{kindTitle(s)}</span>
                    )}
                  </span>
                  <span className="w-[150px] shrink-0 truncate font-meta text-[12px] text-mut">
                    {s.personnelId ? person?.name ?? 'Unknown employee' : <span className="text-faint">—</span>}
                  </span>
                  <AccessMarks seat={s} />
                  <span className="ml-auto flex w-[120px] shrink-0 justify-end">
                    {problem && <Chip status={problem === 'Agent not linked' ? 'pending' : 'overdue'} text={problem} />}
                  </span>
                  <RowAction verb="edit" label={`Edit ${s.name}`} onClick={() => openEdit(s)} />
                  {/* Your own seat has no delete: refusing it after the click was
                      a dead end, and a control that only ever refuses is worse
                      than none. */}
                  {s.id !== me?.id ? (
                    <RowAction verb="delete" label={`Delete ${s.name}`} onClick={() => setDeleting(s)} />
                  ) : <span className="inline-block h-[26px] w-[26px]" />}
                </div>
              )
            })}
          </div>
        ))}
        {(seats ?? []).length === 0 && <p className="m-0 py-6 text-center text-[13px] text-faint">No seats have been created.</p>}
      </Card>

      <Dialog
        open={formOpen}
        title={editId ? form.name || 'Seat' : 'New seat'}
        subtitle={editId ? `Username @${form.username}` : 'Login credentials for one person'}
        onClose={() => setFormOpen(false)}
        width={WIDE_DIALOG}
        // The kinds are the nav: choosing one is the first decision, and it sets
        // the modules, the scope and whether an employee has to be named.
        nav={
          <>
            <p className="m-0 mb-[8px] px-[8px] font-meta text-[10px] font-semibold uppercase tracking-[.09em] text-faint">
              Seat type
            </p>
            {KINDS.map((k) => {
              const on = k.key === form.kind
              return (
                <button
                  key={k.key}
                  type="button"
                  onClick={() => chooseKind(k.key)}
                  aria-pressed={on}
                  className={`mb-[2px] block w-full cursor-pointer rounded-[6px] border-0 px-[10px] py-[8px] text-left transition-colors ${
                    on ? 'bg-white shadow-[inset_0_0_0_1px_var(--color-line)]' : 'bg-transparent hover:bg-white/60'
                  }`}
                >
                  <span className={`block text-[13px] font-semibold ${on ? 'text-ink' : 'text-lab'}`}>{k.title}</span>
                  <span className="mt-[2px] block font-meta text-[12px] leading-[1.4] text-faint">{k.short}</span>
                </button>
              )
            })}
          </>
        }
        // What this person's app will look like when they sign in. A seat is an
        // abstraction until you see the rail it produces.
        rail={<SeatPreview def={def} form={form} personName={personName} />}
        footer={
          <>
            <GhostButton onClick={() => setFormOpen(false)}>Cancel</GhostButton>
            <PrimaryButton onClick={save}>{editId ? 'Save changes' : 'Create seat'}</PrimaryButton>
          </>
        }
      >
        {error && (
          <p className="m-0 mb-3 rounded-[6px] border border-redf bg-redbadge px-3 py-2 text-[13px] font-semibold text-redtext">{error}</p>
        )}

        {/* Three short blocks: who the seat is, how they sign in, what they
            can open. Headings, not numbered steps - this is a record, not a
            procedure. */}
        <FormSection first>Who this is</FormSection>
        <div className="grid grid-cols-2 gap-x-4 gap-y-[12px]">
          {/* For a field seat the employee comes first: the seat is that person,
              and choosing them fills in the name and username below. */}
          {def.scope === 'own' && (
            <Field label="Employee" span2 hint="The seat shows only this employee’s own records.">
              <Select value={form.personnelId} onChange={(e) => choosePerson(e.target.value)}>
                <option value="">Select an employee</option>
                {people
                  .filter((p: Personnel) => !def.roles || def.roles.includes(p.role))
                  .map((p: Personnel) => <option key={p.id} value={p.id}>{p.name} - {labelOf(p.role)}</option>)}
              </Select>
            </Field>
          )}

          <Field label="Full name">
            <Input value={form.name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Username">
            <Input autoComplete="off" value={form.username} onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))} />
          </Field>

          {def.key === 'agent' && (
            <Field
              label="Sales agent record"
              span2
              hint={form.personnelId && !people.find((p) => p.id === form.personnelId)?.agentId
                ? 'This employee is not yet linked to an agent. Selecting one here updates the employee record.'
                : undefined}
            >
              <Select value={form.agentId} onChange={(e) => setForm((f) => ({ ...f, agentId: e.target.value }))}>
                <option value="">Select an agent</option>
                {agents.map((a: Agent) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </Select>
            </Field>
          )}

        </div>

        <FormSection>Sign-in</FormSection>
        <div className="grid grid-cols-2 gap-x-4 gap-y-[12px]">
          {/* The only hint left on a control: blank meaning "keep the current one"
              is the one thing here that cannot be read off the form. */}
          <Field label={editId ? 'New password' : 'Password'} hint={editId ? 'Leave blank to keep the current password.' : undefined}>
            <Input
              type="text"
              autoComplete="new-password"
              value={form.password}
              onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
            />
          </Field>
          <span className="flex items-end pb-[1px]">
            {/* Readable over a phone, which is how these actually get handed
                over, and shown in the clear because it has to be passed on once. */}
            <GhostButton onClick={() => setForm((f) => ({ ...f, password: suggestPassword() }))}>
              Suggest a password
            </GhostButton>
          </span>

          <Field label="Role label" span2 hint="Display only; does not affect permissions.">
            <Input value={form.role} placeholder={def.title} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))} />
          </Field>
        </div>

        <FormSection
          right={!def.isAdmin ? (
            <button
              type="button"
              onClick={() => setShowModules((v) => !v)}
              className="cursor-pointer border-0 bg-transparent p-0 font-meta text-[12px] font-semibold normal-case tracking-normal text-tealtext transition-colors hover:text-ink"
            >
              {showModules ? 'Hide' : 'Customise'}
            </button>
          ) : undefined}
        >
          <span className="inline-flex items-center gap-[6px]">
            Modules
            <InfoTip label="What the modules do">
              Determines which screens appear in the navigation. “Admin &amp; settings” grants access to
              master data (suppliers, depots, bank accounts) but not to seat management, which remains
              restricted to administrators.
            </InfoTip>
          </span>
        </FormSection>
        {def.isAdmin ? (
          <p className="m-0 font-meta text-[12px] text-mut">All modules.</p>
        ) : showModules ? (
          <div className="grid grid-cols-3 gap-2">
            {MODULES.map((m) => {
              // Treasury sees every collector's items, so it cannot live on a
              // seat the server scopes to one person's records - such a seat
              // would open an empty queue. And a collector holding Treasury
              // would be banking their own collections, which is the one
              // pairing the module exists to prevent.
              const notForField = def.scope === 'own' && m.key === 'treasury'
              return (
                <label
                  key={m.key}
                  title={notForField ? 'Treasury is an office screen - make a Treasurer seat instead.' : undefined}
                  className={`flex items-center gap-[8px] rounded-[6px] border px-[10px] py-[8px] text-[13px] ${
                    notForField ? 'cursor-not-allowed border-line text-faint'
                      : form.modules.includes(m.key) ? 'cursor-pointer border-ink bg-paper font-semibold' : 'cursor-pointer border-line text-lab hover:bg-paper'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={form.modules.includes(m.key)}
                    disabled={notForField}
                    onChange={() => toggleModule(m.key)}
                    className="h-[14px] w-[14px] accent-ink"
                  />
                  {m.label}
                </label>
              )
            })}
          </div>
        ) : (
          <p className="m-0 font-meta text-[12px] text-mut">
            {MODULES.filter((m) => form.modules.includes(m.key)).map((m) => m.label).join(', ') || 'None selected'}
          </p>
        )}
      </Dialog>

      <Dialog
        open={deleting !== null}
        title={`Delete ${deleting?.name ?? 'this seat'}’s seat?`}
        subtitle="They will no longer be able to sign in · cannot be undone"
        onClose={() => setDeleting(null)}
        width={480}
        footer={
          <>
            <GhostButton onClick={() => setDeleting(null)}>Cancel</GhostButton>
            <PrimaryButton tone="danger" onClick={remove}>Delete seat</PrimaryButton>
          </>
        }
      >
        <p className="m-0 text-[13px] leading-[1.5] text-lab">
          Only the login goes. The employee record stays, and everything entered under this seat
          keeps its name in the history.
        </p>
      </Dialog>
    </>
  )
}

/**
 * Module access as one mark per module, in the rail's order: dark where the
 * seat has it, pale where it does not. Eight marks read at a glance across a
 * column of rows; "Home, Sales, Collect" has to be read one row at a time. A
 * field seat's marks are its one module, which is also what the phone shows.
 */
function AccessMarks({ seat }: { seat: Seat }) {
  return (
    <span className="flex shrink-0 items-center gap-[3px]" aria-label={seat.isAdmin ? 'All modules' : MODULES.filter((m) => seat.modules.includes(m.key)).map((m) => m.label).join(', ') || 'No modules'}>
      {MODULES.map((m) => {
        const on = seat.isAdmin || seat.modules.includes(m.key)
        return (
          <span
            key={m.key}
            title={m.label}
            className={`block h-[8px] w-[12px] rounded-[2px] ${on ? 'bg-ink/85' : 'bg-inputline'}`}
          />
        )
      })}
    </span>
  )
}

/**
 * The app this seat produces: the rail they get, where they land, what the
 * server will let them do.
 *
 * A seat is four settings that only mean something together, and until you can
 * see what they add up to the only way to check one was to sign in as them.
 *
 * Drawn rather than described. The landing screen is a tag inside the picture
 * instead of a sentence under it, and how the limits are enforced sits in a tip
 * on the heading - it is worth knowing once, not worth a line of every seat you
 * ever open.
 */
function SeatPreview({ def, form, personName }: {
  def: KindDef
  form: SeatForm
  personName: (id?: string) => string | undefined
}) {
  const rail = def.isAdmin ? MODULES : MODULES.filter((m) => form.modules.includes(m.key))
  // Whether this seat gets the phone shell, worked out the same way the app
  // works it out - so a preset that gains a field screen shows it here without
  // anyone remembering to update this preview.
  const work = def.scope === 'own' ? FIELD_PAGES.filter((p) => form.modules.includes(p.module)) : []
  const phone = work.length > 0 ? [...work, FIELD_TASKS_PAGE] : []
  const who = form.name.trim() || 'This seat'
  const as = form.personnelId ? `, as ${personName(form.personnelId)}` : ''

  const can: { text: string; tone?: 'bad' }[] = def.isAdmin
    ? [{ text: 'All modules, including seat management.' }]
    : def.key === 'crew'
      ? [{ text: `Trips they are assigned to${as}.` }, { text: 'Cannot edit trip details such as schedule, truck or crew.', tone: 'bad' }]
      : def.key === 'agent'
        ? [{ text: `Their own sales${as}.` }, { text: 'Sales are submitted to the office for approval.' }]
        : def.key === 'collector'
          ? [{ text: `Installments assigned to them${as}.` }, { text: 'Cannot deposit or clear what they collected.', tone: 'bad' }]
          : def.key === 'treasurer'
            ? [
              { text: 'Every collector’s in-hand items, what is at the bank, and what is owed to suppliers.' },
              { text: 'Cannot change how a payment was collected, or by whom.', tone: 'bad' },
            ]
            : [{ text: 'Full access within the selected modules.' }, { text: 'Sales and purchases require approval.' }]

  return (
    <>
      <RailSection title="Sign-in preview">
        <div className="overflow-hidden rounded-[8px] border border-line bg-white">
          <div className="flex items-center gap-[8px] border-b border-linesoft px-[10px] py-[7px]">
            <Avatar name={who} size={20} />
            <span className="min-w-0 truncate text-[12px] font-semibold">{who}</span>
          </div>
          {phone.length > 0 ? (
            <>
              {phone.map((p, i) => <RailScreen key={p.path} label={p.label} lands={i === 0} />)}
              <p className="m-0 px-[10px] py-[6px] font-meta text-[12px] text-faint">Field app · no other screens</p>
            </>
          ) : rail.length === 0 ? (
            <p className="m-0 px-[10px] py-[7px] font-meta text-[12px] text-redtext">No screens · no modules selected</p>
          ) : (
            rail.map((m, i) => <RailScreen key={m.key} label={m.label} lands={i === 0} />)
          )}
        </div>
        {def.scope === 'own' && !form.personnelId && <RailAside tone="bad">No employee selected.</RailAside>}
        {def.key === 'agent' && form.personnelId && !form.agentId && (
          <RailAside tone="bad">No agent selected. This seat would be unable to record sales.</RailAside>
        )}
      </RailSection>

      <RailSection
        title={
          <span className="inline-flex items-center gap-[6px]">
            Access
            <InfoTip label="How this is enforced">
              Access is enforced on the server for every read and write. Records outside a seat’s
              scope are never returned, regardless of which screens are shown.
            </InfoTip>
          </span>
        }
      >
        {can.map((c) => <RailAside key={c.text} tone={c.tone}>{c.text}</RailAside>)}
      </RailSection>
    </>
  )
}

/** One screen in their rail. The one they land on is tagged in place, which is
 *  a word where a sentence under the picture used to be. */
function RailScreen({ label, lands }: { label: string; lands?: boolean }) {
  return (
    <p className={`m-0 flex items-baseline gap-2 px-[10px] py-[6px] font-meta text-[12px] ${
      lands ? 'bg-paper font-semibold text-ink' : 'text-sec'
    }`}>
      <span className="min-w-0 truncate">{label}</span>
      {lands && <span className="ml-auto shrink-0 text-[10px] font-semibold uppercase tracking-[.09em] text-faint">Landing screen</span>}
    </p>
  )
}
