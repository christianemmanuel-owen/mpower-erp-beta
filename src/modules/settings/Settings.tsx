import { AXLE_CONFIGS, axleConfigLabel } from '../../lib/vehicleLimits'
import { useState } from 'react'
import { useTables } from '../../lib/data'
import { repos, safeDeleteLookup } from '../../data/repo'
import { resetDemoData } from '../../data/seed'
import { useNavigate } from 'react-router-dom'
import { useAuth, canAccess } from '../../lib/auth'
import { label } from '../../lib/format'
import {
  Avatar, Card, Field, GhostButton, Input, FormSection, PageHeader, PanelNav, PrimaryButton, Select, Dialog, RowAction,
} from '../../components/ui'
import Seats from './Seats'
import DashboardRoles from './DashboardRoles'
import MapPicker from '../../components/MapPicker'

type Kind = 'suppliers' | 'haulers' | 'warehouses' | 'agents' | 'customers' | 'bankAccounts' | 'trucks'

interface FieldDef {
  key: string
  label: string
  type?: 'text' | 'number' | 'select'
  options?: string[]
  /** Value a brand-new record starts with, before the user types anything. */
  default?: string | number
  hint?: string
  /** How many columns of the section's grid it takes - an address wants two. */
  span?: number
}

/** One block of the dialog: a small heading and a row or two of fields laid
 * across `cols` columns. Wide and short on purpose - these are reference
 * records with a handful of fields each, and a tall single column made a
 * supplier look like a questionnaire. */
interface SectionDef { title: string; keys: string[]; cols: number }

