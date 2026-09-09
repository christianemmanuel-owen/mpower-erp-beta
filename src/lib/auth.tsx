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
  { key: 'accounts', label: 'Accounts', path: '/accounts' },
  { key: 'logistics', label: 'Trips', path: '/logistics' },
  { key: 'hr', label: 'HR', path: '/hr' },
  { key: 'settings', label: 'Admin & settings', path: '/settings' },
]

export function canAccess(seat: Seat | null, module: ModuleKey) {
  return !!seat && (seat.isAdmin || seat.modules.includes(module))
}

/** First module this seat is allowed to see - where logins and blocked URLs land.
 * Null when a (misconfigured) seat has no modules at all. */
export function homePath(seat: Seat | null): string | null {
  if (!seat) return null
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
