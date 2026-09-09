import { describe, expect, it } from 'vitest'
import { TABLE_WRITE_MODULES, canWriteRecord } from './access'

/**
 * The gap these cover: the route defined a module check and then only wired it
 * into the attachment handler, so a seat with no modules could rewrite every
 * sale in the system through the API while the UI showed it "No modules
 * assigned". Worth pinning both halves - that the wrong seat is refused, and
 * that the cross-module workflows the app actually relies on still pass.
 */

const seat = (modules: string[], isAdmin = false) => ({ modules, isAdmin })

describe('canWriteRecord', () => {
  it('refuses a seat that holds no modules at all', () => {
    expect(canWriteRecord(seat([]), 'sales')).toBe(false)
    expect(canWriteRecord(seat([]), 'customers')).toBe(false)
    expect(canWriteRecord(seat([]), 'purchases')).toBe(false)
  })

  it('refuses a seat that holds the wrong module', () => {
    expect(canWriteRecord(seat(['hr']), 'sales')).toBe(false)
    expect(canWriteRecord(seat(['logistics']), 'customers')).toBe(false)
    expect(canWriteRecord(seat(['sales']), 'purchases')).toBe(false)
  })

  it('allows the owning module', () => {
    expect(canWriteRecord(seat(['sales']), 'sales')).toBe(true)
    expect(canWriteRecord(seat(['inventory']), 'purchases')).toBe(true)
    expect(canWriteRecord(seat(['accounts']), 'customers')).toBe(true)
  })

  it('keeps the cross-module workflows the app depends on', () => {
    // Collection settles installments, which are stored on the sale.
    expect(canWriteRecord(seat(['collection']), 'sales')).toBe(true)
    // Logistics marks a trip delivered, which writes back to the sale.
    expect(canWriteRecord(seat(['logistics']), 'sales')).toBe(true)
    // Confirming a sale books its delivery trip.
    expect(canWriteRecord(seat(['sales']), 'deliveries')).toBe(true)
  })

  it('lets an admin through, as everywhere else in the API', () => {
    expect(canWriteRecord(seat([], true), 'sales')).toBe(true)
  })

  it('refuses when there is no seat at all', () => {
    expect(canWriteRecord(null, 'sales')).toBe(false)
    expect(canWriteRecord(undefined, 'sales')).toBe(false)
  })

  it('leaves unmapped tables alone, so master data behaves as before', () => {
    // warehouses, agents, products, bankAccounts have no entry. Gating them is
    // a separate decision about who owns master data; this change must not
    // silently make that call.
    for (const t of ['warehouses', 'agents', 'products', 'bankAccounts', 'todos']) {
      expect(TABLE_WRITE_MODULES[t]).toBeUndefined()
      expect(canWriteRecord(seat([]), t)).toBe(true)
    }
  })

  it('handles a seat whose modules field is missing entirely', () => {
    expect(canWriteRecord({}, 'sales')).toBe(false)
    expect(canWriteRecord({}, 'warehouses')).toBe(true)
  })
})
