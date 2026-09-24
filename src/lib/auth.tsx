import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ApiError, api, authExpired, clearToken, getToken, setToken } from './api'
import { queryClient } from './queryClient'
import type { ModuleKey, Seat } from '../data/types'

/** One entry per nav-rail screen - the checkboxes on a seat map to exactly this list. */
export const MODULES: { key: ModuleKey; label: string; path: string }[] = [
  { key: 'dashboard', label: 'Home', path: '/' },
  { key: 'inventory', label: 'Stock', path: '/inventory' },
  { key: 'sales', label: 'Sales', path: '/sales' },
  { key: 'collection', label: 'Collect', path: '/collection' },
  // Beside Collect, not inside it: whoever banks the money must be able to be
  // somebody other than whoever received it.
  { key: 'treasury', label: 'Treasury', path: '/treasury' },
  { key: 'accounts', label: 'Accounts', path: '/accounts' },
  { key: 'logistics', label: 'Trips', path: '/logistics' },
  { key: 'hr', label: 'HR', path: '/hr' },
  { key: 'settings', label: 'Admin & settings', path: '/settings' },
]

export function canAccess(seat: Seat | null, module: ModuleKey) {
  return !!seat && (seat.isAdmin || seat.modules.includes(module))
}

/**
 * A login that is one person doing one job, rather than the office.
 *
 * Admins are never field seats whatever the record says - a mistake in the seat
 * form should not put the owner of the business on a crew screen with no way
 * back. Mirrors isScoped() in server/scope.ts, which is what actually enforces
 * what such a seat can read and write.
 */
export const isFieldSeat = (seat: Seat | null): boolean =>
  !!seat && seat.scope === 'own' && !seat.isAdmin

/** The work screens a field seat can have, in the order they land on them. */
export const FIELD_PAGES = [
  { path: '/my/trips', label: 'My trips', module: 'logistics' as ModuleKey },
  { path: '/my/sales', label: 'My sales', module: 'sales' as ModuleKey },
  // A collector is out of the office with other people's money on them, which
  // is its own job and its own screen - same as the crew's and the agent's.
  { path: '/my/collections', label: 'My collections', module: 'collection' as ModuleKey },
]

/**
 * The to-do screen every field seat gets alongside its work screen. Not a work
 * screen itself: it never earns a seat the phone shell on its own, so a seat
 * with no work screen built for it yet is not shelled into a phone app with
 * nothing in it but a task list.
 */
export const FIELD_TASKS_PAGE = { path: '/my/tasks', label: 'My tasks' }

/** The field pages this seat actually has. Also what the phone shell routes. */
export const fieldPages = (seat: Seat | null) => {
  if (!isFieldSeat(seat)) return []
  const work = FIELD_PAGES.filter((p) => canAccess(seat, p.module))
  return work.length > 0 ? [...work, FIELD_TASKS_PAGE] : []
}

/**
 * Whether this seat gets the stripped phone shell instead of the full app.
 *
 * Not every scoped seat does, because not every scoped seat has a screen built
 * for it yet - crew have My trips, agents My sales, collectors My collections,
 * and a scoped seat holding some other module has none. Gating the shell on
 * isFieldSeat alone put such a seat inside a shell that does not route the page
 * homePath sends it to - so the catch-all redirected there, which matched
 * nothing, which redirected again, and the router bounced between two paths
 * forever. Derived from FIELD_PAGES so adding a screen is the only step: a seat
 * gets the shell exactly when the shell has something to show it.
 */
export const hasFieldShell = (seat: Seat | null): boolean => fieldPages(seat).length > 0

/** First module this seat is allowed to see - where logins and blocked URLs land.
 * Null when a (misconfigured) seat has no modules at all. */
export function homePath(seat: Seat | null): string | null {
  if (!seat) return null
  // A field seat lands on its own work, not on a dashboard of a business it
  // cannot see: every card on that page reads tables it has no rows of.
  const mine = fieldPages(seat)[0]
  if (mine) return mine.path
  return MODULES.find((m) => canAccess(seat, m.key))?.path ?? null
}

interface AuthValue {
  seat: Seat | null
  /** False until the persisted session has been checked - render nothing before that. */
  ready: boolean
  /** Resolves to an error message, or null on success. */
  login: (username: string, password: string) => Promise<string | null>
  logout: () => void
}

const AuthContext = createContext<AuthValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setTokenState] = useState<string | null>(() => getToken())

  // The api layer clears the token and fires this when the server rejects it
  // (expired session, seat deleted by an admin, database reset…).
  useEffect(() => {
    const onExpired = () => setTokenState(null)
    authExpired.addEventListener('expired', onExpired)
    return () => authExpired.removeEventListener('expired', onExpired)
  }, [])

  // Who does this token belong to? Polled so seat edits (rename, module changes,
  // admin revoked) propagate to signed-in browsers within ~30s.
  const me = useQuery({
    queryKey: ['me'],
    queryFn: () => api<Seat>('/me'),
    enabled: !!token,
    refetchInterval: 30_000,
    retry: false,
  })

  const login = useCallback(async (username: string, password: string) => {
    try {
      const res = await api<{ token: string; seat: Seat }>('/login', {
        method: 'POST',
        body: { username, password },
      })
      setToken(res.token)
      queryClient.setQueryData(['me'], res.seat)
      setTokenState(res.token)
      return null
    } catch (e) {
      return e instanceof ApiError ? e.message : 'Something went wrong signing in.'
    }
  }, [])

  const logout = useCallback(() => {
    api('/logout', { method: 'POST' }).catch(() => {}) // best effort - session may already be gone
    clearToken()
    setTokenState(null)
    queryClient.clear() // next login may be a different seat; don't leak cached tables
  }, [])

  const ready = !token || me.isSuccess || me.isError
  const seat = token ? me.data ?? null : null

  return <AuthContext.Provider value={{ seat, ready, login, logout }}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
