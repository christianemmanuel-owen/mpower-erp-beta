import { afterEach, describe, expect, it, vi } from 'vitest'
import { handleReverseGeocode } from './routing'

/**
 * A pin's coordinates back to an address. The provider is stubbed; what is
 * pinned here is the contract the map picker relies on - bad input is a 400,
 * an unnamed spot is a 422, a named one comes back with the point it was
 * asked about.
 */
const call = (qs: string, key?: string) =>
  handleReverseGeocode(new URL(`http://x/api/geocode/reverse?${qs}`), { GOOGLE_MAPS_API_KEY: key } as never)

afterEach(() => vi.unstubAllGlobals())

describe('handleReverseGeocode', () => {
  it('refuses a request without both coordinates', async () => {
    expect((await call('lat=14.6')).status).toBe(400)
    expect((await call('lat=abc&lng=121')).status).toBe(400)
  })

  it('names the spot through OpenStreetMap when there is no Google key', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toContain('nominatim.openstreetmap.org/reverse')
      expect(url).toContain('lat=14.6')
      return new Response(JSON.stringify({ display_name: 'Ortigas Ave, Pasig, Metro Manila' }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const res = await call('lat=14.6&lng=121.07')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ lat: 14.6, lng: 121.07, label: 'Ortigas Ave, Pasig, Metro Manila' })
  })

  it('uses Google when a key is set, and says so when nothing is there', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toContain('maps.googleapis.com')
      expect(url).toContain('latlng=14.6%2C121.07')
      return new Response(JSON.stringify({ results: [] }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    expect((await call('lat=14.6&lng=121.07', 'k')).status).toBe(422)
  })
})
