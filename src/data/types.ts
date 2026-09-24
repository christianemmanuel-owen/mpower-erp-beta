export type ID = string

export interface Base {
  id: ID
  createdAt: string
  updatedAt: string
}

export interface Supplier extends Base {
  name: string
  contactPerson: string
  contactNumber: string
  address: string
  /** The supplier's sales agent for MPower's account, and how to reach them. */
  agentName?: string
  agentContact?: string
  /** The supplier depot MPower loads from, when it differs from the office address. */
  depotName?: string
  depotAddress?: string
  /** Standing credit term with this supplier, in days - a new purchase's due date
   * auto-fills to the purchase date plus this many days (0 = pay on delivery). */
  paymentTermDays: number
}

export interface Warehouse extends Base {
  name: string
  address: string
  capacityLiters: number
  lat: number
  lng: number
}

export interface Agent extends Base {
  name: string
  contactNumber: string
  monthlyQuotaLiters: number
}

/** One party at an account - Exhibit A 1.4 specifies office, delivery and
 * collection contacts separately, each with its own person and designation. */
export interface ContactPoint {
  address?: string
  contactPerson?: string
  designation?: string
  email?: string
  contactNumber?: string
}

/** How the account prefers to be reached (Exhibit A 1.4). */
export interface PreferredContact {
  platform?: 'viber' | 'whatsapp' | 'messenger' | 'telegram' | 'email' | 'sms' | 'call'
  /** Username or group chat name on that platform. */
  handle?: string
}

export interface Customer extends Base {
  company: string
  brand: string
  address: string
  contactPerson: string
  contactNumber: string
  /** ISO date the account relationship started ("years with the company"). */
  customerSince?: string
  /** Standing credit term with this customer, in days - a new sale's due date auto-fills
   * to the sale date plus this many days (0 = due on the spot). */
  paymentTermDays: number
  /** Where payment is collected when it differs from the delivery address - collection
   * screens fall back to `address` when this is blank. */
  collectionAddress?: string

  // ---- Accounts module commercial profile (Exhibit A 1.4) -------------------
  // All optional: accounts created before this profile existed stay valid, and
  // readers fall back to the flat address/contactPerson/contactNumber above.

  /** Who generated the lead - a Personnel or Agent id, or a free-text source. */
  leadGeneratedBy?: string
  office?: ContactPoint
  delivery?: ContactPoint
  collection?: ContactPoint
  preferredContact?: PreferredContact
  /** Usual selling price per liter for this account, and the markup the purchaser
   * takes on top, where applicable. Reference figures staff quote from - not a
   * price the System enforces on a sale. */
  usualPricePerLiter?: number
  usualMarkupPct?: number
  usualPaymentMode?: PaymentMode
  /** Credit score per the formula to be confirmed in writing by the Parties
   * (Exhibit A 1.4). Deliberately left unpopulated: `creditScore` in
   * src/lib/credit.ts returns null until the formula is agreed. Ease of
   * collection and punctuality ARE derived today - see creditHistory(). */
  creditScoreOverride?: number
  notes?: string
}

/** Derived from collection records, never stored (Exhibit A 1.4 credit history). */
export interface CreditHistory {
  /** Installments settled, of those due. */
  collectedCount: number
  dueCount: number
  /** Share of collected installments settled on or before their due date. */
  punctualityPct: number
  /** Mean days between due date and collection (negative = paid early). */
  avgDaysLate: number
  /** Installments that bounced, as a share of those collected or attempted. */
  bouncedPct: number
  /** Currently overdue and unpaid. */
  overdueCount: number
  overdueAmount: number
}

/** A price a supplier quoted on a given date - bought or not. */
export interface SupplierQuote extends Base {
  supplierId: ID
  date: string
  pricePerLiter: number
}

export interface BankAccount extends Base {
  bankName: string
  accountName: string
  accountNumberMasked: string
}

export type PersonnelRole = 'driver' | 'pahinante' | 'loader' | 'guard' | 'office' | 'sales' | 'manager'

/** The roles Trips assigns to deliveries - crew pickers filter to exactly these. */
export const CREW_ROLES: readonly PersonnelRole[] = ['driver', 'pahinante', 'loader', 'guard'] as const

export type RateType = 'daily' | 'monthly'
export type PaySchedule = 'weekly' | 'semi_monthly' | 'monthly'

export interface CommissionRate {
  kind: 'per_liter' | 'percent_of_sale'
  value: number
}

/** Which government deductions payroll computes for an employee. */
export interface StatutoryToggles {
  sss: boolean
  philhealth: boolean
  pagibig: boolean
  withholdingTax: boolean
}

export interface LeaveEntitlement {
  typeId: string
  daysPerYear: number
}

/** A person on the payroll (and, for crew roles, assignable to Trips).
 * HR fields are optional so records created before the HR module stay valid -
 * readers apply defaults via employeeDefaults() in src/lib/payroll.ts.
 * The server hides pay-sensitive fields from seats without HR access. */
/**
 * Clearing a field: send `null`, never `undefined`.
 *
 * The client JSON.stringifies its PATCH body and the server merges it as
 * `{ ...existing, ...body }`. JSON.stringify DROPS undefined keys, so a patch of
 * `{ agentId: undefined }` arrives as `{}` and the old value survives - the save
 * appears to succeed and changes nothing. Every optional field below that a user
 * can empty out is therefore typed `| null`, so that TypeScript pushes call sites
 * towards the value that actually clears. Readers keep working either way: `??`
 * and falsiness treat null and undefined alike.
 */
