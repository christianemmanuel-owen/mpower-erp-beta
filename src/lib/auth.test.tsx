// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from './queryClient'
import { AuthProvider, useAuth } from './auth'
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
