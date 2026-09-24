import { describe, expect, it } from 'vitest'
import { TABLE_WRITE_MODULES, canWriteRecord, foreignFieldProblem, installmentWriteProblem } from './access'

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

describe('segregation of duties on a collection', () => {
  const inst = (over: Record<string, unknown> = {}) => ({
    id: 'i1', amount: 100, principal: 100, interestPct: 0,
    dueDate: '2026-02-02T00:00:00.000Z', status: 'collected', collectedAt: '2026-02-01T00:00:00.000Z',
    ...over,
  })
  const collector = seat(['collection'])
  const cashier = seat(['treasury'])

  it('lets Treasury bank what a collector brought in', () => {
    const before = [inst()]
    // Exactly what DepositDialog writes, account included - the account it
    // was banked into is the treasurer's to say, and the first walkthrough
    // of the deposit dialog was refused on that one field.
    const after = [inst({
      status: 'deposited', depositedAt: '2026-02-03T00:00:00.000Z', depositedBy: 'seat-t',
      depositSlipNo: 'DS-1', bankAccountId: 'acct-bpi',
    })]
    expect(installmentWriteProblem(cashier, before, after)).toBeNull()
  })

  it('lets a collector name the account a transfer landed in', () => {
    const before = [inst({ status: 'pending', collectedAt: undefined })]
    const after = [inst({ status: 'cleared', bankAccountId: 'acct-bpi' })]
    expect(installmentWriteProblem(collector, before, after)).toBeNull()
  })

  /**
   * The control this whole file exists for. The collector can write `sales` -
   * a collection lives inside the sale record - so the table-level check waves
   * this through, and only a field-level rule catches it.
   */
  it('stops a collector banking their own collection', () => {
    const before = [inst()]
    const after = [inst({ status: 'deposited', depositedAt: '2026-02-03T00:00:00.000Z' })]
    expect(installmentWriteProblem(collector, before, after)).toMatch(/Treasury/)
  })

  it('stops Treasury rewriting how a payment was collected', () => {
    const before = [inst()]
    const after = [inst({ collectedAt: '2026-01-02T00:00:00.000Z' })]
    expect(installmentWriteProblem(cashier, before, after)).toMatch(/Collections/)
  })

  it('lets a collector record a collection', () => {
    const before = [inst({ status: 'pending', collectedAt: undefined })]
    const after = [inst()]
    expect(installmentWriteProblem(collector, before, after)).toBeNull()
  })

  /** Either desk can hear that a check failed - but from where they stand:
   *  the customer tells the collector about one still in hand, the bank tells
   *  the cashier about one it was given. */
  it('lets each desk record a bounce from its own side', () => {
    expect(installmentWriteProblem(collector, [inst()], [inst({ status: 'bounced', notes: 'Handed back' })])).toBeNull()
    const banked = inst({ status: 'deposited', depositedAt: 'x' })
    expect(installmentWriteProblem(cashier, [banked], [{ ...banked, status: 'bounced' }])).toBeNull()
    // And not from the other's.
    expect(installmentWriteProblem(cashier, [inst()], [inst({ status: 'bounced' })])).toMatch(/Collections/)
  })

  /**
   * A bank transfer is money the moment it lands, so the collector recording
   * it goes straight to cleared - there is nothing for Treasury to bank.
   * A check may not take that road: cleared is reached only from deposited,
   * and only by Treasury.
   */
  it('lets a collector clear a one-step receipt, and nothing else', () => {
    const due = inst({ status: 'pending', collectedAt: undefined })
    expect(installmentWriteProblem(collector, [due], [inst({ status: 'cleared', clearedAt: 'x' })])).toMatch(/Treasury/)
    // The clearing timestamp is Treasury's field; the one-step receipt
    // carries only the collection date, which is when the money arrived.
    expect(installmentWriteProblem(collector, [due], [inst({ status: 'cleared' })])).toBeNull()
    expect(installmentWriteProblem(collector, [inst()], [inst({ status: 'cleared' })])).toMatch(/Treasury/)
  })

  it('refuses a move the chain does not have', () => {
    expect(installmentWriteProblem(cashier, [inst({ status: 'pending' })], [inst({ status: 'deposited' })]))
      .toMatch(/cannot go from pending to deposited/)
  })

  it('leaves writes that touch no installment alone', () => {
    // Logistics marking a trip delivered writes the sale and nothing in here.
    expect(installmentWriteProblem(seat(['logistics']), [inst()], [inst()])).toBeNull()
    expect(installmentWriteProblem(seat(['logistics']), [inst()], undefined)).toBeNull()
  })

  it('lets an admin do both', () => {
    const before = [inst()]
    const after = [inst({ status: 'cleared', depositedAt: 'x', clearedAt: 'y' })]
    expect(installmentWriteProblem({ isAdmin: true, modules: [] }, before, after)).toBeNull()
  })
})