export interface Personnel extends Base {
  name: string
  role: PersonnelRole
  contactNumber: string
  /** 'daily' = ₱/day, no-work-no-pay; 'monthly' = fixed ₱/month. */
  rateType?: RateType
  baseRate?: number
  /** Non-taxable daily allowance, paid per paid day, excluded from statutory bases. */
  allowancePerDay?: number
  paySchedule?: PaySchedule
  shiftId?: ID | null
  hireDate?: string | null
  /** Inactive employees drop out of attendance grids and payroll runs but keep history. */
  active?: boolean
  /** Links this employee to a sales Agent - payroll pre-fills commission from fulfilled sales. */
  agentId?: ID | null
  commissionRate?: CommissionRate | null
  govIds?: { sss?: string; philhealth?: string; pagibig?: string; tin?: string }
  statutory?: StatutoryToggles
  leaveEntitlements?: LeaveEntitlement[]
}

// ---- HR ---------------------------------------------------------------------

export interface Shift extends Base {
  name: string
  /** "HH:mm"; endTime earlier than startTime means the shift crosses midnight. */
  startTime: string
  endTime: string
  breakMinutes: number
  /** Weekday numbers 0 (Sun) – 6 (Sat) that are rest days for this shift. */
  restDays: number[]
}

export type AttendanceStatus = 'present' | 'absent' | 'half_day'

/** One employee-day. Only encoded days have records - payroll treats a scheduled
 * workday with no record as absent. */
export interface AttendanceRecord extends Base {
  employeeId: ID
  date: string
  status: AttendanceStatus
  timeIn?: string | null
  timeOut?: string | null
  /** Manual override; when absent, OT is derived from timeIn/timeOut vs. the shift. */
  otHours?: number | null
  notes?: string | null
  /** Seat that encoded this record - future self-service clock-in sets its own seat here. */
  sourceSeatId?: ID
}

export interface LeaveRecord extends Base {
  employeeId: ID
  /** References a leave type in HR settings (hr config leaveTypes). */
  typeId: string
  dateFrom: string
  dateTo: string
  notes?: string | null
}

export type HolidayKind = 'regular' | 'special_nonworking' | 'special_working'

export interface Holiday extends Base {
  date: string
  name: string
  kind: HolidayKind
}

export interface LeaveType {
  id: string
  label: string
  paid: boolean
}

/** DOLE pay premiums as multipliers of the daily (first 8h) or hourly (OT) rate. */
export interface PremiumRates {
  ordinaryOt: number
  restDay: number
  restDayOt: number
  specialDay: number
  specialDayOt: number
  specialRestDay: number
  specialRestDayOt: number
  regularHoliday: number
  regularHolidayOt: number
  regularHolidayRestDay: number
  regularHolidayRestDayOt: number
  /** Added on top of the applicable hourly rate for work between 22:00–06:00. */
  nightDiff: number
}

/** MSC = monthly salary rounded to the nearest `step`, clamped to [minMsc, maxMsc].
 * Employee deduction = MSC × eeRate (the rate already includes the MPF share above
 * mpfThresholdMsc - kept for reference/reporting). */
export interface SssTable {
  eeRate: number
  erRate: number
  minMsc: number
  maxMsc: number
  step: number
  mpfThresholdMsc: number
}

export interface PhilhealthTable {
  rate: number
  floor: number
  ceiling: number
  /** Employee's share of the total premium (0.5 = split equally with employer). */
  eeShare: number
}

export interface PagibigTable {
  eeRate: number
  erRate: number
  maxFundSalary: number
}

/** Bracket applies when taxable income ≥ over: tax = baseTax + rate × (income − over). */
export interface WithholdingBracket {
  over: number
  baseTax: number
  rate: number
}

export type WithholdingTables = Record<'daily' | 'weekly' | 'semi_monthly' | 'monthly', WithholdingBracket[]>

/** Everything configurable about HR/payroll, stored as one document (hrSettings table,
 * single record) so admins edit and the app reads one object. Missing fields fall back
 * to the seeded defaults (see src/data/statutory.ts). */
export interface HrConfig {
  defaultPaySchedule: PaySchedule
  workdayHours: number
  /** Divisor turning a monthly base rate into a daily equivalent (PH convention: 26). */
  monthlyWorkDays: number
  statutoryDefaults: StatutoryToggles
  leaveTypes: LeaveType[]
  premiumRates: PremiumRates
  sss: SssTable
  philhealth: PhilhealthTable
  pagibig: PagibigTable
  withholding: WithholdingTables
}

export interface HrSettingsRecord extends Base {
  config: HrConfig
}

export interface PayslipLine {
  label: string
  amount: number
  /** Counted into taxable income for withholding when true (default). */
  taxable: boolean
}

/** Hour/day counts behind a payslip's money - shown as the expandable detail. */
export interface PayslipDays {
  daysWorked: number
  daysAbsent: number
  paidLeaveDays: number
  unpaidLeaveDays: number
  regularOtHours: number
  restDayHours: number
  restDayOtHours: number
  specialDayHours: number
  specialDayOtHours: number
  regularHolidayHours: number
  regularHolidayOtHours: number
  nightDiffHours: number
  lateUndertimeMinutes: number
  unworkedRegularHolidays: number
}

export interface PayslipEarnings {
  basicPay: number
  overtimePay: number
  nightDiffPay: number
  restDayPay: number
  /** Premiums for worked holidays + 100% pay for unworked regular holidays (daily-rate). */
  holidayPay: number
  allowance: number
  commission: number
  bonus: number
  bonusTaxable: boolean
  incentive: number
  incentiveTaxable: boolean
  otherEarnings: PayslipLine[]
}

export interface PayslipDeductions {
  sss: number
  philhealth: number
  pagibig: number
  withholdingTax: number
  lateUndertime: number
  absences: number
  /** Cash advances, uniform, etc. `taxable` is ignored on deductions. */
  otherDeductions: PayslipLine[]
}

/** Snapshot of one employee's pay for one cutoff - embedded in a PayrollRun, never a
 * table of its own. Finalizing the run freezes these numbers for good. */
