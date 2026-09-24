import { describe, expect, it } from 'vitest'
import { fulfilOnDelivery } from './fulfilment'
import type { Seat } from './core'

/**
 * The gap this covers: a driver confirming a delivery on the phone left the
 * sale at "confirmed" for ever, because only the office Trips page knew to
 * close it - and did so from the browser, as a second write. The consequence
 * now lives with the delivery write itself, so it has to hold for both.
 */

/** A records table with one sale in it, recording every write. */
function fakeDb(sale: Record<string, unknown> | null) {
  const writes: { tbl: string; rec: Record<string, unknown> }[] = []
  const db = {
    prepare(text: string) {
      const stmt = {
        bind(...binds: unknown[]) {
          if (text.startsWith('INSERT INTO records')) writes.push({ tbl: String(binds[0]), rec: JSON.parse(String(binds[2])) })
          return stmt
        },
        first: async () => (text.startsWith('SELECT data FROM records') && sale ? { data: JSON.stringify(sale) } : null),
        all: async () => ({ results: [] }),
        run: async () => ({ success: true }),
      }
      return stmt
    },
  }
  return { db: db as unknown as D1Database, writes }
}

const driver: Seat = { id: 'seat-driver', name: 'Nilo', username: 'driver', passwordHash: '', salt: '', isAdmin: false, modules: ['logistics'] }
const trip = (status: string) => ({ id: 'd1', saleId: 's1', status })

describe('fulfilOnDelivery', () => {
  it('closes a confirmed sale when its trip lands as delivered', async () => {
    const { db, writes } = fakeDb({ id: 's1', status: 'confirmed' })
    expect(await fulfilOnDelivery(db, driver, trip('in_transit'), trip('delivered'))).toBe(true)
    const sale = writes.find((w) => w.tbl === 'sales')
    expect(sale?.rec.status).toBe('fulfilled')
  })

  it('does nothing when the trip was already delivered - a receipt edit is not a second delivery', async () => {
    const { db, writes } = fakeDb({ id: 's1', status: 'confirmed' })
    expect(await fulfilOnDelivery(db, driver, trip('delivered'), { ...trip('delivered'), documents: {} })).toBe(false)
    expect(writes.filter((w) => w.tbl === 'sales')).toHaveLength(0)
  })

  it('does not overrule a cancelled or returned sale', async () => {
    for (const status of ['cancelled', 'returned', 'draft']) {
      const { db, writes } = fakeDb({ id: 's1', status })
      expect(await fulfilOnDelivery(db, driver, trip('in_transit'), trip('delivered'))).toBe(false)
      expect(writes.filter((w) => w.tbl === 'sales')).toHaveLength(0)
    }
  })

  it('ignores every other move, and a trip with no sale', async () => {
    const { db, writes } = fakeDb({ id: 's1', status: 'confirmed' })
    expect(await fulfilOnDelivery(db, driver, trip('loading'), trip('in_transit'))).toBe(false)
    expect(await fulfilOnDelivery(db, driver, trip('in_transit'), trip('failed'))).toBe(false)
    expect(await fulfilOnDelivery(db, driver, { id: 'd2', status: 'in_transit' }, { id: 'd2', status: 'delivered' })).toBe(false)
    expect(writes).toHaveLength(0)
  })
})
