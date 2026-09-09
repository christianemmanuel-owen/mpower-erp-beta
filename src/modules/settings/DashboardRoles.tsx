import { useState } from 'react'
import { useToast } from '../../components/Toast'
import { useTables } from '../../lib/data'
import { repos } from '../../data/repo'
import { Card, GhostButton, InfoTip, Input, PrimaryButton, SectionLabel } from '../../components/ui'
import {
  ALL_WIDGETS, WIDGET_LABELS, WIDGET_MODULE, configForRole, seatMaySee,
} from '../../lib/dashboardConfig'
import { DEFAULT_DASHBOARD_WIDGETS, type DashboardWidget } from '../../data/types'

/**
 * Per-role dashboard configuration - Exhibit A 1.1.
 *
 * Roles here are the free-text labels on seats ("Owner", "Encoder",
 * "Dispatcher"), so the editor lists the roles actually in use rather than a
 * fixed set. A role with no configuration shows the default view; that is stated
 * on screen, because an empty list of ticks would otherwise read as "this role
 * sees nothing".
 *
 * The important thing this screen must not imply: ticking a widget does not
 * grant access to its data. Module access still decides, and a widget the role's
 * seats cannot see is shown greyed with the reason. Letting an administrator
 * tick it and quietly see no effect would be worse than not offering it.
 */