export interface Payslip {
  employeeId: ID
  employeeName: string
  role: string
  rateType: RateType
  baseRate: number
  days: PayslipDays
  earnings: PayslipEarnings
  deductions: PayslipDeductions
  grossPay: number
  taxableIncome: number
  totalDeductions: number
  netPay: number
  notes?: string
}

export type PayrollRunStatus = 'draft' | 'finalized'

export interface PayrollRun extends Base {
  periodStart: string
  periodEnd: string
  paySchedule: PaySchedule
  status: PayrollRunStatus
  payslips: Payslip[]
  notes?: string | null
}

export interface Truck extends Base {
  plateNumber: string
  capacityLiters: number
  assignedDriverId?: ID
  /**
   * Gross vehicle weight in kilograms. The Metro Manila truck ban applies
   * above 4,500 kg; a truck with this blank is treated as heavy until someone
   * fills it in, because a fuel tanker nearly always is and a missed warning
   * costs more than a spare one. See lib/numberCoding.ts.
   */
  gvwKg?: number
  /** Empty weight, kg, for the overloading check (lib/vehicleLimits.ts). */
  tareKg?: number
  /** Axle configuration code, which sets the legal gross weight. */
  axleConfig?: string
  /** A legal gross weight typed by hand, overriding the axle code's. */
  maxGvwKg?: number
  /** Tollway class 1-3; blank is read as 3 for a heavy truck. */
  tollClass?: 1 | 2 | 3
}

export type PurchaseStatus = 'ordered' | 'received'
export type PaymentMode = 'cash' | 'check' | 'bank_transfer'
/**
 * Where one payment has got to, from promised to actually in the bank.
 *
 * Exhibit A 1.6 asked for "pending, collected, bounced for post-dated checks,
 * or cancelled". That is the right list for cash, and one state short for a
 * check. A post-dated check passes through three separate custodies before it
 * is money: the collector holds it, the bank holds it, and only then is it
 * spendable - and it can still be refused at the last step. Collapsing those
 * into "collected" meant the collections figure counted paper that might never
 * become pesos, nothing showed what was sitting undeposited in a drawer, and a
 * bounce surfaced weeks after the collection it contradicted.
 *
 * So the chain is: pending (owed) → collected (in hand, with whoever collected
 * it) → deposited (lodged, waiting on the bank) → cleared (money). `bounced`
 * can follow deposited, and - for a check the bank never saw - collected.
 * `cleared` is the only state that settles the receivable.
 *
 * Cash and bank transfers skip the middle: received is cleared, in one step,
 * because there is no instrument to hold or present. Only checks walk the
 * whole chain.
 *
 * Overdue is deliberately absent from the list - it is computed from an
 * elapsed due date, never stored.
 */
export type CollectionStatus =
  | 'pending' | 'collected' | 'deposited' | 'cleared' | 'bounced' | 'cancelled'
/** Same three-state shape as CollectionStatus, just named for money going out instead of
 * coming in: pending → paid, or cancelled. */
export type PurchasePaymentStatus = 'pending' | 'paid' | 'cancelled'

/** One payment obligation against a sale - a sale can be split into several of these (an
 * installment plan) instead of one lump due date. "Overdue" isn't stored here - it's computed
 * from a pending installment whose dueDate has passed (see isInstallmentOverdue in metrics.ts).
 *
 * `amount` is the actual money due for this installment (principal + interest) - every screen
 * that cares about "how much is owed" (kanban cards, the cash-flow calendar, KPIs, tables) reads
 * just this field and doesn't need to know interest exists. `principal` and `interestPct` are the
 * breakdown the installment builder uses to compute it: principal is this installment's share of
 * the sale's actual invoice value (principals across a plan sum to volumeLiters × pricePerLiter),
 * and interestPct is an optional financing charge on top of that share. No interest means
 * principal === amount and interestPct === 0. */
export interface SaleInstallment {
  id: ID
  amount: number
  principal: number
  interestPct: number
  dueDate: string
  status: CollectionStatus
  /** Person in charge of collecting this installment (Personnel id). Overrides the sale's
   * `collectorId`; blank falls back to it - resolve via installmentCollector() in metrics.ts. */
  collectorId?: ID
  /** Receiving bank account override for this installment; blank falls back to the sale's
   * `bankAccountId` - resolve via installmentBankAccount() in metrics.ts. */
  bankAccountId?: ID
  /**
   * ISO timestamp set when the payment came into the collector's hands.
   *
   * This is the collector's date: their job ends here, so the on-time rate is
   * judged on it. It is NOT when the money arrived in the bank - see
   * `clearedAt` for that. Falls back to dueDate for records written before the
   * two were told apart.
   */
  collectedAt?: string
  /**
   * The date written on a post-dated check - when it may be presented.
   *
   * The answer to "due for collection or due for depositing?": they are two
   * different dates and the record only ever held the first. The collection
   * due date says when the customer must hand something over; this says when
   * that something becomes bankable, which can be weeks later. The treasury's
   * deposit queue is ordered by it.
   */
  checkDate?: string
  /** ISO timestamp Treasury lodged this with the bank. */
  depositedAt?: string
  /** Seat that recorded the deposit - deliberately not the collector's, which
   *  is the whole point of Treasury being a separate permission. */
  depositedBy?: ID
  /** The bank's deposit slip number, as printed on the slip. Distinct from
   *  `referenceNo`, which is the customer's check number. */
  depositSlipNo?: string
  /** ISO timestamp the funds actually became available. The receivable is
   *  settled here and nowhere earlier; "collected this period" counts on it. */
  clearedAt?: string
  /** Seat that confirmed clearing. */
  clearedBy?: ID
  /** Reference number of the deposit slip or check (Exhibit A 1.3, 1.6). For a
   * post-dated check this is the check number; for a bank transfer, the deposit
   * slip reference. The scanned copy is an attachment on the sale. */
  referenceNo?: string
  /** Reason the collection was late, bounced, or never made (Exhibit A 1.6
   * "notes recording reasons for late collection or non-collection"). */
  notes?: string
  /** Allocated from the CF series when a collection form is printed for this
   * installment (Exhibit A 1.6). */
  collectionFormNo?: string
}

