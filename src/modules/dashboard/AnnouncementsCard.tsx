import { Fragment, useState } from 'react'
import { Pin, PinOff, SquarePen } from 'lucide-react'
import { Avatar, Card, Field, GhostButton, Input, PrimaryButton, SectionLabel } from '../../components/ui'
import ComposeDock from '../../components/ComposeDock'
import { useTable } from '../../lib/data'
import { useAuth } from '../../lib/auth'
import { repos } from '../../data/repo'
import { fmtDate } from '../../lib/format'
import { timeAgo } from '../../lib/notifications'
import type { Announcement, ModuleKey } from '../../data/types'

/**
 * Announcement board - Secondary Feature 2.4, surfaced on the Dashboard.
 *
 * Two rules decide what a given person sees, and they are different from each
 * other:
 *
 * **Audience.** An announcement with no `audienceModules` goes to everyone. One
 * with modules listed reaches only seats holding at least one of them, so
 * "diesel price change" can go to Sales without landing on a driver's screen.
 * Admins see everything, matching every other access decision in the System.
 *
 * **Expiry.** An expired announcement disappears from the board rather than
 * being deleted, because "what did the notice actually say" is a question people
 * ask after the fact. Nothing here removes the record.
 *
 * Both rules were readable and neither was writable: the board filtered on
 * `audienceModules` and `expiresAt`, but the only way to set either was to edit
 * the database by hand. The dialog now offers both, so the behaviour this
 * comment describes is reachable from the app.
 *
 * Posting emits a notification through the shared channel (2.11) - that happens
 * server-side on the write, not here, so a post made through any route notifies.
 */

/**
 * Audience choices, named as the sidebar names them. Module keys are an
 * internal spelling ('collection', 'logistics'); a notice that says it went to
 * "Collect, Trips" matches what the reader clicks on to get there.
 *
 * 'dashboard' and 'settings' are deliberately absent. Every seat holds
 * dashboard, so targeting it is the same as targeting nobody in particular, and
 * settings is the admin flag by another name.
 */
const AUDIENCE: { module: ModuleKey; label: string }[] = [
  { module: 'inventory', label: 'Stock' },
  { module: 'logistics', label: 'Trips' },
  { module: 'sales', label: 'Sales' },
  { module: 'collection', label: 'Collect' },
  { module: 'accounts', label: 'Accounts' },
  { module: 'hr', label: 'HR' },
]

const audienceLabel = (m: string) => AUDIENCE.find((a) => a.module === m)?.label ?? m

/** Rows shown before the board asks to be expanded. */
const COLLAPSED = 4