const config: Record<Kind, { title: string; blurb: string; fields: FieldDef[]; sections: SectionDef[]; name: (r: Record<string, unknown>) => string; meta: (r: Record<string, unknown>) => string }> = {
  suppliers: {
    title: 'Suppliers',
    blurb: 'Where the fuel comes from. Picked on every purchase; paid from Treasury → Payables.',
    sections: [{ title: 'Supplier', keys: ['name', 'address'], cols: 3 }, { title: 'Contacts', keys: ['contactPerson', 'contactNumber', 'agentName', 'agentContact'], cols: 4 }, { title: 'Loading and terms', keys: ['depotName', 'depotAddress', 'paymentTermDays'], cols: 4 }],
    fields: [
      { key: 'name', label: 'Name' },
      { key: 'contactPerson', label: 'Contact person' },
      { key: 'contactNumber', label: 'Contact number' },
      { key: 'address', span: 2, label: 'Address' },
      { key: 'agentName', label: 'Sales agent', hint: 'Their rep for our account.' },
      { key: 'agentContact', label: 'Agent contact' },
      { key: 'depotName', label: 'Loading depot', hint: 'If not the office address.' },
      { key: 'depotAddress', span: 2, label: 'Depot address' },
      { key: 'paymentTermDays', label: 'Payment term (days)', type: 'number', default: 30, hint: 'Due date on new purchases. 0 = on delivery.' },
    ],
    name: (r) => String(r.name),
    meta: (r) => `${r.agentName || r.contactPerson} · ${r.agentContact || r.contactNumber} · Net ${r.paymentTermDays ?? 30}`,
  },
  haulers: {
    title: 'Haulers',
    blurb: 'Third-party trucking for loads our own fleet does not carry.',
    sections: [{ title: 'Hauler', keys: ['name', 'address'], cols: 3 }, { title: 'Contact and fees', keys: ['contactPerson', 'contactNumber', 'defaultFee', 'paymentMode'], cols: 4 }],
    fields: [
      { key: 'name', label: 'Name' },
      { key: 'contactPerson', label: 'Contact person' },
      { key: 'contactNumber', label: 'Contact number' },
      { key: 'address', span: 2, label: 'Address' },
      { key: 'defaultFee', label: 'Usual fee (₱)', type: 'number', hint: 'Per run; editable per load.' },
      { key: 'paymentMode', label: 'Usually paid by', type: 'select', options: ['bank_transfer', 'cash', 'check'], default: 'bank_transfer' },
    ],
    name: (r) => String(r.name),
    meta: (r) => [r.contactPerson || r.contactNumber, r.defaultFee ? `₱${Number(r.defaultFee).toLocaleString()} per run` : 'no usual fee'].filter(Boolean).join(' · '),
  },
  warehouses: {
    title: 'Depots',
    blurb: 'Where trucks load. Stock levels and drive-time estimates start here.',
    sections: [{ title: 'Depot', keys: ['name', 'capacityLiters', 'address', 'lat', 'lng'], cols: 2 }],
    fields: [
      { key: 'name', label: 'Name' },
      { key: 'address', span: 2, label: 'Address' },
      { key: 'capacityLiters', label: 'Capacity (liters)', type: 'number' },
      { key: 'lat', label: 'Latitude', type: 'number' },
      { key: 'lng', label: 'Longitude', type: 'number' },
    ],
    name: (r) => String(r.name),
    meta: (r) => `${r.address} · ${Number(r.capacityLiters).toLocaleString()} L`,
  },
  agents: {
    title: 'Agents',
    blurb: 'Sales agents. Quota and commission are measured against these.',
    sections: [{ title: 'Agent', keys: ['name', 'contactNumber', 'monthlyQuotaLiters'], cols: 3 }],
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
    blurb: 'Who buys. Every sale, delivery and collection points at one of these.',
    sections: [{ title: 'Customer', keys: ['company', 'brand', 'address', 'collectionAddress'], cols: 4 }, { title: 'Contact and terms', keys: ['contactPerson', 'contactNumber', 'paymentTermDays'], cols: 3 }],
    fields: [
      { key: 'company', label: 'Company' },
      { key: 'brand', label: 'Brand' },
      { key: 'address', span: 2, label: 'Address' },
      { key: 'collectionAddress', span: 2, label: 'Collection address', hint: 'If different from the address.' },
      { key: 'contactPerson', label: 'Contact person' },
      { key: 'contactNumber', label: 'Contact number' },
      { key: 'paymentTermDays', label: 'Payment term (days)', type: 'number', default: 30, hint: 'Due date on new sales. 0 = on the spot.' },
    ],
    name: (r) => String(r.company),
    meta: (r) => `${r.brand} · ${r.address} · Net ${r.paymentTermDays ?? 30}`,
  },
  bankAccounts: {
    title: 'Bank accounts',
    blurb: 'The company’s accounts. Payments land in and go out of these.',
    sections: [{ title: 'Account', keys: ['bankName', 'accountName', 'accountNumberMasked'], cols: 3 }],
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
    blurb: 'The fleet. Weights and axles drive the truck-ban and overloading checks.',
    sections: [{ title: 'Truck', keys: ['plateNumber', 'capacityLiters', 'gvwKg', 'tareKg'], cols: 4 }, { title: 'Road rules', keys: ['axleConfig', 'tollClass'], cols: 4 }],
    fields: [
      { key: 'plateNumber', label: 'Plate number' },
      { key: 'capacityLiters', label: 'Capacity (liters)', type: 'number' },
      // The truck ban applies above 4,500 kg. Blank counts as heavy - see
      // Truck.gvwKg - so a tanker nobody weighed still gets the warning.
      { key: 'gvwKg', label: 'Gross vehicle weight (kg)', type: 'number' },
      // For the overloading check: what it weighs empty, and which axle
      // code sets its legal gross weight. See lib/vehicleLimits.ts.
      { key: 'tareKg', label: 'Empty weight (kg)', type: 'number' },
      { key: 'axleConfig', label: 'Axles', type: 'select', options: AXLE_CONFIGS.map((a) => a.key), default: 'rigid2' },
      { key: 'tollClass', label: 'Tollway class', type: 'select', options: ['3', '2', '1'], default: '3' },
    ],
    name: (r) => String(r.plateNumber),
    meta: (r) => [
      `${Number(r.capacityLiters).toLocaleString()} L`,
      r.gvwKg ? `${Number(r.gvwKg).toLocaleString()} kg GVW` : 'GVW not set',
      r.tareKg ? `${Number(r.tareKg).toLocaleString()} kg empty` : 'empty weight not set',
      r.axleConfig ? axleConfigLabel(String(r.axleConfig)) : null,
    ].filter(Boolean).join(' · '),
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
      // Tollway class is a number on the record; the picker gives a string.
      if (f.key === 'tollClass' && data[f.key] !== undefined && data[f.key] !== '') data[f.key] = Number(data[f.key])
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

      <div className="grid grid-cols-[220px_minmax(0,1fr)] items-start gap-[18px]">
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
                  <RowAction verb="edit" label={`Edit ${cfg.name(r)}`} onClick={() => openEdit(r)} />
                  <RowAction verb="delete" label={`Delete ${cfg.name(r)}`} onClick={() => setDeleting({ id: String(r.id), name: cfg.name(r) })} />
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
        // The record's own name, not the list it came from - "Seaoil
        // Distribution", not "Suppliers". A new one is named by what it will be.
        title={editId ? cfg.name(form) || cfg.title : `New ${SINGULAR[kind]}`}
        subtitle={cfg.blurb}
        onClose={() => setFormOpen(false)}
        width={kind === 'warehouses' ? 880 : 760}
        footer={
          <>
            <GhostButton onClick={() => setFormOpen(false)}>Cancel</GhostButton>
            <PrimaryButton onClick={save}>{editId ? 'Save changes' : `Add ${SINGULAR[kind]}`}</PrimaryButton>
          </>
        }
      >
        {/* A depot is placed on the map beside its fields, not above them:
            click the gate, or find the address and nudge the pin. The
            coordinates on the right fill themselves in and stay editable. */}
        <div className={kind === 'warehouses' ? 'grid grid-cols-[1.15fr_1fr] gap-x-[20px]' : ''}>
          {kind === 'warehouses' && (
            <MapPicker
              value={Number(form.lat) && Number(form.lng) ? { lat: Number(form.lat), lng: Number(form.lng) } : null}
              // The pin is the truth: dropping it fills the address with
              // what is at that spot, and the field stays editable after.
              onChange={(p, lbl) => setForm((x) => ({ ...x, lat: p.lat, lng: p.lng, ...(lbl ? { address: lbl } : {}) }))}
              height={300}
              placeholder="Find the depot’s address…"
              pinLabel="Depot"
            />
          )}
          <div>
            {cfg.sections.map((section, i) => (
              <div key={section.title}>
                <FormSection first={i === 0}>{section.title}</FormSection>
                <div className="grid gap-x-4 gap-y-[12px]" style={{ gridTemplateColumns: `repeat(${section.cols}, minmax(0, 1fr))` }}>
                  {section.keys.map((key) => {
                    const f = cfg.fields.find((x) => x.key === key)
                    if (!f) return null
                    return (
                      <div key={f.key} style={{ gridColumn: `span ${Math.min(f.span ?? 1, section.cols)}` }}>
                        <Field label={f.label} hint={f.hint}>
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
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </Dialog>
      )}

      <Dialog
        open={deleting !== null}
        title={`Delete ${deleting?.name ?? 'this record'}?`}
        subtitle={`${cfg ? SINGULAR[kind].charAt(0).toUpperCase() + SINGULAR[kind].slice(1) : 'Record'} · cannot be undone`}
        onClose={() => setDeleting(null)}
        width={480}
        footer={
          <>
            <GhostButton onClick={() => setDeleting(null)}>Cancel</GhostButton>
            <PrimaryButton tone="danger" onClick={remove}>Delete {cfg ? SINGULAR[kind] : 'record'}</PrimaryButton>
          </>
        }
      >
        <p className="m-0 text-[13px] leading-[1.5] text-lab">
          If anything already points at this record - a purchase, a sale, a trip - the delete is
          refused and you are told what is holding it. Nothing else changes.
        </p>
      </Dialog>

      <Dialog
        open={resetting}
        title="Replace everything with the demo data?"
        subtitle="Every record in the system · cannot be undone"
        onClose={() => setResetting(false)}
        width={480}
        footer={
          <>
            <GhostButton onClick={() => setResetting(false)}>Cancel</GhostButton>
            <PrimaryButton tone="danger" onClick={() => { setResetting(false); resetDemoData() }}>Replace with demo data</PrimaryButton>
          </>
        }
      >
        <p className="m-0 text-[13px] leading-[1.5] text-lab">
          Sales, purchases, trips, attendance, payroll runs and every reference record are deleted and
          replaced with the sample set. Seats are kept.
        </p>
      </Dialog>
    </div>
  )
}

/** What one of each list is called, for a dialog title that names the record
 *  rather than the list it came from. */
const SINGULAR: Record<Kind | 'seats', string> = {
  suppliers: 'supplier',
  haulers: 'hauler',
  warehouses: 'depot',
  agents: 'agent',
  customers: 'customer',
  bankAccounts: 'bank account',
  trucks: 'truck',
  seats: 'seat',
}
