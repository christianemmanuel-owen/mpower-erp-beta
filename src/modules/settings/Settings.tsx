import { useState } from 'react'
import { useTables } from '../../lib/data'
import { repos, safeDeleteLookup } from '../../data/repo'
import { resetDemoData } from '../../data/seed'
import { useNavigate } from 'react-router-dom'
import { useAuth, canAccess } from '../../lib/auth'
import { label } from '../../lib/format'
import {
  Avatar, Card, Field, GhostButton, Input, PageHeader, PanelNav, PrimaryButton, Select, Dialog,
} from '../../components/ui'
import { Pencil, Trash2 } from 'lucide-react'
import Seats from './Seats'
import DashboardRoles from './DashboardRoles'

type Kind = 'suppliers' | 'warehouses' | 'agents' | 'customers' | 'bankAccounts' | 'trucks'

interface FieldDef {
  key: string
  label: string
  type?: 'text' | 'number' | 'select'
  options?: string[]
  /** Value a brand-new record starts with, before the user types anything. */
  default?: string | number
  hint?: string
}

const config: Record<Kind, { title: string; fields: FieldDef[]; name: (r: Record<string, unknown>) => string; meta: (r: Record<string, unknown>) => string }> = {
  suppliers: {
    title: 'Suppliers',
    fields: [
      { key: 'name', label: 'Name' },
      { key: 'contactPerson', label: 'Contact person' },
      { key: 'contactNumber', label: 'Contact number' },
      { key: 'address', label: 'Address' },
      { key: 'paymentTermDays', label: 'Payment term (days)', type: 'number', default: 30, hint: 'A new purchase from this supplier auto-fills its due date this many days out (0 = pay on delivery).' },
    ],
    name: (r) => String(r.name),
    meta: (r) => `${r.contactPerson} · ${r.contactNumber} · Net ${r.paymentTermDays ?? 30}`,
  },
  warehouses: {
    title: 'Depots',
    fields: [
      { key: 'name', label: 'Name' },
      { key: 'address', label: 'Address' },
      { key: 'capacityLiters', label: 'Capacity (liters)', type: 'number' },
      { key: 'lat', label: 'Latitude', type: 'number' },
      { key: 'lng', label: 'Longitude', type: 'number' },
    ],
    name: (r) => String(r.name),
    meta: (r) => `${r.address} · ${Number(r.capacityLiters).toLocaleString()} L`,
  },
  agents: {
    title: 'Agents',
    fields: [
      { key: 'name', label: 'Name' },
      { key: 'contactNumber', label: 'Contact number' },
      { key: 'monthlyQuotaLiters', label: 'Monthly quota (liters)', type: 'number' },
    ],
    name: (r) => String(r.name),
    meta: (r) => `quota ${Number(r.monthlyQuotaLiters).toLocaleString()} L · ${r.contactNumber}`,
  },
  customers: {
    title: 'Customers',
    fields: [
      { key: 'company', label: 'Company' },
      { key: 'brand', label: 'Brand' },
      { key: 'address', label: 'Address' },
      { key: 'collectionAddress', label: 'Collection address', hint: 'Where payment is collected, if different - Collection screens fall back to the address above when blank.' },
      { key: 'contactPerson', label: 'Contact person' },
      { key: 'contactNumber', label: 'Contact number' },
      { key: 'paymentTermDays', label: 'Payment term (days)', type: 'number', default: 30, hint: 'A new sale to this customer auto-fills its due date this many days out (0 = due on the spot).' },
    ],
    name: (r) => String(r.company),
    meta: (r) => `${r.brand} · ${r.address} · Net ${r.paymentTermDays ?? 30}`,
  },
  bankAccounts: {
    title: 'Bank accounts',
    fields: [
      { key: 'bankName', label: 'Bank' },
      { key: 'accountName', label: 'Account name' },
      { key: 'accountNumberMasked', label: 'Account number' },
    ],
    name: (r) => `${r.bankName} ${r.accountNumberMasked}`,
    meta: (r) => String(r.accountName),
  },
  trucks: {
    title: 'Trucks',
    fields: [
      { key: 'plateNumber', label: 'Plate number' },
      { key: 'capacityLiters', label: 'Capacity (liters)', type: 'number' },
    ],
    name: (r) => String(r.plateNumber),
    meta: (r) => `${Number(r.capacityLiters).toLocaleString()} L`,
  },
}

const kinds = Object.keys(config) as Kind[]

