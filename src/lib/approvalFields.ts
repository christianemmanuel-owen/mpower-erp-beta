import type { TableName } from './data'

/**
 * How to render a parked payload as something an approver can actually read.
 *
 * This is deliberately a set of rules rather than a schema per table. The
 * tables that need approval are configurable - an admin ticks Trips or
 * Suppliers on whenever they like - so a hand-written field list per table
 * would be a thing to forget to update, and the drawer would silently show
 * `pahinanteId` for whichever table nobody remembered. The rules below degrade
 * to a prettified key, which is always better than nothing and never wrong.
 */

/** Never shown: bookkeeping the approver did not write and cannot usefully change. */
const HIDDEN = new Set([
  'id', 'createdAt', 'updatedAt', 'createdBy', 'updatedBy', 'passwordHash', 'salt',
])

/** Labels worth saying properly. Anything absent is prettified from its key. */
const LABELS: Record<string, string> = {
  volumeLiters: 'Volume',
  volumeReceivedLiters: 'Volume received',
  pricePerLiter: 'Price per litre',
  warehouseId: 'Depot',
  supplierId: 'Supplier',
  customerId: 'Customer',
  agentId: 'Sales agent',
  collectorId: 'Collector',
  driverId: 'Driver',
  truckId: 'Truck',
  productId: 'Product',
  bankAccountId: 'Bank account',
  paymentMode: 'Payment mode',
  fulfillment: 'Fulfillment',
  deliveryAddress: 'Delivery address',
  scheduleDate: 'Scheduled for',
  referenceNo: 'Reference no.',
  plateNumber: 'Plate number',
}

/** Which table an id field points at, so it can be shown as a name. */
const REFERENCES: Record<string, TableName> = {
  warehouseId: 'warehouses',
  supplierId: 'suppliers',
  customerId: 'customers',
  agentId: 'personnel',
  collectorId: 'personnel',
  driverId: 'personnel',
  loaderId: 'personnel',
  pahinanteId: 'personnel',
  guardId: 'personnel',
  managerId: 'personnel',
  employeeId: 'personnel',
  truckId: 'trucks',
  productId: 'products',
  bankAccountId: 'bankAccounts',
}

/**
 * Closed sets of values, so an approver picks rather than types.
 *
 * These rendered as free text before, which meant the drawer would happily let
 * someone set a sale's status to "draf" and hand it to a server that answers
 * 422. Keyed by table where the same field name means different things -
 * a purchase is fulfilled by `delivered`, a sale by `delivery`.
 *
 * The status lists mirror server/validate.ts. If they drift the server still
 * refuses the bad value, so the failure is a rejected save rather than a bad
 * write - but they should not drift.
 */
const ENUMS: Record<string, readonly string[]> = {
  'sales.status': ['draft', 'confirmed', 'fulfilled', 'cancelled', 'returned'],
  'purchases.status': ['ordered', 'received'],
  'deliveries.status': ['scheduled', 'loading', 'in_transit', 'delivered', 'failed'],
  'sales.fulfillment': ['pickup', 'delivery'],
  'purchases.fulfillment': ['pickup', 'delivered'],
  '*.paymentMode': ['cash', 'check', 'bank_transfer'],
  '*.status': ['pending', 'collected', 'bounced', 'cancelled'],
}

/** The options for a field, or null when it is not a closed set. */
export function enumFor(tbl: string, key: string): readonly string[] | null {
  return ENUMS[`${tbl}.${key}`] ?? ENUMS[`*.${key}`] ?? null
}

/**
 * Which step a field belongs on.
 *
 * Same shape as the labels, and for the same reason: the approvable tables are
 * configurable, so anything unmapped has to land somewhere sensible rather than
 * disappear. That somewhere is Details.
 */
const GROUPS: Record<string, string> = {
  customerId: 'Parties', supplierId: 'Parties', agentId: 'Parties',
  collectorId: 'Parties', driverId: 'Parties', truckId: 'Parties',
  date: 'Order', volumeLiters: 'Order', volumeReceived: 'Order',
  pricePerLiter: 'Order', productId: 'Order', warehouseId: 'Order',
  status: 'Order', clientPoReferenceNo: 'Order', referenceNo: 'Order',
  scheduleDate: 'Schedule', scheduleTime: 'Schedule', fulfillment: 'Schedule',
  deliveryAddress: 'Schedule', address: 'Schedule',
  paymentMode: 'Payment', bankAccountId: 'Payment', installments: 'Payment',
  creditTermDays: 'Payment',
}