/** Same idea, for money owed to a supplier. */
export interface PurchaseInstallment {
  id: ID
  amount: number
  principal: number
  interestPct: number
  dueDate: string
  status: PurchasePaymentStatus
  /** Check number or deposit-slip reference, as on the sales side. */
  referenceNo?: string
  /** Why it was paid late, or not at all. */
  notes?: string
  /** ISO timestamp Treasury released the money. */
  paidAt?: string
  /** Seat that paid it. Money out is the same custody question as money in:
   *  worth knowing whose hands it left by. */
  paidBy?: ID
  /** Account the payment went out of. */
  bankAccountId?: ID
  /** Name of the seat that paid it, kept on the record the way a trip's
   *  stamps keep theirs, so the history reads without a seats lookup that
   *  a treasurer may not be allowed to make. */
  paidByName?: string
  /** How it went out: a check, a transfer, cash. The purchase carries the
   *  agreed mode; this is what was actually used for this installment. */
  paymentMode?: PaymentMode
}

export interface Purchase extends Base {
  supplierId: ID
  date: string
  pricePerLiter: number
  /** Volume ordered. */
  volumeLiters: number
  /** 'hauler': a third party trucks it in, recorded in `hauler`. */
  fulfillment: 'pickup' | 'delivered' | 'hauler'
  address?: string
  /** The third-party hauler, when fulfillment is 'hauler'. Typed per purchase;
   * there is no haulers master list. */
  hauler?: PurchaseHauler
  warehouseId: ID
  status: PurchaseStatus
  paymentMode: PaymentMode
  bankAccountId?: ID
  /** Sums to volumeLiters × pricePerLiter. At least one entry - a single-installment
   * purchase is just the plain-old "pay it all by this date" case. */
  installments: PurchaseInstallment[]

  /** Volume actually received (Exhibit A 1.2 "volume received per transaction").
   * Blank until receipt; a short or over delivery is the case where this differs
   * from volumeLiters. Stock on hand counts this when set, volumeLiters otherwise. */
  volumeReceived?: number
  /**
   * When the load actually arrived - Exhibit A 1.2 asks for volume in "within a
   * date interval", and the interval a tanker belongs to is the one it landed
   * in, not the one it was ordered in.
   *
   * Optional, and every reader falls back to `date`. Purchases received before
   * this field existed have no arrival stamp, and inventing one would be worse
   * than admitting the order date is the best we know for them.
   */
  receivedAt?: string
  /** Reference number of the purchase order issued to the supplier (Exhibit A 1.2).
   * Allocate one with POST /api/refs/PO; the digital copy is an attachment in the
   * 'supplierPo' slot. */
  poReferenceNo?: string
  /** Which product this purchase brought in - blank means the default product.
   * See the Product comment below. */
  productId?: ID
  /** The product's name when productId is OTHER_PRODUCT_ID - "Kerosene", say. */
  productLabel?: string
}

/**
 * A third-party hauler kept on file, so the purchase form fills itself in
 * from a pick rather than the same name, number and fee typed on every load.
 * Managed under Admin & settings; a purchase still carries its own copy of
 * the details (PurchaseHauler), so editing the hauler later does not rewrite
 * history.
 */
export interface Hauler extends Base {
  name: string
  contactPerson?: string
  contactNumber?: string
  address?: string
  /** What they usually charge for a run - the form's starting fee. */
  defaultFee?: number
  paymentMode?: PaymentMode
  notes?: string
}

export interface PurchaseHauler {
  /** The saved hauler this was filled from, when it was. */
  haulerId?: ID
  name: string
  contact?: string
  /** When the hauler picks up from the supplier. */
  date?: string
  /** What the hauler charges for the run. */
  fee: number
  paymentMode: PaymentMode
  status: 'unpaid' | 'paid'
}

export type SaleStatus = 'draft' | 'confirmed' | 'fulfilled' | 'cancelled' | 'returned'

/** Statuses that consume stock. A cancelled or returned order does not - which is
 * why every stock and revenue selector filters on this set rather than on
 * `status !== 'draft'`. */
export const CONSUMING_SALE_STATUSES: readonly SaleStatus[] = ['confirmed', 'fulfilled'] as const

/**
 * How the money on a cancelled or returned order is settled (Exhibit A 1.3
 * "with reason and treatment").
 *
 * This is the money side only. Whether the fuel physically came back into the
 * depot is `OrderResolution.backToStock`, a separate question: a rejected load
 * can be refunded AND come back, or be refunded and be lost. Net sales are the
 * same either way - an order that was returned comes off sales in full,
 * whatever was done about the money - which is the accounting the client
 * follows: net sales = sales less returns and allowances.
 *
 * `restocked` and `written_off` are legacy values from when this field carried
 * both questions. They are still read (a stored `restocked` means the fuel came
 * back) but no longer offered.
 */
export type OrderTreatment =
  | 'refunded'         // money already collected goes back to the customer
  | 'credit_note'      // held as credit against future orders
  | 'replaced'         // re-delivered under a new order
  | 'no_action'        // nothing collected yet - the receivable is simply cancelled
  | 'restocked'        // legacy: fuel came back (now backToStock)
  | 'written_off'      // legacy: fuel lost, nothing recovered

