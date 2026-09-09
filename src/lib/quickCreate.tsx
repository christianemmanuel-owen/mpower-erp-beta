import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { Plus } from 'lucide-react'

/** Lets a page's primary button open that module's create form. */
interface QuickCreateCtx {
  pending: string | null
  request: (key: string) => void
  consume: (key: string) => boolean
}

const Ctx = createContext<QuickCreateCtx | null>(null)

export function QuickCreateProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<string | null>(null)
  const value = useMemo<QuickCreateCtx>(
    () => ({
      pending,
      request: (key) => setPending(key),
      consume: (key) => {
        if (pending !== key) return false
        setPending(null)
        return true
      },
    }),
    [pending],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useQuickCreate() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useQuickCreate outside provider')
  return ctx
}

/**
 * What each page's primary action creates.
 *
 * Keyed by route because the action belongs to the page, not to the module: on
 * Stock only the Purchases subpage has one, and Levels and Movements are places
 * you read rather than add to.
 */
const CREATE_ACTIONS: Record<string, { label: string; key: string }> = {
  '/inventory/purchases': { label: 'New purchase', key: 'purchase' },
  '/sales': { label: 'New sale', key: 'sale' },
  '/accounts': { label: 'New account', key: 'account' },
  '/accounts/suppliers': { label: 'Record quote', key: 'quote' },
}

/**
 * The page's primary action, rendered in its own header.
 *
 * It used to sit in the top bar, between the date and the notification bell -
 * global chrome, holding a control that changes with the route and belongs to
 * one page. It read as part of the application frame rather than as something
 * this screen does, and it sat furthest from the table it adds a row to.
 *
 * Renders nothing on a page that has no create action, which is most of them.
 */
export function CreateAction() {
  const { pathname } = useLocation()
  const { request } = useQuickCreate()
  const action = CREATE_ACTIONS[pathname]
  if (!action) return null
  return (
    <button
      type="button"
      onClick={() => request(action.key)}
      className="inline-flex h-[28px] cursor-pointer items-center justify-center gap-[5px] rounded-[6px] bg-ink px-[10px] font-meta text-[12px] font-semibold text-white transition-colors hover:bg-inkhov"
    >
      <Plus size={13} strokeWidth={2} />
      {action.label}
    </button>
  )
}