describe('what Treasury may reach', () => {
  /**
   * The table gate runs before the field gate. A Treasury seat that cannot
   * reach `sales` at all is refused on the way in, and the careful per-field
   * rule never gets a say - which is exactly what happened: the queue showed
   * the checks, and "Record deposit" said the seat had no access.
   */
  it('lets a treasurer reach the tables it banks and pays from', () => {
    expect(canWriteRecord(seat(['treasury']), 'sales')).toBe(true)
    expect(canWriteRecord(seat(['treasury']), 'purchases')).toBe(true)
  })

  it('but not anything else', () => {
    expect(canWriteRecord(seat(['treasury']), 'customers')).toBe(false)
    expect(canWriteRecord(seat(['treasury']), 'deliveries')).toBe(false)
  })
})

describe('foreignFieldProblem', () => {
  const sale = { id: 's1', pricePerLiter: 55, volumeLiters: 10_000, installments: [{ id: 'i1', status: 'pending' }] }

  it('lets a treasurer or collector change the payments and nothing else', () => {
    const paid = { ...sale, installments: [{ id: 'i1', status: 'deposited' }] }
    expect(foreignFieldProblem(seat(['treasury']), 'sales', sale, paid)).toBeNull()
    expect(foreignFieldProblem(seat(['collection']), 'sales', sale, paid)).toBeNull()
    // The same fields sent back unchanged are not a change.
    expect(foreignFieldProblem(seat(['treasury']), 'sales', sale, { ...paid, pricePerLiter: 55 })).toBeNull()
    const problem = foreignFieldProblem(seat(['treasury']), 'sales', sale, { ...paid, pricePerLiter: 40 })
    expect(problem).toMatch(/Only Sales/)
    expect(problem).toMatch(/pricePerLiter/)
  })

  it('applies to purchases for anyone outside Stock, and not to the owner or an admin', () => {
    const po = { id: 'p1', pricePerLiter: 50, installments: [] as unknown[] }
    expect(foreignFieldProblem(seat(['treasury']), 'purchases', po, { ...po, pricePerLiter: 45 })).toMatch(/Only Stock/)
    expect(foreignFieldProblem(seat(['inventory']), 'purchases', po, { ...po, pricePerLiter: 45 })).toBeNull()
    expect(foreignFieldProblem(seat(['treasury'], true), 'purchases', po, { ...po, pricePerLiter: 45 })).toBeNull()
    expect(foreignFieldProblem(seat(['treasury']), 'customers', { id: 'c' }, { id: 'c', company: 'X' })).toBeNull()
  })

  it('keeps a trip to dispatch and the crew, whoever else may open it', () => {
    const trip = { id: 'd1', truckId: 't1', status: 'scheduled' }
    expect(foreignFieldProblem(seat(['sales']), 'deliveries', trip, { ...trip, truckId: 't2' })).toMatch(/Only Trips/)
    expect(foreignFieldProblem(seat(['logistics']), 'deliveries', trip, { ...trip, truckId: 't2' })).toBeNull()
  })
})