export interface OrderResolution {
  /** ISO date the cancellation or return was recorded. */
  date: string
  reason: string
  treatment: OrderTreatment
  /** For a return: did the fuel come back into the depot, sellable again?
   * Drives stock on hand and nothing else - net sales are netted regardless.
   * Blank on a legacy record: read `treatment === 'restocked'` instead. */
  backToStock?: boolean
  /** The status the order held before it was cancelled or returned. Recorded so
   * "Revert" can put it back where it was - without this the System would have
   * to guess between draft, confirmed and fulfilled, and a mis-click would be
   * unrecoverable. */
  previousStatus?: SaleStatus
  /** Volume returned, for a partial return. Blank = the whole order. This is
   * the volume that comes off net sales; whether it also re-enters stock is
   * `backToStock`. */
  volumeReturned?: number
  recordedBy?: ID
  notes?: string
}

export interface Sale extends Base {
  agentId: ID
  customerId: ID
  date: string
  pricePerLiter: number
  volumeLiters: number
  warehouseId: ID
  fulfillment: 'pickup' | 'delivery'
  scheduleDate?: string
  paymentMode: PaymentMode
  bankAccountId?: ID
  /** Default person in charge of collecting this sale's installments (Personnel id).
   * Individual installments may override via their own `collectorId`. */
  collectorId?: ID
  /** Sums to volumeLiters × pricePerLiter. At least one entry - a single-installment
   * sale is just the plain-old "collect it all by this date" case. */
  installments: SaleInstallment[]
  status: SaleStatus

  /** Requested time of day for the pickup or delivery, "HH:mm" (Exhibit A 1.3
   * "requested pickup or delivery schedule with date and time"). Pairs with
   * scheduleDate; blank means no particular time was requested. */
  scheduleTime?: string
  /** Reference number of the purchase order received from the client (Exhibit A 1.3).
   * Supplied by the client - not allocated from a System series. The digital copy is
   * an attachment in the 'clientPo' slot. */
  clientPoReferenceNo?: string
  /** Set when status is 'cancelled' or 'returned' (Exhibit A 1.3). */
  resolution?: OrderResolution
  productId?: ID
  /** The product's name when productId is OTHER_PRODUCT_ID - "Kerosene", say.
   *  Mirrors the same field on Purchase; without it a sale of a one-off
   *  product had nowhere to keep its name, and the movement detail that reads
   *  it showed the default product for everything. */
  productLabel?: string
  /** The company's own sales invoice number for this order, once issued. */
  invoiceNo?: string
  /** Credit terms in days: 0 is cash or COD, blank means the customer's
   *  standing term applied. What the collection plan's due dates follow. */
  termDays?: number
  /** Where and to whom the fuel goes, copied from the customer when the
   *  sale is booked so a later change to the customer's card does not
   *  rewrite an order already agreed. The delivery is built from these. */
  contactPerson?: string
  contactNumber?: string
  deliveryAddress?: string
}

export type DeliveryStatus = 'scheduled' | 'loading' | 'in_transit' | 'delivered' | 'failed'

/** The four movements Exhibit A 1.5 distinguishes, each with its own document
 * set. The app originally modelled only `delivery_to_client`, so this defaults
 * to that where absent. */
export type MovementType =
  | 'delivery_to_client'
  | 'pickup_from_client'
  | 'pickup_from_depot'
  | 'delivery_from_depot'

/** Documents required per movement type (Exhibit A 1.5 "Documents, by movement
 * type"). These are attachment slot names - see SLOTS in app/server/attachments.ts.
 * Every movement also carries a pre-dispatch checklist except pickups from a
 * client, where MPower is not dispatching a loaded vehicle. */
export const MOVEMENT_DOCUMENTS: Record<MovementType, readonly string[]> = {
  delivery_to_client: ['preDispatchChecklist', 'deliveryReceipt'],
  pickup_from_client: ['clientLoadingSlip', 'signedReceipt'],
  pickup_from_depot: ['depotLoadingSlip', 'supplierReceipt', 'preDispatchChecklist'],
  delivery_from_depot: ['internalReceipt', 'supplierDeliveryReceipt'],
} as const

/**
 * Pre-dispatch checklist (Exhibit A 1.5).
 *
 * Exhibit A is explicit that these are *manual* entries: "The System does not
 * read device status directly. Live device integration is (D)." So `gpsPresent`,
 * `fuelSensorPresent` and `smartLockPresent` are booleans an operator ticks after
 * looking at the vehicle - they are not, and must not become, device reads.
 */
export interface PreDispatchChecklist {
  /** Filled in at dispatch; the crew ids duplicate the movement's assignment so
   * the printed slip stands on its own as a signed document. */
  driverId?: ID
  pahinanteId?: ID
  loaderId?: ID
  guardId?: ID
  managerId?: ID
  allowanceIssued?: number
  // Vehicle - BLOWBAGETS, the LTO's pre-trip inspection mnemonic.
  batteryChecked?: boolean
  lightsChecked?: boolean
  oilChecked?: boolean
  waterChecked?: boolean
  brakesChecked?: boolean
  airChecked?: boolean
  /** Gas: the truck's own fuel. `fullTankConfirmed` is the older name for the same tick. */
  fullTankConfirmed: boolean
  engineInspected: boolean
  tiresInspected: boolean
  /** Self: the driver is fit to drive. */
  driverFit?: boolean
  partsInspected: boolean
  // Devices
  gpsPresent: boolean
  fuelSensorPresent: boolean
  smartLockPresent: boolean
  bodyCamPresent: boolean
  // Documents and cash
  identificationVerified: boolean
  driverLicenseChecked?: boolean
  receiptOnBoard?: boolean
  tollCardsOnBoard?: boolean
  allowanceHanded?: boolean
  // Load
  loadConfirmed: boolean
  /** The crew signing the slip on screen. Keyed by role. */
  signatures?: Partial<Record<'driver' | 'pahinante' | 'dispatcher', ChecklistSignature>>
  completedBy?: ID
  completedAt?: string
  notes?: string
  /** Allocated from the PDC series when the checklist is printed. */
  referenceNo?: string
}

/** A signature drawn on screen: a small PNG data URL, who drew it, and when. */
export interface ChecklistSignature {
  name: string
  image: string
  at: string
}

