import { useState } from 'react'
import { ArrowDown, ArrowUp, Plus } from 'lucide-react'
import { useToast } from '../../components/Toast'
import { useTables } from '../../lib/data'
import { repos } from '../../data/repo'
import { MODULES } from '../../lib/auth'
import { RailAside, RailSection } from '../../components/SummaryRail'
import { Card, Chip, Dialog, FormSection, GhostButton, InfoTip, Input, PrimaryButton, RowAction, WIDE_DIALOG, PageSkeleton } from '../../components/ui'
import {
  ALL_WIDGETS, DASHBOARD_TABS, WIDGET_LABELS, WIDGET_MODULE, WIDGET_TAB, WIDGET_WIDTH,
  configForRole, seatMaySee, type DashboardTab,
} from '../../lib/dashboardConfig'
import { DEFAULT_DASHBOARD_WIDGETS, type DashboardWidget, type Seat } from '../../data/types'

/**
 * Per-role dashboard configuration - Exhibit A 1.1.
 *
 * Roles are the free-text labels on seats ("Owner", "Dispatcher"), so the list
 * is the roles actually in use plus any a configuration was written for. A
 * role with no configuration shows the default view, and says so.
 *
 * The editor is the seat dialog's shape: roles down the left so one can be
 * checked against the next without closing, the widgets in the middle grouped
 * the way the dashboard itself groups them (its four tabs), and on the right a
 * drawing of the dashboard the selection produces - which is the only honest
 * answer to "what will the dispatcher see", since a list of ticks is not one.
 *
 * The important thing this screen must not imply: ticking a widget does not
 * grant access to its data. Module access still decides, and a widget the
 * role's seats cannot see is greyed with the module it needs. Letting an
 * administrator tick it and quietly see no effect would be worse than not
 * offering it.
 */
