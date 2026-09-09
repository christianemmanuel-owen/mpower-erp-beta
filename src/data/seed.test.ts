import { describe, expect, it } from 'vitest'
import { makeDemoData } from './seed'
import { stockByWarehouse } from '../lib/metrics'

describe('makeDemoData', () => {
  it('generates a full, sane dataset', () => {
    const data = makeDemoData()
    expect(data.warehouses).toHaveLength(3)
    expect(data.agents).toHaveLength(5)
    expect(data.customers).toHaveLength(15)
    expect(data.purchases.length).toBeGreaterThan(20)
    expect(data.sales.length).toBeGreaterThan(100)
    expect(data.deliveries.length).toBeGreaterThan(50)

    const inTransit = data.deliveries.filter((d) => d.status === 'in_transit').length
    expect(inTransit).toBeGreaterThanOrEqual(2)

    const stock = stockByWarehouse(data.purchases, data.sales)
    const total = [...stock.values()].reduce((a, b) => a + b, 0)
    expect(Number.isFinite(total)).toBe(true)
    expect(total).toBeGreaterThan(0)
    // No depot should be oversold (negative) or over its physical capacity.
    for (const w of data.warehouses) {
      const v = stock.get(w.id) ?? 0
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(w.capacityLiters)
    }
  })

  it('generates a sane HR dataset', () => {
    const data = makeDemoData()
    expect(data.shifts).toHaveLength(2)
    expect(data.holidays.length).toBeGreaterThanOrEqual(19) // Proclamation 1006
    expect(data.leaves.length).toBeGreaterThanOrEqual(3)
    expect(data.attendance.length).toBeGreaterThan(400)

    // Every employee is payroll-ready: rate, schedule, statutory toggles, SIL.
    for (const p of data.personnel) {
      expect(p.baseRate).toBeGreaterThan(0)
      expect(p.paySchedule).toBe('semi_monthly')
      expect(p.statutory?.sss).toBe(true)
      expect(p.leaveEntitlements?.some((e) => e.typeId === 'sil')).toBe(true)
    }
    // Commission link: sales employees point at real agents.
    const sellers = data.personnel.filter((p) => p.role === 'sales')
    expect(sellers).toHaveLength(2)
    for (const s of sellers) expect(data.agents.some((a) => a.id === s.agentId)).toBe(true)

    // One finalized + one draft semi-monthly run, payslips computed and coherent.
    expect(data.payrollRuns.map((r) => r.status).sort()).toEqual(['draft', 'finalized'])
    for (const run of data.payrollRuns) {
      expect(run.payslips).toHaveLength(data.personnel.length)
      for (const slip of run.payslips) {
        expect(slip.netPay).toBeGreaterThanOrEqual(0)
        expect(slip.grossPay - slip.totalDeductions).toBeCloseTo(slip.netPay, 1)
        expect(slip.grossPay).toBeGreaterThan(0)
      }
    }
    // The night guard actually earns night differential.
    const guardSlip = data.payrollRuns[0].payslips.find((s) => s.employeeName === 'SG Carding Velasco')
    expect(guardSlip && guardSlip.earnings.nightDiffPay).toBeGreaterThan(0)
    // Commission flows from fulfilled sales into at least one seller's payslip.
    const sellerSlips = data.payrollRuns.flatMap((r) => r.payslips).filter((s) => s.role === 'sales')
    expect(sellerSlips.some((s) => s.earnings.commission > 0)).toBe(true)
  })

  it('generates a sane collection dataset', () => {
    const data = makeDemoData()
    const collectorIds = new Set(data.personnel.filter((p) => p.role === 'sales' || p.role === 'office').map((p) => p.id))

    // Most sales carry a default collector, all of them real people; some stay unassigned.
    const withCollector = data.sales.filter((s) => s.collectorId)
    expect(withCollector.length).toBeGreaterThan(data.sales.length / 2)
    expect(withCollector.length).toBeLessThan(data.sales.length)
    for (const s of withCollector) expect(collectorIds.has(s.collectorId!)).toBe(true)

    // At least one staggered plan has an installment-level collector override.
    const overridden = data.sales.flatMap((s) => s.installments).filter((i) => i.collectorId)
    expect(overridden.length).toBeGreaterThan(0)
    for (const i of overridden) expect(collectorIds.has(i.collectorId!)).toBe(true)

    // Collected installments know when they were collected; open/cancelled ones don't.
    for (const i of data.sales.flatMap((s) => s.installments)) {
      if (i.status === 'collected') expect(i.collectedAt).toBeTruthy()
      else expect(i.collectedAt).toBeUndefined()
    }

    // A couple of accounts collect somewhere other than the delivery address.
    expect(data.customers.filter((c) => c.collectionAddress).length).toBeGreaterThanOrEqual(2)
  })

  it('is deterministic in shape - two runs produce the same business', () => {
    const a = makeDemoData()
    const b = makeDemoData()
    expect(b.sales.length).toBe(a.sales.length)
    expect(b.purchases.length).toBe(a.purchases.length)
    expect(b.deliveries.length).toBe(a.deliveries.length)
    // Same totals, even though ids/timestamps differ per run.
    const vol = (s: typeof a.sales) => s.reduce((sum, x) => sum + x.volumeLiters, 0)
    expect(vol(b.sales)).toBe(vol(a.sales))
  })

  it('purchase prices track the supplier’s latest quote (chart coherence)', () => {
    const { supplierQuotes: quotes, purchases } = makeDemoData()
    expect(quotes.length).toBeGreaterThan(100)
    let checked = 0
    for (const p of purchases) {
      const latest = quotes
        .filter((q) => q.supplierId === p.supplierId && q.date <= p.date)
        .sort((a, b) => b.date.localeCompare(a.date))[0]
      if (!latest) continue
      checked++
      // Seed prices purchases at quote −0.35 to +0.15 ₱/L.
      expect(Math.abs(p.pricePerLiter - latest.pricePerLiter)).toBeLessThanOrEqual(0.5)
    }
    expect(checked).toBeGreaterThan(20)
  })

  /**
   * The demo has to look like a business in the middle of its month, not one
   * that finished last night. Everything older than a day used to be
   * 'fulfilled' and delivered, so the trip board had two live columns out of
   * five and the sales list had nothing in flight.
   */
  it('leaves work in progress across the current month', () => {
    const d = makeDemoData()
    const today = new Date().toISOString().slice(0, 10)
    const month = today.slice(0, 7)

    expect(d.sales.filter((s) => s.date.slice(0, 7) === month).length).toBeGreaterThan(8)
    expect(d.sales.some((s) => s.status === 'confirmed')).toBe(true)

    const trips = new Set(d.deliveries.map((t) => t.status))
    // Something in every column of the board, not just the last one.
    expect(trips.has('scheduled')).toBe(true)
    expect(trips.has('loading')).toBe(true)
    expect(trips.has('in_transit')).toBe(true)
    expect(trips.has('delivered')).toBe(true)
  })

  /** The stage record the trip drawer is built around: who moved it on, the
   *  signed checklist, and the receipt at the far end. */
  it('gives trips their stage history', () => {
    const d = makeDemoData()
    const done = d.deliveries.filter((t) => t.status === 'delivered')
    expect(done.length).toBeGreaterThan(20)

    for (const t of done.slice(0, 10)) {
      expect(t.stamps?.plan?.byName).toBeTruthy()
      // Crew cannot sign in, so a dispatch names the seat that recorded it and
      // the driver whose signature is on the slip.
      expect(t.stamps?.dispatch?.onBehalfOf).toBe(t.driverId)
      expect(t.checklist?.referenceNo).toMatch(/^PDC-/)
      expect(t.documents?.deliveryReceipt?.referenceNo).toMatch(/^DR-/)
      expect(t.receivedBy).toBeTruthy()
      expect(t.outcome?.completedAt).toBeTruthy()
    }

    // A trip that came back undelivered says why.
    for (const t of d.deliveries.filter((x) => x.status === 'failed')) {
      expect(t.outcome?.failureReason).toBeTruthy()
    }
  })
})