/** A reference number staff typed in, paired with the attachment holding its
 * scanned copy. `attachmentId` is filled once a file is uploaded to the slot. */
export interface DocumentRef {
  referenceNo?: string
  attachmentId?: ID
}

/** Why a movement was late or never completed (Exhibit A 1.5 "notes recording
 * reasons for delay or non-completion"). */
export interface DeliveryOutcome {
  /** Set when the movement reaches 'delivered'. On-time % compares this against
   * the final schedule. */
  completedAt?: string
  delayReason?: string
  failureReason?: string
  notes?: string
}

/**
 * The four stages a trip passes through, in handoff order.
 *
 * These are not new states - they are the existing DeliveryStatus values read
 * as work rather than as position: 'scheduled' is a trip still being planned,
 * 'loading' one being handed to the crew, 'in_transit' one waiting on a signed
 * receipt, 'delivered'/'failed' one being closed out. Naming them lets the trip
 * form show whose turn it is.
 */
export type TripStage = 'plan' | 'dispatch' | 'delivery' | 'close'

/**
 * Who recorded a stage, and when.
 *
 * `byName` is stored beside the id so history survives a deleted seat - the
 * same choice the audit log and the approvals table make.
 *
 * `onBehalfOf` is the crew member whose signature the paper carries. Crew are
 * Personnel, not Seats: a driver cannot sign in, so today an office seat
 * records what the crew signed for on the printed slip. Recording both means
 * the trip can answer "who did this" and "who entered it" separately, and if
 * crew are ever given seats of their own, `by` becomes the crew member and this
 * field stops being written rather than the model having to change.
 */
export interface TravelEstimate {
  /** One-way drive from the depot, in minutes, for the route chosen. */
  minutesOneWay: number
  km: number
  provider: 'google' | 'osrm'
  from: string
  to: string
  at: string
  /** The road the chosen route mostly follows - "via SLEX". */
  summary?: string
  /** Which of the offered routes was picked, 0 = fastest. */
  routeIndex?: number
  /** Minutes allowed at the customer to unload, as set in the planner. */
  unloadMinutes?: number
  /** The named places the route goes through (lib/zones.ts), so the city
   *  bans and tollway limits can be checked against it. */
  zones?: string[]
}

/** A point on the map, picked or geocoded. */
export interface GeoPoint {
  lat: number
  lng: number
}

export interface StageStamp {
  by?: ID
  byName?: string
  at: string
  onBehalfOf?: ID
}

export interface Delivery extends Base {
  /** Blank for movements that don't originate in a sale - a pickup from a depot
   * belongs to a Purchase instead (see purchaseId). */
  saleId: ID
  scheduleDate: string
  truckId?: ID
  driverId?: ID
  pahinanteId?: ID
  loaderId?: ID
  guardId?: ID
  deliveryAddress: string
  contactPerson: string
  contactNumber: string
  status: DeliveryStatus

  // ---- Logistics module extensions (Exhibit A 1.5) --------------------------

  /** Which of the four movements this is. Absent = 'delivery_to_client'. */
  movementType?: MovementType
  /** For depot movements, the purchase this collects or receives. */
  purchaseId?: ID
  /** The customer's requested schedule, copied from the Sale - kept separate from
   * `scheduleDate`, which Logistics reorganises into the final schedule
   * (Exhibit A 1.5 "a reorganised final schedule"). */
  requestedDate?: string
  requestedTime?: string
  /** Time of day on the final schedule, "HH:mm". */
  scheduleTime?: string
  /** How long the truck is taken up by this trip, in hours - out, unload and
   * back. Blank means the fleet default (TRIP_BLOCK_HOURS). Drives the
   * By-truck board, the clash check and the day strip. */
  durationHours?: number
  /** A drive-time estimate fetched for the delivery address, kept so the
   * figure the duration was set from is on the record, not just in someone's
   * head. */
  travelEstimate?: TravelEstimate
  /** Where the address is on the map, once someone has placed it - by
   * geocoding or by dropping the pin. Reused by the next estimate, and the
   * more exact answer when the address text is vague. */
  destination?: GeoPoint
  managerId?: ID
  /** ETA entered and maintained by Logistics staff (Exhibit A 1.1). The
   * automatically computed ETA from live vehicle position is (D) and depends on
   * Secondary Feature 2.8 - when that lands it populates a separate field rather
   * than overwriting what staff typed. */
  etaAt?: string
  checklist?: PreDispatchChecklist
  /** Who recorded each stage, and when. Written by the stage actions, not by a
   *  plain save - see advanceTrip in lib/tripStages.ts. */
  stamps?: Partial<Record<TripStage, StageStamp>>
  /** The person at the far end who signed for the load. The reference number
   *  and the scan live with the document slot; these are what the slot cannot
   *  say. `receivedOn` is a date, not the trip's completion timestamp - a
   *  receipt can reach the office days after the truck did. */
  receivedBy?: string
  receivedOn?: string
  /** Reference numbers by document slot, e.g. { deliveryReceipt: { referenceNo: 'DR-2026-00041' } }. */
  documents?: Record<string, DocumentRef>
  outcome?: DeliveryOutcome
}

// ---- Vehicles and availability (Exhibit A 1.5) -------------------------------

export type MaintenanceKind = 'preventive' | 'repair' | 'inspection' | 'registration'
export type MaintenanceStatus = 'scheduled' | 'in_progress' | 'done' | 'cancelled'

/** A window in which a vehicle is unavailable, and why (Exhibit A 1.5 "vehicle
 * maintenance schedule"). Vehicle availability is derived: a truck is free in a
 * period if it has no movement and no maintenance overlapping it. */
export interface VehicleMaintenance extends Base {
  truckId: ID
  kind: MaintenanceKind
  status: MaintenanceStatus
  scheduledDate: string
  /** Blank for a single-day job. */
  endDate?: string
  odometerKm?: number
  cost?: number
  vendor?: string
  notes?: string
}

