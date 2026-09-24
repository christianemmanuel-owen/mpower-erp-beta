// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from './queryClient'
import { AuthProvider, fieldPages, hasFieldShell, homePath, useAuth } from './auth'
import type { Seat } from '../data/types'

const adminSeat: Seat = {
  id: 'seat-admin', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  name: 'Admin', username: 'admin', role: 'Owner', isAdmin: true, modules: [],
}

/** In-memory stand-in for the Pages Functions API. */
let validTokens: Set<string>
let seatDeleted: boolean

function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = String(input)
  const method = (init?.method ?? 'GET').toUpperCase()
  const headers = new Headers(init?.headers)
  const token = (headers.get('authorization') ?? '').replace('Bearer ', '')
  const reply = (status: number, body: unknown) =>
    Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }))

  if (url.endsWith('/api/login') && method === 'POST') {
    const body = JSON.parse(String(init?.body)) as { username: string; password: string }
    if (body.username === 'admin' && body.password === 'admin' && !seatDeleted) {
      const t = `tok-${validTokens.size + 1}`
      validTokens.add(t)
      return reply(200, { token: t, seat: adminSeat })
    }
    return reply(401, { error: 'Wrong username or password.' })
  }
  if (url.endsWith('/api/me') && method === 'GET') {
    if (validTokens.has(token) && !seatDeleted) return reply(200, adminSeat)
    return reply(401, { error: 'Not signed in.' })
  }
  if (url.endsWith('/api/logout') && method === 'POST') {
    validTokens.delete(token)
    return reply(200, { ok: true })
  }
  return reply(404, { error: 'Unknown resource.' })
}

let doLogin: (u: string, p: string) => Promise<string | null>
let doLogout: () => void

function Probe() {
  const { seat, ready, login, logout } = useAuth()
  doLogin = login
  doLogout = logout
  return <div data-testid="state">{!ready ? 'loading' : seat ? `in:${seat.username}` : 'out'}</div>
}

const state = () => screen.getByTestId('state').textContent
const mount = () => render(
  <QueryClientProvider client={queryClient}>
    <AuthProvider><Probe /></AuthProvider>
  </QueryClientProvider>,
)

describe('auth session (server-backed)', () => {
  beforeEach(() => {
    localStorage.clear()
    queryClient.clear()
    validTokens = new Set()
    seatDeleted = false
    vi.stubGlobal('fetch', vi.fn(fakeFetch))
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('logs in and stays logged in', async () => {
    mount()
    await waitFor(() => expect(state()).toBe('out'))
    let err: string | null = 'unset'
    await act(async () => { err = await doLogin('admin', 'admin') })
    expect(err).toBeNull()
    await waitFor(() => expect(state()).toBe('in:admin'))
    await act(() => new Promise((r) => setTimeout(r, 50)))
    expect(state()).toBe('in:admin')
    expect(localStorage.getItem('erp-token')).toBeTruthy()
  })

  it('rejects a wrong password', async () => {
    mount()
    await waitFor(() => expect(state()).toBe('out'))
    let err: string | null = null
    await act(async () => { err = await doLogin('admin', 'nope') })
    expect(err).toMatch(/wrong/i)
    expect(state()).toBe('out')
    expect(localStorage.getItem('erp-token')).toBeNull()
  })

  it('restores a persisted session on mount', async () => {
    validTokens.add('tok-existing')
    localStorage.setItem('erp-token', 'tok-existing')
    mount()
    await waitFor(() => expect(state()).toBe('in:admin'))
  })

  it('logs out and clears the session', async () => {
    mount()
    await waitFor(() => expect(state()).toBe('out'))
    await act(async () => { await doLogin('admin', 'admin') })
    await waitFor(() => expect(state()).toBe('in:admin'))
    act(() => doLogout())
    await waitFor(() => expect(state()).toBe('out'))
    expect(localStorage.getItem('erp-token')).toBeNull()
  })

  it('signs out when the server rejects the token (seat deleted / session revoked)', async () => {
    mount()
    await waitFor(() => expect(state()).toBe('out'))
    await act(async () => { await doLogin('admin', 'admin') })
    await waitFor(() => expect(state()).toBe('in:admin'))
    seatDeleted = true
    await act(async () => { await queryClient.refetchQueries({ queryKey: ['me'] }) })
    await waitFor(() => expect(state()).toBe('out'))
    expect(localStorage.getItem('erp-token')).toBeNull()
  })
})

/**
 * Which seats get the stripped phone shell, and where each lands.
 *
 * The shell only routes the screens that exist, so a seat gets it exactly when
 * one of its modules has a screen built. A scoped seat whose module has none -
 * accounts, say - stays on the desktop page: putting it in the shell meant the
 * catch-all redirected to a path the shell does not route, which redirected
 * again, and the router bounced forever.
 */
describe('field seats and where they land', () => {
  const seat = (over: Partial<Seat>): Seat => ({ ...adminSeat, isAdmin: false, modules: [], ...over })

  it('gives crew the phone shell, landing on their trips', () => {
    const crew = seat({ scope: 'own', modules: ['logistics'] })
    expect(hasFieldShell(crew)).toBe(true)
    expect(homePath(crew)).toBe('/my/trips')
  })

  it('gives an agent the phone shell, landing on their sales', () => {
    const agent = seat({ scope: 'own', modules: ['sales'] })
    expect(hasFieldShell(agent)).toBe(true)
    expect(homePath(agent)).toBe('/my/sales')
  })

  /**
   * A scoped seat whose module has no field screen gets the full app with the
   * server filtering the rows - not a shell whose only routes are pages it
   * cannot reach. That combination used to bounce the router between two paths
   * forever.
   */
  it('keeps a scoped seat with no screen of its own out of the shell', () => {
    // Accounts has no field screen, so this seat is served by the ordinary
    // desktop page with the server filtering its rows.
    const scoped = seat({ scope: 'own', modules: ['accounts'] })
    expect(hasFieldShell(scoped)).toBe(false)
    expect(homePath(scoped)).toBe('/accounts')
  })

  /**
   * A collector is out with other people's money on them, which is field work
   * by any measure - so they get the phone shell, not the office page.
   */
  it('shells a collector onto their own round', () => {
    const collector = seat({ scope: 'own', modules: ['collection'] })
    expect(hasFieldShell(collector)).toBe(true)
    expect(fieldPages(collector).map((p) => p.path)).toEqual(['/my/collections', '/my/tasks'])
    expect(homePath(collector)).toBe('/my/collections')
  })

  /** A seat crewed and selling gets both, and lands on the first. */
  it('gives a seat with two field screens both of them', () => {
    const both = seat({ scope: 'own', modules: ['logistics', 'sales'] })
    expect(fieldPages(both).map((p) => p.path)).toEqual(['/my/trips', '/my/sales', '/my/tasks'])
    expect(homePath(both)).toBe('/my/trips')
  })

  it('never shells an admin, whatever the scope says', () => {
    expect(hasFieldShell(seat({ scope: 'own', modules: ['logistics'], isAdmin: true }))).toBe(false)
  })

  it('leaves office seats alone', () => {
    const office = seat({ scope: 'all', modules: ['dashboard', 'logistics'] })
    expect(hasFieldShell(office)).toBe(false)
    expect(homePath(office)).toBe('/')
  })
})
