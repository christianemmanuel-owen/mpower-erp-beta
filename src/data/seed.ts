import { nanoid } from 'nanoid'
import { api } from '../lib/api'
import { queryClient } from '../lib/queryClient'
import { classifyDay, computePayslip, minutesOf, suggestCutoff } from '../lib/payroll'
import { DEFAULT_HR_CONFIG, HOLIDAYS_2026 } from './statutory'
import type {
  Agent, AttendanceRecord, BankAccount, Base, Customer, Delivery, DeliveryStatus,
  Holiday, LeaveRecord, PayrollRun, Personnel, Purchase, PurchaseInstallment,
  Sale, SaleInstallment, Shift, Supplier, SupplierQuote, Truck, Warehouse,
} from './types'

/** Deterministic RNG so demo data is stable. */
function mulberry32(seed: number) {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Reset at the top of makeDemoData so every call yields the identical dataset.
let rand = mulberry32(20260712)
const pick = <T,>(arr: T[]) => arr[Math.floor(rand() * arr.length)]
const between = (min: number, max: number) => min + rand() * (max - min)

function base(): Base {
  const t = new Date().toISOString()
  return { id: nanoid(10), createdAt: t, updatedAt: t }
}

function daysAgo(n: number) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString()
}

/**
 * How far along a sale of this age is.
 *
 * Graded rather than a cliff: a fortnight of live work, thinning out as it goes
 * back, so the board has orders at every stage on any day the demo is opened.
 */
function saleStatus(day: number): Sale['status'] {
  if (day === 0) return rand() < 0.25 ? 'draft' : 'confirmed'
  if (day <= 2) return rand() < 0.15 ? 'draft' : rand() < 0.75 ? 'confirmed' : 'fulfilled'
  if (day <= 6) return rand() < 0.3 ? 'confirmed' : 'fulfilled'
  if (day <= 12) return rand() < 0.1 ? 'confirmed' : 'fulfilled'
  return 'fulfilled'
}

/** Where the truck is, given the age of the order it belongs to. */
function tripStatus(day: number, saleStatus: Sale['status']): DeliveryStatus {
  if (saleStatus === 'fulfilled') return day > 12 ? 'delivered' : rand() < 0.06 ? 'failed' : 'delivered'
  // Today's board wants something in every column, including the first one.
  if (day === 0) return pick(['scheduled', 'scheduled', 'scheduled', 'loading'] as DeliveryStatus[])
  if (day === 1) return pick(['scheduled', 'loading', 'loading', 'in_transit'] as DeliveryStatus[])
  if (day <= 3) return pick(['loading', 'in_transit', 'in_transit', 'delivered'] as DeliveryStatus[])
  return pick(['in_transit', 'delivered', 'delivered'] as DeliveryStatus[])
}

const CHECKLIST_KEYS = [
  'identificationVerified', 'loadConfirmed', 'gpsPresent', 'fuelSensorPresent', 'smartLockPresent',
  'fullTankConfirmed', 'engineInspected', 'partsInspected', 'tiresInspected', 'bodyCamPresent',
] as const

/**
 * Everything a trip picks up as it moves: who signed off each stage, the
 * pre-dispatch checklist, the receipt at the far end, and the outcome.
 *
 * Crew have no logins, so a dispatch stamp names the office seat that recorded
 * it and the driver whose signature is on the slip - which is the distinction
 * the drawer is built to show.
 */
function tripStageData(
  day: number,
  status: DeliveryStatus,
  driver: Personnel,
  office: Personnel,
  customer: Customer,
): Partial<Delivery> {
  const stamp = (n: number, onBehalfOf?: string) => ({
    by: office.id, byName: office.name, at: daysAgo(n), ...(onBehalfOf ? { onBehalfOf } : {}),
  })
  const dispatched = status === 'loading' || status === 'in_transit' || status === 'delivered' || status === 'failed'
  const arrived = status === 'delivered' || status === 'failed'
  const ticked = dispatched || rand() < 0.5

  const out: Partial<Delivery> = {
    stamps: {
      plan: stamp(Math.min(day + 1, 95)),
      ...(dispatched ? { dispatch: stamp(day, driver.id) } : {}),
      ...(arrived ? { delivery: stamp(day) } : {}),
    },
    checklist: {
      ...Object.fromEntries(CHECKLIST_KEYS.map((k) => [k, ticked])),
      driverId: driver.id,
      allowanceIssued: pick([0, 300, 500, 800]),
      ...(dispatched ? { referenceNo: `PDC-${String(100000 + Math.floor(rand() * 899999))}` } : {}),
    } as Delivery['checklist'],
  }

  if (status === 'delivered') {
    out.documents = { deliveryReceipt: { referenceNo: `DR-2026-${String(10000 + Math.floor(rand() * 89999))}` } }
    out.receivedBy = customer.contactPerson
    out.receivedOn = daysAgo(day).slice(0, 10)
    out.outcome = {
      completedAt: daysAgo(day),
      ...(rand() < 0.12 ? { delayReason: pick(['Truck ban on C-5 until 9am', 'Queue at the depot', 'Rain, road closed at Km 14']) } : {}),
    }
  }
  if (status === 'failed') {
    out.outcome = {
      failureReason: pick(['Site closed on arrival', 'Nobody on site to receive', 'Wrong address given']),
    }
  }
  return out
}