export const GROUP_ORDER = ['Parties', 'Order', 'Schedule', 'Payment', 'Details'] as const

export const groupFor = (key: string) => GROUPS[key] ?? 'Details'

/**
 * What one record of a table is called, and what was done to it.
 *
 * The dialog used to be titled with the server's summary - "New sale - 4,000 L
 * @ P50.53/L" - which is three facts in a heading. The heading says what kind
 * of thing this is; the figures belong under it, and who sent it belongs beside
 * it.
 */
const SINGULAR: Record<string, string> = {
  purchases: 'purchase',
  sales: 'sale',
  deliveries: 'trip',
  customers: 'customer',
  suppliers: 'supplier',
  personnel: 'employee',
  trucks: 'truck',
  supplierQuotes: 'price quote',
  payrollRuns: 'payroll run',
}

const VERB: Record<string, string> = {
  create: 'New',
  update: 'Change to',
  delete: 'Deletion of',
}

/** "New sale", "Change to trip" - the heading, with no figures in it. */
export function submissionTitle(action: string, tbl: string): string {
  const kind = SINGULAR[tbl] ?? tbl.replace(/s$/, '')
  return `${VERB[action] ?? 'Change to'} ${kind}`
}

/**
 * Whose desk a submission came from, named the way the nav rail names it.
 *
 * The queue used to print the raw table - `sales`, `supplierQuotes` - which
 * says what the row is stored as rather than who sent it.
 */
const DEPARTMENTS: Record<string, string> = {
  sales: 'Sales',
  purchases: 'Stock',
  deliveries: 'Trips',
  trucks: 'Trips',
  customers: 'Accounts',
  suppliers: 'Accounts',
  supplierQuotes: 'Accounts',
  personnel: 'HR',
  payrollRuns: 'HR',
}

export const departmentFor = (tbl: string) => DEPARTMENTS[tbl] ?? prettify(tbl)

/** camelCase -> "Camel case", for every key not named above. */
export function prettify(key: string): string {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ')
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase()
}

export const labelFor = (key: string) => LABELS[key] ?? prettify(key)
export const referenceFor = (key: string): TableName | null => REFERENCES[key] ?? null

export type FieldKind = 'reference' | 'number' | 'boolean' | 'date' | 'text' | 'complex'

/** What kind of control the value wants. Inferred from the value, because the
 * payload is the only description of itself that exists. */
export function kindFor(key: string, value: unknown): FieldKind {
  if (REFERENCES[key]) return 'reference'
  if (typeof value === 'boolean') return 'boolean'
  if (typeof value === 'number') return 'number'
  if (value !== null && typeof value === 'object') return 'complex'
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return 'date'
  return 'text'
}

/** The payload's fields, in a stable order, with the bookkeeping dropped.
 * Scalars first: a nested installment table between two text inputs makes the
 * simple fields hard to find. */
export function fieldsOf(payload: Record<string, unknown>): string[] {
  const keys = Object.keys(payload).filter((k) => !HIDDEN.has(k))
  const weight = (k: string) => (kindFor(k, payload[k]) === 'complex' ? 1 : 0)
  return keys.sort((a, b) => weight(a) - weight(b))
}

/** The human name of a referenced record, falling back to the raw id so a
 * dangling reference is visible rather than blank. */
export function nameOf(row: Record<string, unknown> | undefined, id: unknown): string {
  if (!row) return typeof id === 'string' && id ? id : '—'
  // A bank account has no single name field - it is the bank plus the masked
  // number, the way the Sale form writes it. Without this the payment account
  // picker listed raw ids.
  if (row.bankName) return `${row.bankName as string} ${(row.accountNumberMasked as string) ?? ''}`.trim()
  return (
    (row.company as string) ?? (row.name as string) ?? (row.plateNumber as string) ??
    (row.label as string) ?? (row.referenceNo as string) ?? String(id)
  )
}