/** Vehicle colour coding and truck ban notice (Exhibit A 1.5), maintained by the
 * Client as a configurable reference table.
 *
 * Any automated feed of LGU or MMDA truck ban data is (D) - this table is the
 * manual baseline the Client keeps current. The rules to seed it with are an open
 * question (see Q12 in the gap analysis), so the table ships empty.
 */
export interface TruckBanRule extends Base {
  /**
   * Set on the rules the app generates from the regulations it knows
   * (lib/numberCoding.ts) rather than ones an administrator typed. Never
   * stored: built-in rules are computed on the way in, and the only thing
   * saved about them is whether each preset is switched on (appSettings).
   */
  builtin?: string
  /** 'heavy' limits the rule to trucks over the truck-ban weight, 'light' to
   *  those at or under it; blank or 'all' applies it to every truck. */
  appliesTo?: 'all' | 'heavy' | 'light'
  /** Number coding is lifted on holidays; a truck ban is not. */
  suspendedOnHolidays?: boolean
  /** A zone key (lib/zones.ts) the rule is confined to: it applies only to
   *  a trip whose planned route goes through it. */
  zone?: string
  /** Which local government unit or authority the rule comes from, e.g. 'MMDA'. */
  authority: string
  area: string
  /** Weekday numbers 0 (Sun) – 6 (Sat) the rule applies on. */
  weekdays: number[]
  /** "HH:mm" window the ban is in force. */
  startTime: string
  endTime: string
  /** Last plate digits coded on these days, for colour coding. Empty = applies to
   * all plates (a blanket truck ban rather than number coding). */
  plateEndsWith: string[]
  active: boolean
  notes?: string
}

export interface Setting {
  key: string
  value: string
}

/**
 * One piece of system configuration that is not a business record, stored in
 * the admin-only `appSettings` table as a keyed document. Number coding
 * presets live here under key 'numberCoding' (lib/numberCoding.ts).
 */
export interface AppSetting extends Base {
  key: string
  value: unknown
}

// ---- Product catalog ---------------------------------------------------------
//
// The System was built single-product (diesel, measured in liters). Secondary
// Feature 2.3 asks for "a configurable stock threshold per product and warehouse",
// which implies more than one. Whether MPower actually carries multiple products
// is an open question (Q7 in the gap analysis), so this is additive: every
// transaction's `productId` is optional and blank means DEFAULT_PRODUCT_ID. If the
// answer is "diesel only", nothing needs to change; if it is "several grades", the
// catalog is already here.

export const DEFAULT_PRODUCT_ID = 'product-diesel'
/** Built-in products beside diesel, offered on every form without catalogue setup. */
export const GASOLINE_PRODUCT_ID = 'product-gasoline'
export const LPG_PRODUCT_ID = 'product-lpg'
/** "Other": the record carries its own `productLabel`. */
export const OTHER_PRODUCT_ID = 'product-other'

export interface Product extends Base {
  name: string
  /** Unit records are measured in. Everything today is liters. */
  unit: 'liter'
  active: boolean
  notes?: string
}

/** Low supply warning (Secondary Feature 2.3) - one threshold per product and
 * warehouse. Stock crossing below `thresholdLiters` raises a `low_stock`
 * notification through the shared channel (2.11). */
export interface StockThreshold extends Base {
  warehouseId: ID
  /** Blank = the default product. */
  productId?: ID
  thresholdLiters: number
  /** Turn the warning off without losing the configured level. */
  active: boolean
  /** Set when the warning last fired, so it alerts on the crossing rather than
   * on every poll while stock sits below the line. */
  lastAlertedAt?: string
}

// ---- Dashboard (Exhibit A 1.1) ----------------------------------------------

/** Per-user to-do list (Exhibit A 1.1). Kept deliberately thin - a note, a due
 * date, and an optional link to the record it is about. */
export interface Todo extends Base {
  /** Whose list it is on. */
  seatId: ID
  /**
   * Set by the server when an administrator or approver put this on somebody
   * else's list. The assigner can still see and remove it; nobody else can.
   */
  assignedById?: ID
  assignedByName?: string
  text: string
  done: boolean
  dueDate?: string
  /** Deep link to the record this is about, e.g. { tbl: 'sales', id: 'abc' }. */
  tbl?: string
  recordId?: ID
}

/** Widgets the dashboard can show. Per-role configuration (Exhibit A 1.1: "Sales,
 * Logistics, employee, and managerial views may differ") picks a subset and an
 * order from this list. */
export type DashboardWidget =
  | 'kpis'
  | 'needsAttention'
  | 'volumeSold'
  | 'stockByWarehouse'
  | 'boughtVsSold'
  | 'agentQuota'
  | 'recentTransactions'
  | 'todos'
  | 'incoming'
  | 'receivables'
  | 'deliveryBoard'
  | 'announcements'
  | 'approvals'
// 'lowStock' was retired: the Depots card now marks a short depot on its own
// row, and the shortfall is spelled out again in Needs attention. 'truckEta'
// was retired the same way - Movements shows every open delivery and prints
// the ETA on the in-transit ones, so the separate card listed a subset of the
// card beside it. A stored config still naming either is dropped by
// resolveWidgets, which has always filtered unknown keys for exactly this
// case.

/** One role's dashboard layout. Keyed by the seat's free-text `role` label so an
 * administrator can configure a view without a code change. A seat with no
 * matching config falls back to DEFAULT_DASHBOARD_WIDGETS. */
export interface DashboardConfig extends Base {
  role: string
  widgets: DashboardWidget[]
  /**
   * Every widget that existed when this config was last saved.
   *
   * Without it a config is ambiguous: a widget it does not name might have
   * been deliberately unticked, or might simply not have existed yet, and
   * those two cases want opposite treatment. Recording the full set at save
   * time makes an omission mean something. Absent on configs written before
   * this field, which fall back to WIDGETS_BEFORE_HOME_RESTRUCTURE.
   */
  knownWidgets?: DashboardWidget[]
}