export interface DemoData {
  warehouses: Warehouse[]
  suppliers: Supplier[]
  agents: Agent[]
  customers: Customer[]
  bankAccounts: BankAccount[]
  personnel: Personnel[]
  trucks: Truck[]
  purchases: Purchase[]
  sales: Sale[]
  deliveries: Delivery[]
  supplierQuotes: SupplierQuote[]
  shifts: Shift[]
  holidays: Holiday[]
  attendance: AttendanceRecord[]
  leaves: LeaveRecord[]
  payrollRuns: PayrollRun[]
}

/** Replaces everything in the shared database (except seats) with the demo dataset. */
export async function resetDemoData() {
  await api('/import', { method: 'POST', body: { tables: makeDemoData(), mode: 'replace' } })
  await queryClient.invalidateQueries()
}

/** Weekly quoted prices per supplier over the past 12 months - a shared market
 * random walk plus a stable per-supplier offset, so lines track together but rank consistently. */
function makeQuotes(suppliers: Supplier[]): SupplierQuote[] {
  const offsets = [0.35, 0.95, -0.4, 0.1]
  const quotes: SupplierQuote[] = []
  let market = 51.5
  for (let week = 52; week >= 0; week--) {
    market = Math.min(56, Math.max(49, market + between(-0.6, 0.75)))
    suppliers.forEach((s, i) => {
      quotes.push({
        ...base(),
        supplierId: s.id,
        date: daysAgo(week * 7),
        pricePerLiter: Math.round((market + offsets[i % offsets.length] + between(-0.15, 0.15)) * 100) / 100,
      })
    })
  }
  return quotes
}

/** Latest quote for a supplier on or before a date (falls back to the supplier's earliest
 * quote if none qualifies). Order-independent on purpose. */
function quoteFor(quotes: SupplierQuote[], supplierId: string, date: string): number | null {
  let best: SupplierQuote | null = null
  let earliest: SupplierQuote | null = null
  for (const q of quotes) {
    if (q.supplierId !== supplierId) continue
    if (q.date <= date && (!best || q.date > best.date)) best = q
    if (!earliest || q.date < earliest.date) earliest = q
  }
  const chosen = best ?? earliest
  return chosen ? chosen.pricePerLiter : null
}

/** Splits a peso total into n roughly-equal installment amounts (last one absorbs the
 * rounding remainder so they always sum back to exactly `total`). */
function splitAmount(total: number, n: number): number[] {
  const base = Math.round((total / n) * 100) / 100
  const parts = new Array(n).fill(base)
  parts[n - 1] = Math.round((total - base * (n - 1)) * 100) / 100
  return parts
}

/** How many installments a credit sale/purchase gets - mostly one (the plain "pay it all by
 * this date" case), sometimes split into 2 or 3 to actually exercise installment plans in the
 * demo data. Cash always settles in one, on the spot, handled by the caller before this is used. */
function pickInstallmentCount(): number {
  return pick([1, 1, 1, 2, 2, 3])
}

/** Builds a sale's installment plan. Each installment's due date follows the customer's own
 * standing term, staggered 15 days apart for later installments. Cash settles immediately,
 * in one installment. Collected installments carry collectedAt (a day or two past due) so
 * "collected this period" reporting has real timestamps; some later installments of a split
 * plan get their own collector override to exercise the installment-level assignment. */
