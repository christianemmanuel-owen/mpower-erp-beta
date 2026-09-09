// Thin fetch wrapper for the Pages Functions API. All reads/writes go through here.

const TOKEN_KEY = 'erp-token'

export const getToken = () => localStorage.getItem(TOKEN_KEY)
export const setToken = (t: string) => localStorage.setItem(TOKEN_KEY, t)
export const clearToken = () => localStorage.removeItem(TOKEN_KEY)

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/** Fires when the server rejects our token (expired/revoked) so auth can reset. */
export const authExpired = new EventTarget()

export async function api<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const token = getToken()
  let res: Response
  try {
    res = await fetch(`/api${path}`, {
      method: init?.method ?? 'GET',
      headers: {
        ...(init?.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    })
  } catch {
    throw new ApiError(0, 'Can’t reach the server - check your connection.')
  }
  if (res.status === 401 && token && path !== '/login') {
    clearToken()
    authExpired.dispatchEvent(new Event('expired'))
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null
    throw new ApiError(res.status, body?.error ?? `Request failed (${res.status}).`)
  }
  return res.json() as Promise<T>
}

/** Multipart upload - the one request shape `api()` can't carry, because the
 * browser must set its own multipart boundary on Content-Type. Used by the
 * attachment layer (uploaded digital copies, Exhibit A 1.2–1.5). */
export async function apiUpload<T>(path: string, form: FormData): Promise<T> {
  const token = getToken()
  let res: Response
  try {
    res = await fetch(`/api${path}`, {
      method: 'POST',
      headers: token ? { authorization: `Bearer ${token}` } : {},
      body: form,
    })
  } catch {
    throw new ApiError(0, 'Can’t reach the server - check your connection.')
  }
  if (res.status === 401 && token) {
    clearToken()
    authExpired.dispatchEvent(new Event('expired'))
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null
    throw new ApiError(res.status, body?.error ?? `Upload failed (${res.status}).`)
  }
  return res.json() as Promise<T>
}