/**
 * The widget set as it stood before Home was restructured.
 *
 * The fallback for a config with no `knownWidgets`. Everything here was
 * offerable then, so a config omitting one of these really did decline it;
 * anything outside this list came later and no config can have declined it.
 * This is a fixed historical record - never add to it.
 */
export const WIDGETS_BEFORE_HOME_RESTRUCTURE: readonly string[] = [
  'kpis', 'stockByWarehouse', 'agentQuota', 'recentTransactions', 'todos',
  'truckEta', 'cashFlow', 'receivables', 'deliveryBoard', 'announcements',
  'lowStock', 'approvals',
]

export const DEFAULT_DASHBOARD_WIDGETS: DashboardWidget[] = [
  // Order is the packing order: the band and Needs attention are full width,
  // then the two half-width blocks pair into one row. Putting a lone half
  // between two full blocks would stretch it across the page.
  'kpis', 'needsAttention', 'volumeSold', 'announcements',
  'stockByWarehouse', 'incoming', 'deliveryBoard', 'boughtVsSold',
  'agentQuota', 'todos', 'recentTransactions',
]

/**
 * One seat's own arrangement of its dashboard.
 *
 * This is a preference sitting on top of the role configuration, and it may only
 * ever REORDER. It cannot add a widget: the order is filtered through
 * `resolveWidgets` before use, so a layout naming something the seat's modules
 * do not permit simply drops it. Access control stays the gate; this is taste.
 */
export interface DashboardLayout extends Base {
  seatId: ID
  widgets: DashboardWidget[]
}

// ---- Announcements and pricing (Secondary Features 2.4, 2.5, 2.10) ----------

/** Announcement board (Secondary Feature 2.4). Posting one emits an
 * `announcement` notification through the shared channel (2.11). */
export interface Announcement extends Base {
  title: string
  body: string
  postedBy: ID
  postedByName: string
  /** Blank = everyone; otherwise only seats with one of these modules see it. */
  audienceModules?: ModuleKey[]
  pinned: boolean
  /** Blank = never expires. */
  expiresAt?: string
}

/** Daily price posting (Secondary Feature 2.5) - MPower's own internal diesel
 * reference price for the day, distinct from a SupplierQuote, which is a price a
 * supplier offered. Secondary Feature 2.10's rolling average is computed from
 * these (see movingAverage() in src/lib/pricing.ts). */
export interface PricePosting extends Base {
  date: string
  pricePerLiter: number
  productId?: ID
  postedBy: ID
  notes?: string
}

// ---- HR (Exhibit A 1.7) ------------------------------------------------------

export type DrugTestResult = 'pending' | 'negative' | 'positive' | 'inconclusive'

/** Annual drug test schedule and results (Exhibit A 1.7). */
export interface DrugTest extends Base {
  employeeId: ID
  /** When the test is booked for. */
  scheduledDate: string
  /** When it was actually taken; blank while still scheduled. */
  takenDate?: string | null
  result: DrugTestResult
  provider?: string | null
  notes?: string | null
}

/** The screens a seat can be granted. Mirrors the nav rail one-to-one. */
/**
 * One entry per screen in the nav rail, and per checkbox on a seat.
 *
 * `treasury` (Treasury) is deliberately its own key rather than a page
 * inside `collection`. Receiving money and banking it are the two halves of
 * the oldest control in bookkeeping: if one person does both, covering a theft
 * with the next customer's payment leaves no trace. Separate keys are what let
 * a seat hold one without the other; a page inside Collect would have shared
 * its permission and made the separation cosmetic.
 */
export type ModuleKey = 'dashboard' | 'inventory' | 'sales' | 'collection' | 'treasury' | 'accounts' | 'logistics' | 'hr' | 'settings'

/** A login seat - a person who can sign into the app. Admin seats can manage other
 * seats and see every module; everyone else sees only the modules ticked for them.
 * Password material (hash + salt) lives only on the server and never reaches the client;
 * seat writes may carry a plaintext `password` field, which the server hashes. */
export interface Seat extends Base {
  name: string
  username: string
  /** Display label like "Owner", "Encoder" - free text, carries no behavior. */
  role: string
  isAdmin: boolean
  /** Module views this seat can open. Ignored for admins (they see everything). */
  modules: ModuleKey[]
  /** May decide on pending inputs (Secondary Feature 2.1). Admins always may;
   * this grants it to a non-admin seat - a branch manager who approves but does
   * not administer the System. A seat with this right still cannot approve its
   * own submission unless it is also an admin. */
  canApprove?: boolean
  /** Staff writes from this seat are posted directly rather than parked for
   * approval. Escape hatch for a trusted encoder; blank means the table's own
   * approval rule applies. */
  bypassApproval?: boolean

  /**
   * The employee this login is.
   *
   * Office seats leave it blank - they act for the business rather than as one
   * person. A field seat must carry it: it is how a trip knows the pahinante
   * opening it is crewed on it, how a sale knows which agent sold it, and how a
   * stage stamp records the person and not just the account.
   */
  personnelId?: ID

  /**
   * How much of their module this seat sees.
   *
   * 'all' (or blank) is the office: the whole business, as before. 'own' is a
   * field seat - their trips, their sales, their collections - enforced on the
   * server, not merely defaulted in the UI. See server/scope.ts.
   */
  scope?: 'own' | 'all'

  /**
   * The Agent record a sales seat sells under - resolved by the server from the
   * employee's row when the session loads, never stored on the seat.
   *
   * The client cannot read it from `personnel` itself: `Personnel.agentId` is
   * an HR field, stripped from the employee row for any seat without HR access.
   */
  agentId?: ID
}