function makeSaleInstallments(day: number, total: number, paymentMode: Sale['paymentMode'], customer: Customer, collectors: Personnel[], bankAccounts: BankAccount[]): SaleInstallment[] {
  // No interest in the demo data - principal is the whole amount. Interest is something
  // a person adds by hand in the installment builder.
  // Cash never walks the custody chain: handing it over and it being money are
  // the same event, so it goes straight to cleared.
  if (paymentMode === 'cash') {
    return [{
      id: nanoid(8), amount: total, principal: total, interestPct: 0, dueDate: daysAgo(day),
      status: 'cleared', collectedAt: daysAgo(day), clearedAt: daysAgo(day),
    }]
  }
  const n = pickInstallmentCount()
  return splitAmount(total, n).map((amount, k) => {
    const due = day - (customer.paymentTermDays + k * 15)
    const isCheck = paymentMode === 'check'
    const cancelled = rand() < 0.05
    // Only a check can bounce - a bank transfer either lands or doesn't - and
    // only one that has already been presented.
    const bounced = !cancelled && isCheck && due > 10
      && rand() < (shakyPayer(customer.company) ? 0.4 : 0.03)

    /**
     * How far along the chain this one has got.
     *
     * The demo has to contain all of it or Treasury opens empty and the
     * distinction the client asked about can't be seen: checks in a drawer,
     * checks at the bank, checks that cleared, and - the case that prompted
     * all this - a post-dated check already collected weeks before its own
     * date, which cannot be deposited yet however overdue it looks.
     */
    const settled = !cancelled && !bounced && due > 10
    const roll = rand()
    /**
     * Clearing takes a few banking days, not months.
     *
     * Rolling "in clearing" evenly across every settled item left checks
     * apparently sitting at the bank for two months, which is not a slow
     * deposit - it is a record somebody forgot to close, and the demo should
     * not be full of them. So only recently-banked items are still waiting;
     * anything older has long since cleared. A few stay in hand at any age,
     * because a check nobody ever took to the bank is a real thing and the
     * queue that catches it is the point of the screen.
     */
    const recent = due <= 22
    const status: SaleInstallment['status'] = cancelled ? 'cancelled'
      : bounced ? 'bounced'
        : settled
          // A transfer lands or it doesn't; only checks sit in between.
          ? (!isCheck ? 'cleared'
            : roll < 0.08 ? 'collected'
              : recent && roll < 0.45 ? 'deposited' : 'cleared')
          // Not yet due - but a post-dated check is often already in hand.
          : (isCheck && rand() < 0.25 ? 'collected' : 'pending')

    const inHand = status === 'collected' || status === 'deposited' || status === 'cleared'
    /**
     * When the collector actually got hold of it.
     *
     * Two different stories, and using one formula for both put collection
     * dates in the future. A payment that was already due is collected a few
     * days AFTER its due date - chased, and a little late. A post-dated check
     * is the opposite: handed over early, weeks BEFORE the date written on it,
     * which is the whole reason it then sits in a drawer. `daysAgo` counts
     * backwards, so the two cases move the number in opposite directions, and
     * either way it is clamped to at least yesterday - nobody collects money
     * in the future.
     */
    const collectedDay = due > 10
      ? due - pick([0, 1, 2, 4])
      : Math.max(due + pick([3, 5, 8, 14]), 1)
    // The date on the face of the check: its due date. Collected early, it is
    // still unbankable until then - which is the whole point of the field.
    const checkDay = due
    const depositedDay = Math.min(collectedDay, checkDay) - pick([0, 1])
    const clearedDay = depositedDay - pick([1, 2, 3])

    const iso = (d: number) => daysAgo(Math.max(d, -21))
    return {
      id: nanoid(8), amount, principal: amount, interestPct: 0, dueDate: iso(due), status,
      checkDate: isCheck ? iso(checkDay) : undefined,
      collectedAt: inHand || bounced ? iso(collectedDay) : undefined,
      depositedAt: status === 'deposited' || status === 'cleared' ? iso(depositedDay) : undefined,
      clearedAt: status === 'cleared' ? iso(clearedDay) : undefined,
      referenceNo: isCheck ? `${pick(['BPI', 'BDO', 'MBTC', 'SEC'])}-${100000 + Math.floor(rand() * 899999)}` : undefined,
      depositSlipNo: status === 'deposited' || status === 'cleared' ? `DS-${200000 + Math.floor(rand() * 799999)}` : undefined,
      // Which of our accounts it went into - blank until it is actually banked.
      bankAccountId: status === 'deposited' || status === 'cleared' ? pick(bankAccounts).id : undefined,
      notes: bounced ? pick(BOUNCE_REASONS) : undefined,
      // Later installments of a split plan occasionally have their own person in charge.
      collectorId: k > 0 && rand() < 0.3 ? pick(collectors).id : undefined,
    }
  })
}

const BOUNCE_REASONS = [
  'Insufficient funds - client re-issuing',
  'Account closed',
  'Drawn against uncollected deposits',
  'Signature differs from specimen',
  'Stop payment order from the drawer',
]

/**
 * The demo accounts that write checks which don't clear.
 *
 * Without any, the bounced path is invisible in the demo: the board's Bounced
 * column is empty, an account's credit history is blank, and the B.P. 22 and
 * R.A. 10951 notes never appear, so none of it can be looked at without hand-
 * editing a record. Real books don't scatter bounces evenly either - most
 * accounts never write a bad check and one or two write several - and the
 * escalating estafa brackets only say anything on an account that has more
 * than one. Named rather than sampled, so the same accounts are the shaky
 * ones every time and the figures on them are stable enough to talk about.
 */