export default function AnnouncementsCard({ delay = 0, composing = false, onCloseCompose, onCompose }: {
  delay?: number
  /** Whether the compose dock is expanded. Owned by the page so a deep link or
   * a quick-create can open it, but the dock's own collapsed bar is what opens
   * it in normal use. */
  composing?: boolean
  onCloseCompose?: () => void
  onCompose?: () => void
}) {
  const { seat } = useAuth()
  const announcements = useTable('announcements')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [audience, setAudience] = useState<ModuleKey[]>([])
  const [expires, setExpires] = useState('')
  const [busy, setBusy] = useState(false)
  /** The post being edited, or null when the dialog is composing a new one. */
  const [editing, setEditing] = useState<Announcement | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [expanded, setExpanded] = useState(false)

  if (!announcements || !seat) return null

  const now = new Date().toISOString()
  const visible = announcements
    .filter((a) => !a.expiresAt || a.expiresAt > now)
    .filter((a) => {
      if (seat.isAdmin) return true
      if (!a.audienceModules || a.audienceModules.length === 0) return true
      return a.audienceModules.some((m) => (seat.modules ?? []).includes(m as ModuleKey))
    })
    .sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
      return b.createdAt.localeCompare(a.createdAt)
    })

  const pinnedCount = visible.filter((a) => a.pinned).length
  const shown = expanded ? visible : visible.slice(0, COLLAPSED)

  /** Anything typed but not posted. Drives both the panel's width and the mark
   * on the collapsed bar. */
  const hasDraft = !!(title.trim() || body.trim() || audience.length > 0 || expires)

  function closeDialog() {
    setTitle('')
    setBody('')
    setAudience([])
    setExpires('')
    setEditing(null)
    setConfirmingDelete(false)
    onCloseCompose?.()
  }

  function startEdit(a: Announcement) {
    setEditing(a)
    setTitle(a.title)
    setBody(a.body ?? '')
    setAudience(a.audienceModules ?? [])
    setExpires(a.expiresAt ? a.expiresAt.slice(0, 10) : '')
    setConfirmingDelete(false)
  }

  function toggleAudience(m: ModuleKey) {
    setAudience((prev) => (prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m]))
  }

  async function post() {
    if (!title.trim() || !seat) return
    setBusy(true)
    try {
      // Expiry runs to the end of the chosen day: picking today should leave
      // the notice up for the rest of today, not retire it on the spot.
      const expiresAt = expires ? new Date(`${expires}T23:59:59`).toISOString() : ''
      if (editing) {
        // Only the words and the reach change. Who posted it and when stay as
        // they were - rewriting the author on an edit would misattribute the
        // notice.
        //
        // An edit sends both reach fields every time, empty ones included.
        // Update is a merge server-side ({...existing, ...body}) and
        // JSON.stringify drops undefined keys, so sending `undefined` for a
        // cleared field leaves the old value standing: an admin who took the
        // audience back off a notice would watch it stay restricted. An empty
        // array and an empty string survive the round trip and both read as
        // falsy everywhere they are used.
        await repos.announcements.update(editing.id, {
          title: title.trim(),
          body: body.trim(),
          audienceModules: audience,
          expiresAt,
        })
      } else {
        // A new post omits what it does not have, so a plain notice carries no
        // empty fields at all.
        await repos.announcements.add({
          title: title.trim(),
          body: body.trim(),
          postedBy: seat.id,
          postedByName: seat.name,
          pinned: false,
          ...(audience.length > 0 ? { audienceModules: audience } : {}),
          ...(expiresAt ? { expiresAt } : {}),
        })
      }
      closeDialog()
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!editing) return
    setBusy(true)
    try {
      await repos.announcements.remove(editing.id)
      closeDialog()
    } finally {
      setBusy(false)
    }
  }

  const togglePin = (a: Announcement) => repos.announcements.update(a.id, { pinned: !a.pinned })

  return (
    <Card delay={delay}>
      <div className="flex items-center justify-between border-b border-line px-4 py-[10px]">
        <SectionLabel>Announcements</SectionLabel>
        {visible.length > 0 && (
          <span className="font-meta text-[12px] text-mut">{visible.length}</span>
        )}
      </div>

      {/* A docked compose panel rather than a modal.
          An inline form pushed the board down every time someone wrote a post,
          and a modal dimmed the board out entirely - but the board is usually
          the reason for the post, and half of what goes in one is read off the
          screen behind it. This leaves the page live and sits clear of the
          to-do rail. */}
      <ComposeDock
        show={!!seat.isAdmin}
        expanded={composing || !!editing}
        idleLabel="New announcement"
        title={editing ? 'Edit announcement' : 'New announcement'}
        // Narrow while empty, wider the moment there is something in it.
        width={hasDraft ? 520 : 400}
        hasDraft={hasDraft}
        onExpand={() => onCompose?.()}
        // Minimise keeps the draft; the page owns the fields, so it only has to
        // stop rendering the panel.
        onMinimise={() => { setEditing(null); onCloseCompose?.() }}
        onDiscard={closeDialog}
        footer={
          <>
            <PrimaryButton onClick={post}>
              {busy ? 'Saving…' : editing ? 'Save changes' : 'Post to the board'}
            </PrimaryButton>
            <GhostButton onClick={closeDialog}>Cancel</GhostButton>
            {editing && (
              // Two steps rather than a browser confirm: an expired notice is
              // hidden rather than deleted precisely because people ask what it
              // said afterwards, so removing one for good deserves a beat.
              <span className="ml-auto flex items-center gap-2">
                {confirmingDelete ? (
                  <>
                    <span className="font-meta text-[12px] text-mut">Delete for good?</span>
                    <button
                      type="button"
                      onClick={remove}
                      className="cursor-pointer rounded-[6px] border border-redf bg-white px-[13px] py-[6px] font-meta text-[12px] font-semibold text-redtext hover:bg-redbadge"
                    >
                      Delete
                    </button>
                    <GhostButton onClick={() => setConfirmingDelete(false)}>Keep</GhostButton>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmingDelete(true)}
                    className="cursor-pointer border-0 bg-transparent font-meta text-[12px] font-semibold text-mut hover:text-redtext"
                  >
                    Delete
                  </button>
                )}
              </span>
            )}
          </>
        }
      >
        <div className="flex flex-col gap-[14px]">
          <Field label="Headline">
            <Input value={title} autoFocus placeholder="e.g. Diesel price change from Monday" onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label="Details" hint="Optional. Everyone who can see the board sees this.">
            <Input value={body} placeholder="Anything they need to know" onChange={(e) => setBody(e.target.value)} />
          </Field>
          {/* Not a <Field>. Field is a <label>, and a label with no `for`
              attaches to the first labelable thing inside it - which here made
              the Stock chip announce itself as the whole legend plus every
              other chip's text. A group with its own labelledby reads each chip
              as itself. */}
          <div role="group" aria-labelledby="ann-audience-label">
            <span id="ann-audience-label" className="mb-1 block text-[13px] font-semibold text-lab">Who sees it</span>
            <span className="flex flex-wrap gap-[6px]">
              {AUDIENCE.map(({ module, label }) => {
                const on = audience.includes(module)
                return (
                  <button
                    key={module}
                    type="button"
                    role="checkbox"
                    aria-checked={on}
                    onClick={() => toggleAudience(module)}
                    className={`cursor-pointer rounded-[6px] border px-[10px] py-[5px] font-meta text-[12px] transition-colors ${
                      on
                        ? 'border-ink bg-ink font-semibold text-white'
                        : 'border-inputline bg-white text-sec hover:border-ink hover:text-ink'
                    }`}
                  >
                    {label}
                  </button>
                )
              })}
            </span>
            <span className="mt-1 block font-meta text-[12px] text-faint">
              Leave all off to post to everyone. Admins see every notice either way.
            </span>
          </div>
          <Field label="Hide after" hint="Optional. The notice leaves the board that evening. Nothing is deleted.">
            <Input type="date" value={expires} onChange={(e) => setExpires(e.target.value)} />
          </Field>
        </div>
      </ComposeDock>

      <div className={expanded ? 'max-h-[320px] overflow-y-auto' : ''}>
        {shown.map((a, i) => (
          // A Fragment, not a wrapper div: wrapping each row made every row the
          // last child of its own parent, so `last:border-0` stripped the rule
          // off all of them instead of the last one.
          <Fragment key={a.id}>
            {/* Pinning used to be a chip on every pinned row, which said the
                same thing the sort order already said, once per row. As a
                heading it is said once. */}
            {pinnedCount > 0 && (i === 0 || i === pinnedCount) && (
              <p className="m-0 border-b border-linesoft bg-paper px-4 py-[5px] font-meta text-[10px] font-semibold uppercase tracking-[.09em] text-faint">
                {i === 0 ? 'Pinned' : 'Recent'}
              </p>
            )}
            <div className="group flex gap-[10px] border-b border-linesoft px-4 py-[10px] transition-colors last:border-0 hover:bg-fill2">
              <span className="mt-[1px] shrink-0">
                <Avatar name={a.postedByName} size={24} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-start gap-2">
                  <span className="min-w-0 flex-1 text-[13px] font-semibold leading-[1.35]">{a.title}</span>
                  {seat.isAdmin && (
                    <span className="flex shrink-0 items-center gap-[6px]">
                      <button
                        type="button"
                        onClick={() => togglePin(a)}
                        aria-label={a.pinned ? `Unpin "${a.title}"` : `Pin "${a.title}"`}
                        className="cursor-pointer border-0 bg-transparent p-0 text-transparent group-hover:text-faint hover:!text-ink focus-visible:!text-ink"
                      >
                        {a.pinned ? <PinOff size={13} strokeWidth={1.9} /> : <Pin size={13} strokeWidth={1.9} />}
                      </button>
                      <button
                        type="button"
                        onClick={() => startEdit(a)}
                        aria-label={`Edit "${a.title}"`}
                        className="cursor-pointer border-0 bg-transparent p-0 text-transparent group-hover:text-faint hover:!text-ink focus-visible:!text-ink"
                      >
                        <SquarePen size={13} strokeWidth={1.9} />
                      </button>
                    </span>
                  )}
                </span>
                {a.body && (
                  <span className="mt-[2px] line-clamp-2 text-[12.5px] leading-[1.45] text-mut">{a.body}</span>
                )}
                <span className="mt-[3px] block font-meta text-[12px] text-faint">
                  {a.postedByName} · {timeAgo(a.createdAt)}
                  {a.audienceModules && a.audienceModules.length > 0 &&
                    ` · ${a.audienceModules.map(audienceLabel).join(', ')} only`}
                  {a.expiresAt && ` · until ${fmtDate(a.expiresAt)}`}
                </span>
              </span>
            </div>
          </Fragment>
        ))}
        {visible.length === 0 && (
          <p className="m-0 px-4 py-6 text-center text-[13px] text-faint">
            Nothing posted{seat.isAdmin ? '. Start one from the corner.' : '.'}
          </p>
        )}
      </div>

      {/* The board used to cut off at six with nothing to say it had. */}
      {visible.length > COLLAPSED && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="w-full cursor-pointer border-t border-line bg-transparent px-4 py-[8px] text-left font-meta text-[12px] font-semibold text-sec transition-colors hover:bg-fill2 hover:text-ink"
        >
          {expanded ? 'Show less' : `Show all ${visible.length}`}
        </button>
      )}
    </Card>
  )
}
