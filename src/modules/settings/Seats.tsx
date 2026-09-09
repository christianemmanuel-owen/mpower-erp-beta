import { useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import { useTable } from '../../lib/data'
import { ApiError } from '../../lib/api'
import { repos } from '../../data/repo'
import type { ModuleKey, Seat } from '../../data/types'
import { MODULES, useAuth } from '../../lib/auth'
import { Chip, Dialog, Field, GhostButton, InfoTip, Input, PrimaryButton } from '../../components/ui'

interface SeatForm {
  name: string
  username: string
  role: string
  password: string
  isAdmin: boolean
  modules: ModuleKey[]
}

const emptyForm: SeatForm = { name: '', username: '', role: '', password: '', isAdmin: false, modules: ['dashboard'] }

export default function Seats() {
  const { seat: me } = useAuth()
  const seats = useTable('seats')
  const [formOpen, setFormOpen] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState<SeatForm>(emptyForm)
  const [error, setError] = useState('')

  function openNew() {
    setEditId(null)
    setForm(emptyForm)
    setError('')
    setFormOpen(true)
  }

  function openEdit(s: Seat) {
    setEditId(s.id)
    setForm({ name: s.name, username: s.username, role: s.role, password: '', isAdmin: s.isAdmin, modules: s.modules })
    setError('')
    setFormOpen(true)
  }

  function toggleModule(key: ModuleKey) {
    setForm((f) => ({ ...f, modules: f.modules.includes(key) ? f.modules.filter((m) => m !== key) : [...f.modules, key] }))
  }

  async function save() {
    setError('')
    const name = form.name.trim()
    const username = form.username.trim().toLowerCase()
    if (!name || !username) return setError('Name and username are required.')
    if (!/^[a-z0-9._-]+$/.test(username)) return setError('Username can only use letters, numbers, dots, dashes and underscores.')
    if (!editId && !form.password) return setError('New seats need a password.')
    if (form.password && form.password.length < 4) return setError('Password must be at least 4 characters.')
    if (!form.isAdmin && form.modules.length === 0) return setError('Non-admin seats need at least one module, or they can’t see anything after logging in.')

    const clash = (seats ?? []).find((s) => s.username.toLowerCase() === username && s.id !== editId)
    if (clash) return setError(`Username “${username}” is already taken by ${clash.name}.`)

    // Demoting or de-moduling the last admin would lock everyone out of seat management.
    if (editId && !form.isAdmin) {
      const otherAdmins = (seats ?? []).filter((s) => s.isAdmin && s.id !== editId)
      const editing = (seats ?? []).find((s) => s.id === editId)
      if (editing?.isAdmin && otherAdmins.length === 0) return setError('This is the only admin seat - make another seat admin first.')
    }

    // The server hashes the password and re-checks every guard (unique username,
    // last-admin protection) - the checks above just give friendlier, faster errors.
    const data = {
      name,
      username,
      role: form.role.trim() || (form.isAdmin ? 'Admin' : 'Staff'),
      isAdmin: form.isAdmin,
      modules: form.isAdmin ? [] : form.modules,
      ...(form.password ? { password: form.password } : {}),
    }

    try {
      if (editId) await repos.seats.update(editId, data)
      else await repos.seats.add(data)
    } catch (e) {
      return setError(e instanceof ApiError ? e.message : 'Couldn’t save this seat.')
    }
    setFormOpen(false)
  }

  async function remove(s: Seat) {
    setError('')
    if (s.id === me?.id) return setError('You can’t delete the seat you’re signed in with.')
    if (s.isAdmin && (seats ?? []).filter((x) => x.isAdmin).length <= 1) {
      return setError('This is the only admin seat - make another seat admin before deleting it.')
    }
    if (!confirm(`Delete the seat for ${s.name} (@${s.username})? They won’t be able to sign in anymore.`)) return
    try {
      await repos.seats.remove(s.id)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Couldn’t delete this seat.')
    }
  }

  const moduleSummary = (s: Seat) =>
    s.isAdmin ? 'All modules' : MODULES.filter((m) => s.modules.includes(m.key)).map((m) => m.label).join(', ') || 'No modules'

  return (
    <>
      {error && !formOpen && <div className="mb-[18px] rounded-[10px] border border-redf/30 bg-redbadge p-3 text-[13px] text-redtext">{error}</div>}

      <div className="rise rounded-[14px] border border-line bg-white" style={{ animationDelay: '100ms' }}>
        <div className="flex items-center justify-between border-b border-fill2 px-5 py-[14px]">
          <h3 className="m-0 text-[15px] font-semibold">Seats</h3>
          <PrimaryButton onClick={openNew}>+ Add seat</PrimaryButton>
        </div>
        <div className="px-5 pb-[14px] pt-2">
          {(seats ?? []).map((s, i) => (
            <div key={s.id} className={`flex items-center gap-3 py-[11px] text-[13px] ${i < (seats?.length ?? 0) - 1 ? 'border-b border-fill2' : ''}`}>
              <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[9px] bg-fill2 text-[11px] font-semibold text-sec">
                {s.name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()}
              </span>
              <div className="flex-1">
                <p className="m-0 flex items-center gap-2 font-semibold">
                  {s.name}
                  <span className="font-normal text-faint">@{s.username}</span>
                  {s.isAdmin && (
                    <span className="inline-flex items-center gap-1 rounded-[6px] bg-tealbadge px-2 py-[3px] text-[11px] font-semibold uppercase text-tealtext">
                      <ShieldCheck size={11} strokeWidth={2.5} /> Admin
                    </span>
                  )}
                  {s.id === me?.id && <Chip status="scheduled" text="You" />}
                </p>
                <p className="m-0 text-[12px] text-faint">{s.role} · {moduleSummary(s)}</p>
              </div>
              <button onClick={() => openEdit(s)} className="cursor-pointer px-[6px] py-1 text-[11px] font-semibold uppercase text-tealtext hover:underline">Edit</button>
              <button onClick={() => remove(s)} className="cursor-pointer px-[6px] py-1 text-[11px] font-semibold uppercase text-redtext hover:underline">Delete</button>
            </div>
          ))}
          {(seats ?? []).length === 0 && <p className="py-6 text-center text-[13px] text-faint">No seats yet.</p>}
        </div>
      </div>

      <Dialog
        open={formOpen} title={editId ? 'Edit seat' : 'New seat'} onClose={() => setFormOpen(false)} width={560}
        footer={
          <>
            <PrimaryButton onClick={save}>Save</PrimaryButton>
            <GhostButton onClick={() => setFormOpen(false)}>Cancel</GhostButton>
          </>
        }
      >
        <div className="flex flex-col gap-[14px]">
          {error && <div className="rounded-[10px] border border-redf/30 bg-redbadge p-3 text-[13px] text-redtext">{error}</div>}

          <div className="grid grid-cols-2 gap-[14px]">
            <Field label="Full name">
              <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            </Field>
            <Field label="Role label" hint="Just a title - e.g. Owner, Encoder, Dispatcher.">
              <Input value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))} />
            </Field>
            <Field label="Username">
              <Input autoComplete="off" value={form.username} onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))} />
            </Field>
            <Field label={editId ? 'New password' : 'Password'} hint={editId ? 'Leave blank to keep the current password.' : undefined}>
              <Input type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} />
            </Field>
          </div>

          <label className="flex cursor-pointer items-start gap-[10px] rounded-[10px] border border-line bg-hovrow p-3">
            <input
              type="checkbox"
              checked={form.isAdmin}
              onChange={(e) => setForm((f) => ({ ...f, isAdmin: e.target.checked }))}
              className="mt-[2px] accent-current"
            />
            <span>
              <span className="block text-[13px] font-semibold text-lab">Administrator</span>
              <span className="block text-[12px] text-faint">Sees every module and can create, edit and delete seats.</span>
            </span>
          </label>

          {!form.isAdmin && (
            <div>
              <p className="mb-2 mt-1 flex items-center gap-[6px] text-[11px] font-semibold uppercase tracking-[.06em] text-mut">
                Module access
                <InfoTip label="What Admin and settings grants">
                  “Admin &amp; settings” grants master data — suppliers, depots, crew — but not seat
                  management. That stays admin-only.
                </InfoTip>
              </p>
              <div className="grid grid-cols-2 gap-2">
                {MODULES.map((m) => (
                  <label key={m.key} className={`flex cursor-pointer items-center gap-[10px] rounded-[10px] border p-3 text-[13px] font-semibold ${form.modules.includes(m.key) ? 'border-teal bg-tealbadge text-tealtext' : 'border-line text-lab hover:bg-fill2'}`}>
                    <input type="checkbox" checked={form.modules.includes(m.key)} onChange={() => toggleModule(m.key)} className="accent-current" />
                    {m.label}
                  </label>
                ))}
              </div>

            </div>
          )}
        </div>
      </Dialog>
    </>
  )
}