const SHAKY_PAYERS = ['Bahia Resort Group', 'Tridente Marine Services']
const shakyPayer = (company: string) => SHAKY_PAYERS.includes(company)

/** Same idea, mirrored for money owed to a supplier. */
function makePurchaseInstallments(day: number, total: number, paymentMode: Purchase['paymentMode'], supplier: Supplier, date: string): PurchaseInstallment[] {
  if (paymentMode === 'cash') {
    return [{ id: nanoid(8), amount: total, principal: total, interestPct: 0, dueDate: date, status: 'paid' }]
  }
  const n = pickInstallmentCount()
  return splitAmount(total, n).map((amount, k) => {
    const due = day - (supplier.paymentTermDays + k * 15)
    const cancelled = rand() < 0.05
    const status: PurchaseInstallment['status'] = cancelled ? 'cancelled' : due > 10 ? 'paid' : 'pending'
    return {
      id: nanoid(8), amount, principal: amount, interestPct: 0, dueDate: daysAgo(Math.max(due, -21)), status,
      // Money out has the same custody question as money in, so Treasury's
      // payables list needs to know when each one actually left and on what.
      paidAt: status === 'paid' ? daysAgo(Math.max(due - pick([0, 1, 2]), -21)) : undefined,
      referenceNo: status === 'paid' ? `${pick(['BPI', 'BDO', 'MBTC'])}-${100000 + Math.floor(rand() * 899999)}` : undefined,
    }
  })
}

/** The full demo dataset, as plain arrays keyed by table name - pure generation,
 * no storage. Deterministic: every call produces the same shape of business. */
