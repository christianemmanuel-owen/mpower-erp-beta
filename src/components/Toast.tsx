import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

/**
 * Transient confirmations, bottom right.
 *
 * These used to be a card pushed into the top of the page body: seven screens
 * each held their own `notice` state, each hand-rolled the same card, and two
 * of them had drifted to different colours. Because it sat in the flow it moved
 * the page down when it appeared, so submitting a form shifted the table you
 * were looking at, and it stayed until you clicked Dismiss - a permanent object
 * reporting a moment that had passed.
 *
 * A toast is the right shape for that message: it is an event, not a state. It
 * overlays rather than reflows, it says its piece and leaves.
 *
 * What deliberately did NOT move here: PendingBanner. "3 inputs are waiting for
 * an administrator" is standing state, and state that fades is state nobody
 * can find again.
 */

const LIFETIME_MS = 6000
/** Beyond this the stack is a wall rather than a message. Oldest goes first. */
const MAX_VISIBLE = 3

interface Toast { id: number; message: string }

const ToastContext = createContext<((message: string) => void) | null>(null)

/**
 * Fire a toast. The signature is `(message: string) => void` on purpose - it is
 * exactly the `onNotice` prop the dialogs already take, so they pass this
 * straight down without knowing a toast is what they are calling.
 */
export function useToast(): (message: string) => void {
  const push = useContext(ToastContext)
  if (!push) throw new Error('useToast must be used inside a ToastProvider')
  return push
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(1)

  const dismiss = useCallback((id: number) => {
    setToasts((list) => list.filter((t) => t.id !== id))
  }, [])

  const push = useCallback((message: string) => {
    if (!message) return
    setToasts((list) => {
      // Saving three rows in a row should not stack three identical toasts. The
      // newest wins and restarts its own clock, which is what a fresh id does.
      const withoutDupe = list.filter((t) => t.message !== message)
      const next = [...withoutDupe, { id: nextId.current++, message }]
      return next.slice(-MAX_VISIBLE)
    })
  }, [])

  return (
    <ToastContext.Provider value={push}>
      {children}
      {createPortal(
        <div
          // Above the dialog layer (1200): a save made from inside a dialog
          // should still be able to tell you what happened.
          className="pointer-events-none fixed bottom-4 right-4 z-[1300] flex w-[320px] max-w-[calc(100vw-32px)] flex-col gap-2"
          role="status"
          aria-live="polite"
        >
          {toasts.map((t) => <ToastRow key={t.id} toast={t} onDismiss={dismiss} />)}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  )
}

function ToastRow({ toast, onDismiss }: { toast: Toast; onDismiss: (id: number) => void }) {
  const [paused, setPaused] = useState(false)

  useEffect(() => {
    // Reading it is the one reason to keep it: hovering, or tabbing to the
    // close button, holds the message until you are done with it.
    if (paused) return
    const timer = setTimeout(() => onDismiss(toast.id), LIFETIME_MS)
    return () => clearTimeout(timer)
  }, [paused, toast.id, onDismiss])

  return (
    <div
      className="toast-in pointer-events-auto flex items-start gap-3 rounded-[8px] border border-line bg-white px-3 py-[10px] shadow-[0_8px_28px_rgba(20,24,27,.16)]"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <p className="m-0 flex-1 text-[13px] leading-[1.4] text-lab">{toast.message}</p>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        aria-label="Dismiss"
        className="mt-[1px] flex h-[18px] w-[18px] shrink-0 cursor-pointer items-center justify-center rounded-[4px] border-0 bg-transparent text-faint transition-colors hover:bg-fill2 hover:text-ink"
      >
        <X size={13} strokeWidth={2} />
      </button>
    </div>
  )
}