export default function DashboardRoles() {
  const toast = useToast()
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState<DashboardWidget[]>([])
  const [saving, setSaving] = useState(false)
  const [adding, setAdding] = useState(false)

  const data = useTables(['seats', 'dashboardConfigs'] as const)
  if (!data) return <PageSkeleton />
  const { seats, dashboardConfigs } = data

  // Roles in use, plus any role a config was written for before anyone was
  // assigned to it - otherwise a config could become invisible and un-editable.
  const roles = [...new Set([
    ...seats.map((s) => s.role).filter((r) => r && r.trim() !== ''),
    ...dashboardConfigs.map((c) => c.role),
  ])].sort((a, b) => a.localeCompare(b))

  const membersOf = (role: string) => seats.filter((s) => s.role.trim().toLowerCase() === role.trim().toLowerCase())

  /** What the seats on this role can actually see. A role with no seats yet
   *  has no restriction to draw, so every widget is offered. */
  const canSee = (role: string) => {
    const members = membersOf(role)
    return (w: DashboardWidget) => members.length === 0 || members.some((m) => seatMaySee(m, w))
  }

  function open(role: string) {
    const existing = configForRole(dashboardConfigs, role)
    setDraft(existing ? [...existing.widgets] : [...DEFAULT_DASHBOARD_WIDGETS])
    setEditing(role)
    setAdding(false)
  }

  function toggle(w: DashboardWidget) {
    setDraft((d) => (d.includes(w) ? d.filter((x) => x !== w) : [...d, w]))
  }

  /** Move within the widget's own tab: the dashboard reorders per tab, so the
   *  editor does too - swapping across tabs would reorder nothing visible. */
  function move(w: DashboardWidget, dir: -1 | 1) {
    setDraft((d) => {
      const group = d.filter((x) => WIDGET_TAB[x] === WIDGET_TAB[w])
      const i = group.indexOf(w)
      const j = i + dir
      if (i < 0 || j < 0 || j >= group.length) return d
      const a = d.indexOf(group[i])
      const b = d.indexOf(group[j])
      const next = [...d]
      ;[next[a], next[b]] = [next[b], next[a]]
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
      toast(`Dashboard saved for ${editing}.`)
      setEditing(null)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Unable to save this dashboard.')
    } finally {
      setSaving(false)
    }
  }

  /** Removing the config returns the role to the default view - different from
   *  saving an empty one, which means "show this role nothing". */
  async function resetToDefault() {
    if (!editing) return
    const existing = configForRole(dashboardConfigs, editing)
    if (existing) {
      try {
        await repos.dashboardConfigs.remove(existing.id)
        toast(`${editing} restored to the default dashboard.`)
      } catch (e) {
        return toast(e instanceof Error ? e.message : 'Unable to reset this dashboard.')
      }
    }
    setEditing(null)
  }

  const allowed = editing ? canSee(editing) : () => true
  const members = editing ? membersOf(editing) : []
  const cfg = editing ? configForRole(dashboardConfigs, editing) : undefined

  return (
    <>
      <Card delay={150}>
        <div className="flex items-center gap-[10px] border-b border-linesoft px-5 py-[12px]">
          <h3 className="m-0 text-[15px] font-semibold">Dashboard per role</h3>
          <span className="font-meta text-[12px] text-mut">{roles.length}</span>
          <InfoTip label="What this configures">
            Which dashboard cards each role sees, and in what order. It never grants access to data:
            module access on the seat still decides what appears.
          </InfoTip>
          <span className="ml-auto">
            <PrimaryButton size="sm" onClick={() => { setAdding(true); setEditing(null) }}>+ Add role</PrimaryButton>
          </span>
        </div>

        {roles.map((role) => {
          const c = configForRole(dashboardConfigs, role)
          const n = membersOf(role).length
          const shown = c ? c.widgets : DEFAULT_DASHBOARD_WIDGETS
          return (
            <div key={role} className="flex items-center gap-[14px] border-b border-linesoft px-5 py-[9px] text-[13px] last:border-b-0">
              <span className="w-[170px] shrink-0 truncate font-semibold">{role}</span>
              <span className="w-[70px] shrink-0 font-meta text-[12px] text-faint">{n} seat{n === 1 ? '' : 's'}</span>
              <LayoutBars shown={shown} />
              <span className="w-[130px] shrink-0 text-right font-meta text-[12px] text-mut">
                {!c ? 'Default'
                  : c.widgets.length === 0 ? <Chip status="pending" text="Empty" />
                  : `${c.widgets.length} of ${ALL_WIDGETS.length} widgets`}
              </span>
              <RowAction verb="edit" label={`Configure ${role}`} onClick={() => open(role)} />
            </div>
          )
        })}
        {roles.length === 0 && (
          <p className="m-0 py-6 text-center text-[13px] text-faint">No roles yet. Give a seat a role label, or add one here.</p>
        )}
      </Card>

      <Dialog
        open={editing !== null || adding}
        title={editing ?? 'New role'}
        subtitle={editing
          ? `Dashboard for ${members.length} seat${members.length === 1 ? '' : 's'}`
          : 'Configure a dashboard before its seats exist'}
        onClose={() => { setEditing(null); setAdding(false) }}
        width={WIDE_DIALOG}
        nav={
          <>
            <p className="m-0 mb-[8px] px-[8px] font-meta text-[10px] font-semibold uppercase tracking-[.09em] text-faint">Roles</p>
            {roles.map((role) => {
              const on = role === editing
              const c = configForRole(dashboardConfigs, role)
              const n = membersOf(role).length
              return (
                <button
                  key={role}
                  type="button"
                  onClick={() => open(role)}
                  aria-pressed={on}
                  className={`mb-[2px] block w-full cursor-pointer rounded-[6px] border-0 px-[10px] py-[8px] text-left transition-colors ${
                    on ? 'bg-white shadow-[inset_0_0_0_1px_var(--color-line)]' : 'bg-transparent hover:bg-white/60'
                  }`}
                >
                  <span className={`block truncate text-[13px] font-semibold ${on ? 'text-ink' : 'text-lab'}`}>{role}</span>
                  <span className="mt-[2px] block font-meta text-[12px] leading-[1.4] text-faint">
                    {n} seat{n === 1 ? '' : 's'} · {!c ? 'Default' : c.widgets.length === 0 ? 'Empty' : `${c.widgets.length} widgets`}
                  </span>
                </button>
              )
            })}
            <button
              type="button"
              onClick={() => { setAdding(true); setEditing(null) }}
              className="mt-[6px] flex w-full cursor-pointer items-center gap-[6px] rounded-[6px] border-0 bg-transparent px-[10px] py-[8px] text-left font-meta text-[12px] font-semibold text-sec hover:bg-white/60 hover:text-ink"
            >
              <Plus size={13} strokeWidth={2} /> Add role
            </button>
          </>
        }
        rail={editing ? <Preview draft={draft} allowed={allowed} members={members} /> : undefined}
        footer={
          editing ? (
            <>
              {cfg && <GhostButton onClick={resetToDefault}>Reset to default</GhostButton>}
              <span className="flex-1" />
              <GhostButton onClick={() => setEditing(null)}>Cancel</GhostButton>
              <PrimaryButton onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</PrimaryButton>
            </>
          ) : (
            <GhostButton onClick={() => setAdding(false)}>Cancel</GhostButton>
          )
        }
      >
        {editing ? (
          DASHBOARD_TABS.map((tab, i) => {
            const inTab = ALL_WIDGETS.filter((w) => WIDGET_TAB[w] === tab)
            // Ticked first, in their display order, so the group reads as the
            // tab it describes; the rest follow in the default order.
            const ordered = [...draft.filter((w) => WIDGET_TAB[w] === tab), ...inTab.filter((w) => !draft.includes(w))]
            const on = ordered.filter((w) => draft.includes(w))
            return (
              <div key={tab}>
                <FormSection first={i === 0} right={<span className="font-meta text-[12px] font-normal normal-case tracking-normal text-faint">{on.length} of {inTab.length}</span>}>
                  {tab}
                </FormSection>
                <div className="grid grid-cols-2 gap-2">
                  {ordered.map((w) => (
                    <WidgetTile
                      key={w}
                      widget={w}
                      on={draft.includes(w)}
                      allowed={allowed(w)}
                      first={on[0] === w}
                      last={on[on.length - 1] === w}
                      onToggle={() => toggle(w)}
                      onMove={(dir) => move(w, dir)}
                    />
                  ))}
                </div>
              </div>
            )
          })
        ) : (
          <NewRoleForm existing={roles} onCreate={open} />
        )}
      </Dialog>
    </>
  )
}

/** The layout as a row of bars: wide for a full-width card, narrow for a half,
 *  dark when shown and pale when not. Read at a glance, one row per role. */
function LayoutBars({ shown }: { shown: DashboardWidget[] }) {
  const set = new Set(shown)
  return (
    <span className="flex min-w-0 flex-1 items-center gap-[3px]" aria-hidden>
      {ALL_WIDGETS.filter((w) => WIDGET_WIDTH[w] !== 'rail').map((w) => (
        <span
          key={w}
          title={WIDGET_LABELS[w]}
          className={`block h-[8px] shrink-0 rounded-[2px] ${WIDGET_WIDTH[w] === 'full' ? 'w-[26px]' : 'w-[13px]'} ${
            set.has(w) ? 'bg-ink/85' : 'bg-inputline'
          }`}
        />
      ))}
    </span>
  )
}

const WIDTH_MARK: Record<'full' | 'half' | 'rail', string> = { full: 'F', half: 'H', rail: 'RAIL' }

function WidgetTile({ widget, on, allowed, first, last, onToggle, onMove }: {
  widget: DashboardWidget
  on: boolean
  allowed: boolean
  first: boolean
  last: boolean
  onToggle: () => void
  onMove: (dir: -1 | 1) => void
}) {
  const need = WIDGET_MODULE[widget]
  const needLabel = need ? MODULES.find((m) => m.key === need)?.label ?? need : ''
  return (
    <label
      className={`flex items-center gap-[9px] rounded-[6px] border px-[10px] py-[8px] text-[13px] ${
        !allowed ? 'cursor-not-allowed border-line text-faint'
          : on ? 'cursor-pointer border-ink bg-paper font-semibold text-ink'
          : 'cursor-pointer border-line text-lab hover:bg-paper'
      }`}
    >
      <input
        type="checkbox"
        checked={on}
        disabled={!allowed}
        onChange={onToggle}
        aria-label={WIDGET_LABELS[widget]}
        className="h-[14px] w-[14px] shrink-0 accent-ink disabled:cursor-not-allowed"
      />
      <span className="min-w-0 leading-[1.25]">{WIDGET_LABELS[widget]}</span>
      {!allowed ? (
        <span className="ml-auto shrink-0 font-meta text-[11px] font-normal text-faint">Needs {needLabel}</span>
      ) : on && WIDGET_WIDTH[widget] !== 'rail' ? (
        <span className="ml-auto flex shrink-0 gap-[2px]">
          <MoveButton dir={-1} disabled={first} label={`Move ${WIDGET_LABELS[widget]} up`} onClick={() => onMove(-1)} />
          <MoveButton dir={1} disabled={last} label={`Move ${WIDGET_LABELS[widget]} down`} onClick={() => onMove(1)} />
        </span>
      ) : (
        <span className="ml-auto shrink-0 font-meta text-[10px] font-semibold tracking-[.06em] text-faint">{WIDTH_MARK[WIDGET_WIDTH[widget]]}</span>
      )}
    </label>
  )
}

function MoveButton({ dir, disabled, label, onClick }: { dir: -1 | 1; disabled: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={label}
      onClick={(e) => { e.preventDefault(); onClick() }}
      className="inline-flex h-[20px] w-[20px] cursor-pointer items-center justify-center rounded-[4px] border border-inputline bg-white text-sec hover:bg-fill2 disabled:cursor-default disabled:opacity-30"
    >
      {dir === -1 ? <ArrowUp size={11} strokeWidth={2} /> : <ArrowDown size={11} strokeWidth={2} />}
    </button>
  )
}

/**
 * The dashboard this selection produces, drawn as it will pack: full-width
 * cards across, halves paired, per tab. A ticked widget the role's seats
 * cannot see is dashed - it is in the configuration and not on the screen,
 * and the difference is the whole point of the drawing.
 */
function Preview({ draft, allowed, members }: {
  draft: DashboardWidget[]
  allowed: (w: DashboardWidget) => boolean
  members: Seat[]
}) {
  const [tab, setTab] = useState<DashboardTab>('Overview')
  const visible = (t: DashboardTab) => draft.filter((w) => WIDGET_TAB[w] === t && WIDGET_WIDTH[w] !== 'rail')
  const tabsWithContent = DASHBOARD_TABS.filter((t) => visible(t).some(allowed))
  const shownTab = tabsWithContent.includes(tab) ? tab : (tabsWithContent[0] ?? 'Overview')
  const hidden = DASHBOARD_TABS.filter((t) => !tabsWithContent.includes(t))
  const blocks = visible(shownTab)

  return (
    <>
      <RailSection title="Dashboard preview">
        <div className="rounded-[8px] border border-line bg-white p-[10px]">
          <div className="mb-[8px] flex gap-[10px] border-b border-linesoft pb-[6px]">
            {DASHBOARD_TABS.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                disabled={!tabsWithContent.includes(t)}
                className={`cursor-pointer border-0 bg-transparent p-0 font-meta text-[10px] font-semibold ${
                  t === shownTab ? 'text-ink' : tabsWithContent.includes(t) ? 'text-mut' : 'text-faint'
                } disabled:cursor-default`}
              >
                {t}
              </button>
            ))}
          </div>
          {blocks.length === 0 ? (
            <p className="m-0 py-3 text-center font-meta text-[11px] text-faint">Nothing on this tab</p>
          ) : (
            <div className="grid grid-cols-2 gap-[5px]">
              {blocks.map((w) => (
                <span
                  key={w}
                  className={`truncate rounded-[4px] border px-[7px] py-[5px] font-meta text-[11px] ${
                    WIDGET_WIDTH[w] === 'full' ? 'col-span-2' : ''
                  } ${allowed(w) ? 'border-line bg-paper text-lab' : 'border-dashed border-line bg-white text-faint'}`}
                >
                  {WIDGET_LABELS[w]}
                </span>
              ))}
            </div>
          )}
        </div>
        {draft.length === 0 && <RailAside tone="bad">Nothing selected. Seats on this role would see an empty dashboard.</RailAside>}
        {draft.length > 0 && hidden.length > 0 && (
          <RailAside>
            {hidden.join(', ')} {hidden.length === 1 ? 'has' : 'have'} nothing to show and will not appear as {hidden.length === 1 ? 'a tab' : 'tabs'}.
          </RailAside>
        )}
        {draft.includes('todos') && <RailAside>To-do list appears in the side rail, not on a tab.</RailAside>}
      </RailSection>

      <RailSection
        title={
          <span className="inline-flex items-center gap-[6px]">
            Access
            <InfoTip label="How access is decided">
              Configuration narrows the dashboard; it never grants access. A widget appears only when the
              seat’s module access allows it and this configuration includes it.
            </InfoTip>
          </span>
        }
      >
        <RailAside>
          {members.length === 0
            ? 'No seats hold this role yet. Every widget is offered; module access will apply once seats are assigned.'
            : `Applies to ${members.length} seat${members.length === 1 ? '' : 's'}. Module access on each seat decides what actually appears.`}
        </RailAside>
      </RailSection>
    </>
  )
}

function NewRoleForm({ existing, onCreate }: { existing: string[]; onCreate: (role: string) => void }) {
  const [value, setValue] = useState('')
  const clash = existing.some((r) => r.trim().toLowerCase() === value.trim().toLowerCase())
  return (
    <div className="max-w-[420px]">
      <label className="block">
        <span className="mb-[6px] block font-meta text-[12px] font-semibold text-lab">Role label</span>
        <Input value={value} placeholder="e.g. Dispatcher" onChange={(e) => setValue(e.target.value)} />
      </label>
      <p className="m-0 mt-[6px] font-meta text-[12px] text-faint">
        {clash ? 'This role already exists.' : 'Must match the role label on the seats, exactly as typed there.'}
      </p>
      <div className="mt-4">
        <PrimaryButton disabled={!value.trim() || clash} onClick={() => onCreate(value.trim())}>Continue</PrimaryButton>
      </div>
    </div>
  )
}