export function makeDemoData(): DemoData {
  rand = mulberry32(20260712)

  const warehouses = [
    { ...base(), name: 'Valenzuela depot', address: 'MacArthur Hwy, Valenzuela City', capacityLiters: 120000, lat: 14.7011, lng: 120.983 },
    { ...base(), name: 'Batangas depot', address: 'Diversion Rd, Batangas City', capacityLiters: 80000, lat: 13.7565, lng: 121.0583 },
    { ...base(), name: 'Cavite depot', address: 'Centennial Rd, Kawit, Cavite', capacityLiters: 60000, lat: 14.4791, lng: 120.897 },
  ]
  // Payment term days per supplier - fixed per account (not re-rolled per purchase), matching
  // how real credit terms work: negotiated once with the supplier, applied to every invoice.
  const suppliers = [
    { ...base(), name: 'Petron Bulk Sales', contactPerson: 'A. Villanueva', contactNumber: '0917 555 0101', address: 'San Miguel Ave, Pasig', paymentTermDays: 30 },
    { ...base(), name: 'Shell Trading PH', contactPerson: 'K. Lim', contactNumber: '0917 555 0102', address: 'BGC, Taguig', paymentTermDays: 45 },
    { ...base(), name: 'Seaoil Distribution', contactPerson: 'R. Ocampo', contactNumber: '0917 555 0103', address: 'Ortigas, Pasig', paymentTermDays: 15 },
    { ...base(), name: 'Phoenix Petroleum', contactPerson: 'D. Uy', contactNumber: '0917 555 0104', address: 'Davao / Manila office', paymentTermDays: 30 },
  ]
  const agents = [
    { ...base(), name: 'Ramon Santos', contactNumber: '0918 555 0201', monthlyQuotaLiters: 60000 },
    { ...base(), name: 'Jenny dela Cruz', contactNumber: '0918 555 0202', monthlyQuotaLiters: 55000 },
    { ...base(), name: 'Marco Reyes', contactNumber: '0918 555 0203', monthlyQuotaLiters: 50000 },
    { ...base(), name: 'Liza Fernandez', contactNumber: '0918 555 0204', monthlyQuotaLiters: 45000 },
    { ...base(), name: 'Paolo Garcia', contactNumber: '0918 555 0205', monthlyQuotaLiters: 40000 },
  ]
  const customerRows: Array<[string, string, string]> = [
    ['Kargamento Trucking Corp', 'Kargamento', 'Meycauayan, Bulacan'],
    ['Nova Build Construction', 'NovaBuild', 'Quezon City'],
    ['South Reef Fishing Fleet', 'South Reef', 'Navotas Fish Port'],
    ['Lakbay Bus Lines', 'Lakbay', 'Cubao, Quezon City'],
    ['Bukid Agri Ventures', 'Bukid Agri', 'San Jose, Nueva Ecija'],
    ['Harbor Point Logistics', 'HarborPoint', 'Subic Bay Freeport'],
    ['Tridente Marine Services', 'Tridente', 'Batangas Pier'],
    ['GreenField Farms Inc', 'GreenField', 'Lipa, Batangas'],
    ['Metro Mix Concrete', 'MetroMix', 'Pasig City'],
    ['Isla Power Rentals', 'Isla Power', 'Bacoor, Cavite'],
    ['Del Sur Hauling', 'Del Sur', 'Dasmariñas, Cavite'],
    ['AgriMach Equipment', 'AgriMach', 'Tarlac City'],
    ['Bahia Resort Group', 'Bahia', 'Nasugbu, Batangas'],
    ['Cargo King Movers', 'Cargo King', 'Caloocan City'],
    ['Sierra Quarry Corp', 'Sierra', 'Montalban, Rizal'],
  ]
  const customers: Customer[] = customerRows.map(([company, brand, address], i) => ({
    ...base(), company, brand, address,
    contactPerson: pick(['J. Tan', 'M. Cruz', 'A. Ramos', 'P. Aquino', 'C. Bautista']),
    contactNumber: `0917 555 03${String(i).padStart(2, '0')}`,
    customerSince: daysAgo(Math.round(between(1, 8) * 365)),
    // Fixed per account, same reasoning as suppliers above.
    paymentTermDays: pick([15, 30, 30, 45]),
  }))
  const bankAccounts = [
    { ...base(), bankName: 'BDO', accountName: 'DTC Fuel Trading Inc', accountNumberMasked: '•••• 4521' },
    { ...base(), bankName: 'BPI', accountName: 'DTC Fuel Trading Inc', accountNumberMasked: '•••• 8830' },
    { ...base(), bankName: 'Metrobank', accountName: 'DTC Fuel Trading Inc', accountNumberMasked: '•••• 1207' },
  ]
  // Shifts first - employees reference them.
  const shifts: Shift[] = [
    { ...base(), name: 'Day shift', startTime: '08:00', endTime: '17:00', breakMinutes: 60, restDays: [0] },
    { ...base(), name: 'Night watch', startTime: '19:00', endTime: '07:00', breakMinutes: 60, restDays: [0] },
  ]
  const [dayShift, nightShift] = shifts

  /** Shared HR fields for a crew/office employee. NCR-plausible rates. */
  const hr = (rateType: 'daily' | 'monthly', baseRate: number, allowancePerDay: number, shiftId: string): Partial<Personnel> => ({
    rateType, baseRate, allowancePerDay, shiftId,
    paySchedule: 'semi_monthly',
    hireDate: daysAgo(Math.round(between(0.5, 7) * 365)).slice(0, 10),
    active: true,
    statutory: { sss: true, philhealth: true, pagibig: true, withholdingTax: true },
    leaveEntitlements: [
      { typeId: 'sil', daysPerYear: 5 },
      { typeId: 'vacation', daysPerYear: 5 },
      { typeId: 'sick', daysPerYear: 5 },
    ],
  })

  const personnel: Personnel[] = [
    ...['Ben Ramos', 'Efren Garcia', 'Nilo Cruz', 'Rey Mendoza', 'Vic Torres', 'Jun Salazar'].map((name, i) => ({
      ...base(), name, role: 'driver' as const, contactNumber: `0919 555 04${String(i).padStart(2, '0')}`,
      ...hr('daily', pick([750, 780, 800, 820]), 70, dayShift.id),
    })),
    ...['Toto Diaz', 'Ambo Reyes', 'Nonoy Lopez', 'Boyet Santos'].map((name, i) => ({
      ...base(), name, role: 'pahinante' as const, contactNumber: `0919 555 05${String(i).padStart(2, '0')}`,
      ...hr('daily', pick([610, 620, 640]), 50, dayShift.id),
    })),
    ...['Lito Aguilar', 'Domeng Castro', 'Erning Flores'].map((name, i) => ({
      ...base(), name, role: 'loader' as const, contactNumber: `0919 555 06${String(i).padStart(2, '0')}`,
      ...hr('daily', pick([630, 650, 670]), 50, dayShift.id),
    })),
    ...['SG Manny Roxas', 'SG Carding Velasco'].map((name, i) => ({
      ...base(), name, role: 'guard' as const, contactNumber: `0919 555 07${String(i).padStart(2, '0')}`,
      // The second guard holds the night watch - night differential shows up in payroll.
      ...hr('daily', 700, 50, i === 1 ? nightShift.id : dayShift.id),
    })),
    // Sales staff - modest monthly base plus commission from their linked agent's sales.
    {
      ...base(), name: 'Ramon Santos', role: 'sales', contactNumber: '0918 555 0201',
      ...hr('monthly', 20_000, 0, dayShift.id),
      agentId: agents[0].id, commissionRate: { kind: 'per_liter', value: 0.25 },
    },
    {
      ...base(), name: 'Jenny dela Cruz', role: 'sales', contactNumber: '0918 555 0202',
      ...hr('monthly', 20_000, 0, dayShift.id),
      agentId: agents[1].id, commissionRate: { kind: 'per_liter', value: 0.2 },
    },
    // Office staff - monthly salaries.
    { ...base(), name: 'Grace Villanueva', role: 'manager', contactNumber: '0919 555 0801', ...hr('monthly', 38_000, 0, dayShift.id) },
    { ...base(), name: 'Cely Ramos', role: 'office', contactNumber: '0919 555 0802', ...hr('monthly', 26_000, 0, dayShift.id) },
    { ...base(), name: 'Dina Cruz', role: 'office', contactNumber: '0919 555 0803', ...hr('monthly', 18_000, 0, dayShift.id) },
  ]
  // Collection addresses: a couple of accounts settle somewhere other than their delivery site.
  customers[0].collectionAddress = 'Kargamento billing office, 2F Uytengsu Bldg, Meycauayan, Bulacan'
  customers[3].collectionAddress = 'Lakbay head office, Aurora Blvd cor. EDSA, Cubao, Quezon City'

  // People who chase receivables in the demo: the two sales staff plus the office clerks.
  const collectors = personnel.filter((p) => p.role === 'sales' || p.role === 'office')

  const drivers = personnel.filter((p) => p.role === 'driver')
  const trucks: Truck[] = ['NBC 1234', 'KLM 5678', 'PQR 9012', 'DEF 3456', 'XYZ 7890', 'JKL 2468'].map((plateNumber, i) => ({
    ...base(), plateNumber, capacityLiters: pick([10000, 12000, 16000]), assignedDriverId: drivers[i]?.id,
  }))

  // Sales: 1–4 per day, 2k–12k L each. Generated before purchases so purchase volumes can be
  // sized to actually cover what each depot sells - stock never goes negative.
  const sales: Sale[] = []
  const deliveries: Delivery[] = []
  const soldByWarehouse = new Map<string, number>()
  for (let day = 90; day >= 0; day--) {
    // The last few days are busier, and lean towards deliveries. Not because
    // trade picks up on a Wednesday: at two and a bit orders a day, of which a
    // third are pickups, the trip board's live columns came down to one or two
    // trips - so whether Scheduled had anything in it was a coin toss on the
    // day the demo happened to be opened.
    const recent = day <= 3
    const count = Math.floor(recent ? between(3, 6) : between(1, 4.4))
    for (let i = 0; i < count; i++) {
      const customer = pick(customers)
      const warehouse = pick(warehouses)
      const fulfillment = rand() > (recent ? 0.15 : 0.35) ? ('delivery' as const) : ('pickup' as const)
      const paymentMode = pick(['cash', 'check', 'bank_transfer'] as const)
      const pricePerLiter = Math.round(between(56, 61) * 100) / 100
      const volumeLiters = Math.round(between(2, 12)) * 1000
      const sale: Sale = {
        ...base(),
        agentId: pick(agents).id,
        customerId: customer.id,
        date: daysAgo(day),
        pricePerLiter,
        volumeLiters,
        warehouseId: warehouse.id,
        fulfillment,
        scheduleDate: daysAgo(Math.max(day - 1, -2)),
        paymentMode,
        bankAccountId: paymentMode === 'bank_transfer' ? pick(bankAccounts).id : undefined,
        // Most sales have a default person in charge of collection; a few are left
        // unassigned so the module's "Unassigned" group has something to show.
        collectorId: rand() < 0.85 ? pick(collectors).id : undefined,
        installments: makeSaleInstallments(day, volumeLiters * pricePerLiter, paymentMode, customer, collectors, bankAccounts),
        // Work in progress does not stop at yesterday. Everything older than a
        // day used to be 'fulfilled', so the current month read as a finished
        // month with two live days stuck on the end - no order confirmed on
        // Monday still moving on Thursday, which is most of what a dispatcher
        // actually looks at.
        status: saleStatus(day),
      }
      sales.push(sale)
      if (sale.status !== 'draft') {
        soldByWarehouse.set(warehouse.id, (soldByWarehouse.get(warehouse.id) ?? 0) + sale.volumeLiters)
      }
      if (fulfillment === 'delivery' && sale.status !== 'draft') {
        const status = tripStatus(day, sale.status)
        const driver = pick(drivers)
        const office = pick(personnel.filter((p) => p.role === 'office' || p.role === 'manager'))
        deliveries.push({
          ...base(),
          saleId: sale.id,
          scheduleDate: sale.scheduleDate ?? sale.date,
          movementType: 'delivery_to_client',
          truckId: pick(trucks).id,
          driverId: driver.id,
          pahinanteId: pick(personnel.filter((p) => p.role === 'pahinante')).id,
          loaderId: pick(personnel.filter((p) => p.role === 'loader')).id,
          guardId: pick(personnel.filter((p) => p.role === 'guard')).id,
          deliveryAddress: customer.address,
          contactPerson: customer.contactPerson,
          contactNumber: customer.contactNumber,
          status,
          // The stage record. Without these every trip opened with four blank
          // stamps and no history, which is not what a system three months into
          // use looks like.
          ...tripStageData(day, status, driver, office, customer),
        })
      }
    }
  }
  // Purchases: ~2–3 per week, 15k–30k L each, steered toward whichever depot needs it most so
  // every depot ends up 60–90% full - never oversold, never over capacity.
  const targetFill: Record<string, number> = {
    [warehouses[0].id]: 0.62, // Valenzuela - biggest depot, kept comfortably below full
    [warehouses[1].id]: 0.7, // Batangas
    [warehouses[2].id]: 0.86, // Cavite - smallest depot, runs closer to capacity (shows the "near full" routing tip)
  }
  const remainingNeed = new Map(
    warehouses.map((w) => [w.id, (soldByWarehouse.get(w.id) ?? 0) + Math.round(w.capacityLiters * targetFill[w.id])]),
  )

  const supplierQuotes = makeQuotes(suppliers)
  // Cheaper suppliers win more of the business (weighted pick favors low offsets).
  const supplierWeights = [4, 1, 3, 2]
  const weightedSupplier = () => {
    const total = supplierWeights.reduce((a, b) => a + b, 0)
    let roll = rand() * total
    for (let i = 0; i < suppliers.length; i++) {
      roll -= supplierWeights[i % supplierWeights.length]
      if (roll <= 0) return suppliers[i]
    }
    return suppliers[0]
  }

  const purchases: Purchase[] = []
  for (let day = 92; day >= 0; day -= Math.floor(between(2, 4))) {
    const volumeLiters = Math.round(between(15, 30)) * 1000
    const ranked = [...warehouses].sort((a, b) => (remainingNeed.get(b.id) ?? 0) - (remainingNeed.get(a.id) ?? 0))
    const target = rand() < 0.75 ? ranked[0] : ranked[1]
    const status: Purchase['status'] = day <= 1 && rand() > 0.5 ? 'ordered' : 'received'
    if (status === 'received') remainingNeed.set(target.id, (remainingNeed.get(target.id) ?? 0) - volumeLiters)
    const supplier = weightedSupplier()
    const date = daysAgo(day)
    const quoted = quoteFor(supplierQuotes, supplier.id, date)
    const pricePerLiter = quoted !== null
      ? Math.round((quoted + between(-0.35, 0.15)) * 100) / 100
      : Math.round(between(50, 55) * 100) / 100
    const paymentMode = pick(['cash', 'check', 'bank_transfer'] as const)
    purchases.push({
      ...base(),
      supplierId: supplier.id,
      date,
      pricePerLiter,
      volumeLiters,
      fulfillment: rand() > 0.4 ? 'delivered' : 'pickup',
      warehouseId: target.id,
      status,
      paymentMode,
      bankAccountId: paymentMode === 'bank_transfer' ? pick(bankAccounts).id : undefined,
      installments: makePurchaseInstallments(day, volumeLiters * pricePerLiter, paymentMode, supplier, date),
    })
  }
  // Opening stock: top up any depot the cadence above didn't fully cover, dated just before
  // the visible 92-day window so it reads as pre-existing inventory rather than a recent order.
  for (const w of warehouses) {
    const shortfall = remainingNeed.get(w.id) ?? 0
    if (shortfall > 500) {
      const supplier = pick(suppliers)
      const date = daysAgo(95)
      const quoted = quoteFor(supplierQuotes, supplier.id, date)
      const volumeLiters = Math.round(shortfall / 1000) * 1000
      const pricePerLiter = quoted !== null
        ? Math.round((quoted + between(-0.35, 0.15)) * 100) / 100
        : Math.round(between(50, 55) * 100) / 100
      purchases.push({
        ...base(),
        supplierId: supplier.id,
        date,
        pricePerLiter,
        volumeLiters,
        fulfillment: 'delivered',
        warehouseId: w.id,
        status: 'received',
        // Old opening stock - settled by now regardless of payment mode.
        paymentMode: 'bank_transfer',
        bankAccountId: pick(bankAccounts).id,
        installments: [{
          id: nanoid(8), amount: volumeLiters * pricePerLiter, principal: volumeLiters * pricePerLiter,
          interestPct: 0, dueDate: daysAgo(95), status: 'paid',
        }],
      })
    }
  }

  /**
   * The tracking map needs something on the road.
   *
   * This used to force the first two non-delivered trips to 'in_transit' - which
   * was harmless when every trip older than a day was already delivered, and
   * destructive once the generator started staging them: the only trips it
   * could find were the ones deliberately left in Scheduled and Loading, so it
   * emptied the first two columns of the board to fill the map. It now tops up
   * only when nothing is moving, and takes the trip closest to the road.
   */
  if (!deliveries.some((d) => d.status === 'in_transit')) {
    const closest = [...deliveries].reverse().find((d) => d.status === 'loading')
      ?? [...deliveries].reverse().find((d) => d.status === 'scheduled')
    if (closest) closest.status = 'in_transit'
  }

  // ---- HR: holidays, leaves, attendance, payroll runs -----------------------

  const holidays: Holiday[] = HOLIDAYS_2026.map((h) => ({ ...base(), ...h }))
  const shiftOf = (p: Personnel) => (p.shiftId === nightShift.id ? nightShift : dayShift)

  // A few leaves inside the attendance window: a 2-day sick leave, a 3-day
  // vacation, and one unpaid day.
  const leaves: LeaveRecord[] = [
    { ...base(), employeeId: personnel[1].id, typeId: 'sick', dateFrom: daysAgo(21).slice(0, 10), dateTo: daysAgo(20).slice(0, 10), notes: 'Flu - with medical certificate' },
    { ...base(), employeeId: personnel[10].id, typeId: 'vacation', dateFrom: daysAgo(13).slice(0, 10), dateTo: daysAgo(11).slice(0, 10), notes: 'Province trip' },
    { ...base(), employeeId: personnel[personnel.length - 1].id, typeId: 'unpaid', dateFrom: daysAgo(6).slice(0, 10), dateTo: daysAgo(6).slice(0, 10) },
  ]

  // ~2 months of encoded time records: mostly on time, a sprinkle of lates,
  // OT, absences, and the occasional rest-day duty for yard crew.
  const hhmm = (mins: number) => `${String(Math.floor(mins / 60) % 24).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`
  const attendance: AttendanceRecord[] = []
  for (const p of personnel) {
    const shift = shiftOf(p)
    for (let day = 60; day >= 1; day--) {
      const date = daysAgo(day).slice(0, 10)
      if (leaves.some((l) => l.employeeId === p.id && l.dateFrom <= date && l.dateTo >= date)) continue
      const dayType = classifyDay(date, holidays, shift)
      if (dayType !== 'ordinary' && !(rand() < 0.04 && (p.role === 'driver' || p.role === 'loader'))) continue
      const roll = rand()
      if (roll < 0.025) {
        attendance.push({ ...base(), employeeId: p.id, date, status: 'absent' })
        continue
      }
      if (roll < 0.035) {
        attendance.push({ ...base(), employeeId: p.id, date, status: 'half_day' })
        continue
      }
      const inMin = minutesOf(shift.startTime) + (rand() < 0.12 ? Math.round(between(8, 40)) : 0)
      const outMin = minutesOf(shift.endTime) + (rand() < 0.18 && p.role !== 'office' && p.role !== 'manager' ? Math.round(between(1, 3)) * 60 : 0)
      attendance.push({ ...base(), employeeId: p.id, date, status: 'present', timeIn: hhmm(inMin), timeOut: hhmm(outMin) })
    }
  }

  // Two semi-monthly runs off that data: the older one finalized, the latest a draft.
  const today = new Date().toISOString().slice(0, 10)
  const lastCutoff = suggestCutoff('semi_monthly', today)
  const priorCutoff = suggestCutoff('semi_monthly', lastCutoff.periodStart)
  const mkRun = (cutoff: { periodStart: string; periodEnd: string }, status: PayrollRun['status']): PayrollRun => ({
    ...base(),
    ...cutoff,
    paySchedule: 'semi_monthly',
    status,
    payslips: personnel.map((p) =>
      computePayslip({
        employee: p,
        config: DEFAULT_HR_CONFIG,
        shift: shiftOf(p),
        holidays, attendance, leaves, sales,
        periodStart: cutoff.periodStart,
        periodEnd: cutoff.periodEnd,
        paySchedule: 'semi_monthly',
      }),
    ),
  })
  const payrollRuns = [mkRun(priorCutoff, 'finalized'), mkRun(lastCutoff, 'draft')]

  return {
    warehouses, suppliers, agents, customers, bankAccounts, personnel, trucks,
    purchases, sales, deliveries, supplierQuotes,
    shifts, holidays, attendance, leaves, payrollRuns,
  }
}