export default function Settings() {
  const navigate = useNavigate()
  const { seat } = useAuth()
  const isAdmin = !!seat?.isAdmin
  const [kind, setKind] = useState<Kind | 'seats'>('suppliers')
  const [formOpen, setFormOpen] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState<Record<string, unknown>>({})
  const [error, setError] = useState('')
  /** The record the trash icon was pressed on, held for the confirmation. */
  const [deleting, setDeleting] = useState<{ id: string; name: string } | null>(null)
  const [resetting, setResetting] = useState(false)

  const tables = useTables([...kinds, 'seats'] as const)
  const counts = tables && (Object.fromEntries(kinds.map((k) => [k, tables[k].length])) as Record<Kind, number>)
  const seatCount = tables?.seats.length
  const rows = kind === 'seats' ? [] : (tables?.[kind] as Record<string, unknown>[] | undefined)
  const cfg = kind === 'seats' ? null : config[kind]

  function openNew() {
    if (!cfg) return
    setEditId(null)
    setForm(Object.fromEntries(cfg.fields.filter((f) => f.default !== undefined).map((f) => [f.key, f.default])))
    setFormOpen(true)
  }

  function openEdit(r: Record<string, unknown>) {
    setEditId(String(r.id))
    setForm({ ...r })
    setFormOpen(true)
  }

  async function save() {
    if (!cfg || kind === 'seats') return
    const data = { ...form }
    delete data.id
    delete data.createdAt
    delete data.updatedAt
    for (const f of cfg.fields) {
      if (f.type === 'number') data[f.key] = Number(data[f.key] ?? f.default ?? 0)
      if (data[f.key] === undefined) data[f.key] = f.type === 'number' ? (f.default ?? 0) : f.type === 'select' ? f.options?.[0] ?? '' : ''
    }
    if (editId) await repos[kind].update(editId, data as never)
    else await repos[kind].add(data as never)
    setFormOpen(false)
  }

  /**
   * Deleting a reference record went through on a single click of a red text
   * link, and the only feedback was a red box on the page if the record turned
   * out to be in use. It is confirmed first now, and the refusal is shown in
   * the confirmation rather than behind it.
   */
  async function remove() {
    if (kind === 'seats' || !deleting) return
    setError('')
    const result = await safeDeleteLookup(kind, deleting.id)
    setDeleting(null)
    if (!result.ok) setError(result.reason ?? 'Can’t delete this record.')
  }

  const initials = (name: string) => name.replace(/^SG /, '').split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()

  return (
    <div className="max-w-[1200px]">
      {/* No page-level create action here: every list on this page has its own
          Add, and a generic "Add record" in the header both duplicated it and
          did nothing at all while the Seats tab was open. */}
      <PageHeader title="Admin" />

      <div className="grid grid-cols-[220px_1fr] items-start gap-[18px]">
        {/* One nav shape for both settings pages - see PanelNav. This was a
            hand-rolled list with 14px radii and an active state filled solid
            ink, which appears nowhere else in the app. */}
        <PanelNav
          items={[
            ...(isAdmin ? [{ key: 'seats' as Kind | 'seats', title: 'Seats', count: seatCount ?? '…' }] : []),
            ...kinds.map((k) => ({ key: k as Kind | 'seats', title: config[k].title, count: counts?.[k] ?? '…' })),
          ]}
          active={kind}
          onSelect={(k) => { setKind(k); setError('') }}
          note="Reference records the rest of the app picks from."
        />

        <div className="flex flex-col gap-[18px]">
          {error && <div className="rounded-[6px] border border-redf bg-redbadge px-3 py-2 text-[13px] font-semibold text-redtext">{error}</div>}

          {kind === 'seats' && isAdmin && (
            <>
              <Seats />
              {/* Exhibit A 1.1 - per-role dashboard configuration lives beside
                  seats, since a role only means anything once seats carry it. */}
              <div className="mt-[18px]">
                <DashboardRoles />
              </div>
            </>
          )}

          {cfg && (
          <Card delay={100}>
            <div className="flex items-center gap-[10px] border-b border-linesoft px-5 py-[12px]">
              <h3 className="m-0 text-[15px] font-semibold">{cfg.title}</h3>
              <span className="font-meta text-[12px] text-mut">{rows?.length ?? 0}</span>
              <span className="ml-auto"><PrimaryButton size="sm" onClick={openNew}>+ Add {SINGULAR[kind]}</PrimaryButton></span>
            </div>
            <div>
              {(rows ?? []).map((r) => (
                <div
                  key={String(r.id)}
                  className="flex items-center gap-3 border-b border-linesoft px-5 py-[9px] text-[13px] last:border-b-0"
                >
                  <Avatar name={initials(cfg.name(r))} size={26} />
                  <div className="min-w-0 flex-1">
                    <p className="m-0 truncate font-semibold">{cfg.name(r)}</p>
                    <p className="m-0 truncate font-meta text-[12px] text-faint">{cfg.meta(r)}</p>
                  </div>
                  {/* Two uppercase text links, one teal and one red, sat where
                      every other list in the app puts icon buttons - and the
                      red one deleted a record on a single click. */}
                  <button
                    type="button"
                    onClick={() => openEdit(r)}
                    aria-label={`Edit ${cfg.name(r)}`}
                    className="inline-flex h-[26px] w-[26px] cursor-pointer items-center justify-center rounded-[6px] border-0 bg-transparent text-mut transition-colors hover:bg-fill2 hover:text-ink"
                  >
                    <Pencil size={14} strokeWidth={1.8} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleting({ id: String(r.id), name: cfg.name(r) })}
                    aria-label={`Delete ${cfg.name(r)}`}
                    className="inline-flex h-[26px] w-[26px] cursor-pointer items-center justify-center rounded-[6px] border-0 bg-transparent text-mut transition-colors hover:bg-fill2 hover:text-redtext"
                  >
                    <Trash2 size={14} strokeWidth={1.8} />
                  </button>
                </div>
              ))}
              {(rows ?? []).length === 0 && (
                <p className="m-0 py-6 text-center text-[13px] text-faint">No records yet. Add the first one.</p>
              )}
            </div>
          </Card>
          )}

          {canAccess(seat, 'hr') && (
          <Card delay={125}>
            <div className="flex flex-wrap items-center gap-3 px-5 py-[14px]">
              <span className="min-w-0 flex-1">
                <p className="m-0 text-[13px] font-semibold">Looking for crew &amp; personnel?</p>
                <p className="m-0 mt-[2px] font-meta text-[12px] text-mut">
                  Employee records - crew, office staff, pay setup - live in HR.
                </p>
              </span>
              <GhostButton onClick={() => navigate('/hr/employees')}>Go to Employees</GhostButton>
            </div>
          </Card>
          )}

          {/* The most destructive control in the app used to be a black
              promotional card with a white outline button - the visual language
              of "try this", for something that replaces every record. */}
          {kind !== 'seats' && (
          <Card delay={150}>
            <div className="flex flex-wrap items-center gap-3 px-5 py-[14px]">
              <span className="min-w-0 flex-1">
                <p className="m-0 text-[13px] font-semibold">Demo data</p>
                <p className="m-0 mt-[2px] font-meta text-[12px] text-mut">
                  Restores the original sample dataset. Every record you have entered is replaced.
                </p>
              </span>
              <GhostButton onClick={() => setResetting(true)}>Reset demo data</GhostButton>
            </div>
          </Card>
          )}
        </div>
      </div>

      {cfg && (
      <Dialog
        open={formOpen}
        // "Edit - Suppliers" named the list, not the record. The record's own
        // name is what tells you which one you opened.
        title={editId ? String(form.name ?? cfg.title) : `New ${SINGULAR[kind]}`}
        subtitle={editId ? `${SINGULAR[kind]} details` : undefined}
        onClose={() => setFormOpen(false)}
        width={560}
        footer={
          <>
            <GhostButton onClick={() => setFormOpen(false)}>Cancel</GhostButton>
            <PrimaryButton onClick={save}>{editId ? 'Save changes' : `Add ${SINGULAR[kind]}`}</PrimaryButton>
          </>
        }
      >
        <div className="flex flex-col gap-[14px]">
          {cfg.fields.map((f) => (
            <Field key={f.key} label={f.label} hint={f.hint}>
              {f.type === 'select' ? (
                <Select value={String(form[f.key] ?? f.options?.[0] ?? '')} onChange={(e) => setForm((x) => ({ ...x, [f.key]: e.target.value }))}>
                  {f.options?.map((o) => <option key={o} value={o}>{label(o)}</option>)}
                </Select>
              ) : (
                <Input
                  type={f.type ?? 'text'}
                  value={String(form[f.key] ?? '')}
                  onChange={(e) => setForm((x) => ({ ...x, [f.key]: e.target.value }))}
                />
              )}
            </Field>
          ))}
        </div>
      </Dialog>
      )}

      <Dialog
        open={deleting !== null}
        title={`Delete ${deleting?.name ?? 'this record'}?`}
        subtitle="This cannot be undone."
        onClose={() => setDeleting(null)}
        width={480}
        footer={
          <>
            <GhostButton onClick={() => setDeleting(null)}>Cancel</GhostButton>
            <PrimaryButton onClick={remove}>Delete</PrimaryButton>
          </>
        }
      >
        <p className="m-0 text-[13px] text-lab">
          Anything already pointing at this record keeps pointing at it, so the delete is refused if it
          is in use - you will be told which records are holding it.
        </p>
      </Dialog>

      <Dialog
        open={resetting}
        title="Replace everything with the demo dataset?"
        subtitle="Every record in this system"
        onClose={() => setResetting(false)}
        width={480}
        footer={
          <>
            <GhostButton onClick={() => setResetting(false)}>Cancel</GhostButton>
            <PrimaryButton onClick={() => { setResetting(false); resetDemoData() }}>Reset demo data</PrimaryButton>
          </>
        }
      >
        <p className="m-0 text-[13px] text-lab">
          Sales, purchases, trips, attendance, payroll runs and every reference record are deleted and
          replaced with the sample data. There is no undo.
        </p>
      </Dialog>
    </div>
  )
}

/** What one of each list is called, for a dialog title that names the record
 *  rather than the list it came from. */
const SINGULAR: Record<Kind | 'seats', string> = {
  suppliers: 'supplier',
  warehouses: 'depot',
  agents: 'agent',
  customers: 'customer',
  bankAccounts: 'bank account',
  trucks: 'truck',
  seats: 'seat',
}
