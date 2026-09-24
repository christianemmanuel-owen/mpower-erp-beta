import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, Bell, CheckCheck, ClipboardCheck, Megaphone, Package, Lock } from 'lucide-react'
import { timeAgo, useMarkRead, useNotifications, type AppNotification, type NotificationKind } from '../lib/notifications'

/** Notification inbox in the top bar - Secondary Feature 2.11.
 * 2.3 (low supply), 2.4 (announcements) and 2.9 (smart lock) all surface here,
 * which is why the icon is chosen per kind rather than per feature. */
const icons: Record<NotificationKind, typeof Bell> = {
  low_stock: Package,
  announcement: Megaphone,
  approval_request: ClipboardCheck,
  approval_result: CheckCheck,
  input_logged: ClipboardCheck,
  collection_due: AlertTriangle,
  smart_lock: Lock,
  system: Bell,
}

export default function NotificationBell() {
  const navigate = useNavigate()
  const { data } = useNotifications()
  const markRead = useMarkRead()
  const [open, setOpen] = useState(false)
  // Rings once when the unread count rises - not on first paint, not on a
  // poll that changed nothing. Keyed on the count so the class re-applies
  // for the next rise after the animation has finished.
  const [rang, setRang] = useState(false)
  const lastUnread = useRef<number | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  const unread = data?.unread ?? 0
  useEffect(() => {
    const rose = lastUnread.current !== null && unread > lastUnread.current
    lastUnread.current = unread
    if (!rose) return
    setRang(true)
    const t = setTimeout(() => setRang(false), 700)
    return () => clearTimeout(t)
  }, [unread])
  const rows = data?.rows ?? []

  function openItem(n: AppNotification) {
    if (!n.readAt) markRead.mutate({ ids: [n.id] })
    setOpen(false)
    if (n.link) navigate(n.link)
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Notifications"
        className="relative flex h-8 w-8 cursor-pointer items-center justify-center rounded-[9px] transition-[background-color,transform] duration-150 hover:bg-fill2 active:scale-[.92] motion-reduce:transition-none"
      >
        <Bell size={17} strokeWidth={2} color="#55637a" className={rang ? 'bell-ring' : undefined} />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-[15px] min-w-[15px] items-center justify-center rounded-full bg-redf px-[3px] text-[9px] font-semibold text-white">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="drop-in absolute right-0 top-10 z-50 w-[340px] overflow-hidden rounded-[12px] border border-inputline bg-white shadow-lg">
          <div className="flex items-center justify-between border-b border-fill2 px-3 py-2">
            <span className="text-[13px] font-semibold text-lab">Notifications</span>
            {unread > 0 && (
              <button
                type="button"
                onClick={() => markRead.mutate({ all: true })}
                className="cursor-pointer text-[11px] font-semibold uppercase text-tealbtn hover:underline"
              >
                Mark all read
              </button>
            )}
          </div>

          {rows.length === 0 ? (
            <p className="px-3 py-6 text-center text-[13px] text-faint">Nothing here yet.</p>
          ) : (
            <ul className="max-h-[380px] overflow-y-auto">
              {rows.map((n) => {
                const Icon = icons[n.kind] ?? Bell
                return (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => openItem(n)}
                      className={`flex w-full cursor-pointer items-start gap-2 border-b border-fill2 px-3 py-[10px] text-left hover:bg-fill2 ${n.readAt ? '' : 'bg-tealbadge/40'}`}
                    >
                      <Icon size={15} className="mt-[2px] shrink-0 text-mut" />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13px] font-semibold text-lab">{n.title}</span>
                        {n.body && <span className="block text-[12px] text-mut">{n.body}</span>}
                        <span className="mt-[2px] block text-[11px] text-faint">{timeAgo(n.createdAt)}</span>
                      </span>
                      {!n.readAt && <span className="mt-[6px] h-[7px] w-[7px] shrink-0 rounded-full bg-teal" />}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