export default function DashboardRoles() {
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState<DashboardWidget[]>([])
  const toast = useToast()
  const [saving, setSaving] = useState(false)

  const data = useTables(['seats', 'dashboardConfigs'] as const)
  if (!data) return null
  const { seats, dashboardConfigs } = data

  // Roles in use, plus any role a config was written for before anyone was
  // assigned to it - otherwise a config could become invisible and un-editable.
  const roles = [...new Set([
    ...seats.map((s) => s.role).filter((r) => r && r.trim() !== ''),
    ...dashboardConfigs.map((c) => c.role),
  ])].sort((a, b) => a.localeCompare(b))

  function startEdit(role: string) {
    const existing = configForRole(dashboardConfigs, role)
    setDraft(existing ? [...existing.widgets] : [...DEFAULT_DASHBOARD_WIDGETS])
    setEditing(role)
  }

  /** What the seats on this role can actually see - used to grey out widgets
   * their module access excludes. Admin seats see everything, so a role with any
   * admin in it has no restrictions. */
  function visibleTo(role: string) {
    const members = seats.filter((s) => s.role === role)
    if (members.length === 0) return null
    return (w: DashboardWidget) => members.some((m) => seatMaySee(m, w))
  }

  function toggle(w: DashboardWidget) {
    setDraft((d) => (d.includes(w) ? d.filter((x) => x !== w) : [...d, w]))
  }

  function move(w: DashboardWidget, dir: -1 | 1) {
    setDraft((d) => {
      const i = d.indexOf(w)
      const j = i + dir
      if (i < 0 || j < 0 || j >= d.length) return d
      const next = [...d]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
  }

  async function save() {
    if (!editing) return
    setSaving(true)
    try {
      const existing = configForRole(dashboardConfigs, editing)
      // knownWidgets is what this screen actually offered. Storing it is what
      // makes an unticked box durable while still letting a widget added in a
      // later release reach this role - see withWidgetsAddedSince.
      const payload = { role: editing, widgets: draft, knownWidgets: [...ALL_WIDGETS] }
      if (existing) await repos.dashboardConfigs.update(existing.id, payload)
      else await repos.dashboardConfigs.add(payload)
      toast(`Saved the ${editing} dashboard.`)
      setEditing(null)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Couldn’t save that dashboard.')
    } finally {
      setSaving(false)
    }
  }

  /** Removing the config returns the role to the default view - different from
   * saving an empty one, which means "show this role nothing". */
  async function resetToDefault(role: string) {
    const existing = configForRole(dashboardConfigs, role)
    if (!existing) return
    await repos.dashboardConfigs.remove(existing.id)
    toast(`${role} is back to the default dashboard.`)
    if (editing === role) setEditing(null)
  }

  const canSee = editing ? visibleTo(editing) : null

  return (
    <Card className="p-5" delay={150}>
      <div className="mb-3 flex items-baseline gap-3">
        <SectionLabel>Dashboard per role</SectionLabel>
        <InfoTip label="What ticking a widget does">
          Sales, Logistics, employee and managerial views can differ. Ticking a widget never grants
          access to its data - module access on the seat still decides.
        </InfoTip>
      </div>


      {roles.length === 0 && (
        <p className="m-0 text-[13px] text-faint">No seat roles yet - give a seat a role label in Seats first.</p>
      )}

      <div className="flex flex-col gap-2">
        {roles.map((role) => {
          const cfg = configForRole(dashboardConfigs, role)
          const members = seats.filter((s) => s.role === role).length
          const isEditing = editing === role
          return (
            <div key={role} className="rounded-[10px] border border-fill2 px-3 py-2">
              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <p className="m-0 text-[13px] font-semibold">{role}</p>
                  <p className="m-0 text-[12px] text-faint">
                    {members} seat{members === 1 ? '' : 's'} ·{' '}
                    {cfg
                      ? cfg.widgets.length === 0
                        ? 'configured to show nothing'
                        : `${cfg.widgets.length} widget${cfg.widgets.length === 1 ? '' : 's'}`
                      : 'default view'}
                  </p>
                </div>
                {cfg && !isEditing && (
                  <button
                    type="button"
                    onClick={() => resetToDefault(role)}
                    className="cursor-pointer border-0 bg-transparent text-[11px] font-semibold uppercase text-faint hover:text-redtext hover:underline"
                  >
                    Reset
                  </button>
                )}
                {!isEditing && (
                  <button
                    type="button"
                    onClick={() => startEdit(role)}
                    className="cursor-pointer border-0 bg-transparent text-[11px] font-semibold uppercase text-tealtext hover:underline"
                  >
                    Configure
                  </button>
                )}
              </div>

              {isEditing && (
                <div className="mt-3 border-t border-fill2 pt-3">
                  <div className="flex flex-col gap-[2px]">
                    {/* Ticked widgets first, in their display order, so the list
                        reads as the dashboard it describes. */}
                    {[...draft, ...ALL_WIDGETS.filter((w) => !draft.includes(w))].map((w) => {
                      const on = draft.includes(w)
                      const allowed = canSee ? canSee(w) : true
                      const module = WIDGET_MODULE[w]
                      return (
                        <div key={w} className="flex items-center gap-2 py-[3px] text-[13px]">
                          <input
                            type="checkbox"
                            checked={on}
                            disabled={!allowed}
                            onChange={() => toggle(w)}
                            className="cursor-pointer disabled:cursor-not-allowed"
                          />
                          <span className={allowed ? '' : 'text-faint'}>{WIDGET_LABELS[w]}</span>
                          {!allowed && (
                            <span className="text-[11px] text-faint">
                              - needs {module} access, which this role’s seats don’t have
                            </span>
                          )}
                          {on && allowed && (
                            <span className="ml-auto flex gap-1">
                              <button
                                type="button"
                                onClick={() => move(w, -1)}
                                className="cursor-pointer rounded border border-inputline bg-white px-[6px] text-[11px] text-sec hover:bg-fill2"
                                aria-label={`Move ${WIDGET_LABELS[w]} up`}
                              >
                                ↑
                              </button>
                              <button
                                type="button"
                                onClick={() => move(w, 1)}
                                className="cursor-pointer rounded border border-inputline bg-white px-[6px] text-[11px] text-sec hover:bg-fill2"
                                aria-label={`Move ${WIDGET_LABELS[w]} down`}
                              >
                                ↓
                              </button>
                            </span>
                          )}
                        </div>
                      )
                    })}
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    <GhostButton onClick={() => setEditing(null)}>Cancel</GhostButton>
                    <PrimaryButton onClick={save}>{saving ? 'Saving…' : 'Save'}</PrimaryButton>
                    {draft.length === 0 && (
                      <span className="text-[12px] text-ambertext">
                        Saving with nothing ticked gives this role an empty dashboard. Use Reset for the default view.
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Kept out of the way - an administrator adding a role here before the
          seat exists is a reasonable thing to want. */}
      <NewRoleForm
        existing={roles}
        onCreate={(role) => startEdit(role)}
      />
    </Card>
  )
}

function NewRoleForm({ existing, onCreate }: { existing: string[]; onCreate: (role: string) => void }) {
  const [value, setValue] = useState('')
  const clash = existing.some((r) => r.trim().toLowerCase() === value.trim().toLowerCase())
  return (
    <div className="mt-4 flex items-center gap-2 border-t border-fill2 pt-3">
      <Input
        value={value}
        placeholder="Configure a role before its seats exist…"
        onChange={(e) => setValue(e.target.value)}
      />
      <button
        type="button"
        disabled={!value.trim() || clash}
        onClick={() => { onCreate(value.trim()); setValue('') }}
        className="shrink-0 cursor-pointer rounded-[8px] border border-inputline bg-white px-3 py-[7px] text-[12px] font-semibold text-tealbtn hover:bg-fill2 disabled:opacity-40"
      >
        Add
      </button>
      {clash && <span className="text-[12px] text-faint">Already listed.</span>}
    </div>
  )
}
