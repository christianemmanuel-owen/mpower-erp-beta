import { api } from '../lib/api'
import { queryClient } from '../lib/queryClient'
import { fetchTable, tableKey, type TableName } from '../lib/data'
import type {
  Announcement, AttendanceRecord, Base, DashboardConfig, DashboardLayout, Delivery, DrugTest, Holiday,
  HrSettingsRecord, LeaveRecord, PayrollRun, Personnel, PricePosting, Product, Purchase,
  Sale, Seat, Shift, StockThreshold, SupplierQuote, Todo, TruckBanRule, VehicleMaintenance,
} from './types'

/** Same interface the app has always used - now backed by the D1 API instead of
 * a local database. Writes invalidate the react-query cache so every screen
 * showing that table refreshes immediately. */
export class Repo<T extends Base> {
  private tbl: TableName

  constructor(tbl: TableName) {
    this.tbl = tbl
  }

  private invalidate() {
    queryClient.invalidateQueries({ queryKey: tableKey(this.tbl) })
  }

  all(): Promise<T[]> {
    return api<T[]>(`/${this.tbl}`)
  }

  get(id: string): Promise<T> {
    return api<T>(`/${this.tbl}/${id}`)
  }

  async add(data: Omit<T, 'id' | 'createdAt' | 'updatedAt'> & { password?: string }): Promise<T> {
    const record = await api<T>(`/${this.tbl}`, { method: 'POST', body: data })
    this.invalidate()
    return record
  }

  async update(id: string, changes: Partial<T> & { password?: string }): Promise<T> {
    const record = await api<T>(`/${this.tbl}/${id}`, { method: 'PUT', body: changes })
    this.invalidate()
    return record
  }

  async remove(id: string): Promise<void> {
    await api(`/${this.tbl}/${id}`, { method: 'DELETE' })
    this.invalidate()
  }
}

export const repos = {
  suppliers: new Repo('suppliers'),
  warehouses: new Repo('warehouses'),
  agents: new Repo('agents'),
  customers: new Repo('customers'),
  bankAccounts: new Repo('bankAccounts'),
  personnel: new Repo<Personnel>('personnel'),
  trucks: new Repo('trucks'),
  purchases: new Repo<Purchase>('purchases'),
  sales: new Repo<Sale>('sales'),
  deliveries: new Repo<Delivery>('deliveries'),
  supplierQuotes: new Repo<SupplierQuote>('supplierQuotes'),
  seats: new Repo<Seat>('seats'),
  shifts: new Repo<Shift>('shifts'),
  attendance: new Repo<AttendanceRecord>('attendance'),
  leaves: new Repo<LeaveRecord>('leaves'),
  holidays: new Repo<Holiday>('holidays'),
  payrollRuns: new Repo<PayrollRun>('payrollRuns'),
  hrSettings: new Repo<HrSettingsRecord>('hrSettings'),
  products: new Repo<Product>('products'),
  stockThresholds: new Repo<StockThreshold>('stockThresholds'),
  todos: new Repo<Todo>('todos'),
  announcements: new Repo<Announcement>('announcements'),
  pricePostings: new Repo<PricePosting>('pricePostings'),
  drugTests: new Repo<DrugTest>('drugTests'),
  vehicleMaintenance: new Repo<VehicleMaintenance>('vehicleMaintenance'),
  truckBanRules: new Repo<TruckBanRule>('truckBanRules'),
  dashboardConfigs: new Repo<DashboardConfig>('dashboardConfigs'),
  dashboardLayouts: new Repo<DashboardLayout>('dashboardLayouts'),
}

/** Confirming a delivery-type sale creates its Delivery record. */
export async function confirmSale(sale: Sale, info: { address: string; contactPerson: string; contactNumber: string }) {
  await repos.sales.update(sale.id, { status: 'confirmed' })
  if (sale.fulfillment === 'delivery') {
    const existing = (await fetchTable('deliveries')).find((d) => d.saleId === sale.id)
    if (!existing) {
      await repos.deliveries.add({
        saleId: sale.id,
        // Exhibit A 1.5 keeps the customer's REQUESTED schedule and the
        // reorganised FINAL schedule apart. Both start out the same - the trip
        // is booked for what was asked - but only `scheduleDate` moves when
        // Logistics reorganises, so the request survives as a record of what was
        // promised. Without copying it here the distinction would exist in the
        // type and be empty in practice, and on-time reporting would have
        // nothing to compare drift against.
        requestedDate: sale.scheduleDate ?? sale.date,
        requestedTime: sale.scheduleTime,
        scheduleDate: sale.scheduleDate ?? sale.date,
        scheduleTime: sale.scheduleTime,
        movementType: 'delivery_to_client',
        deliveryAddress: info.address,
        contactPerson: info.contactPerson,
        contactNumber: info.contactNumber,
        status: 'scheduled',
      })
    }
  }
}

/** Blocks deleting a lookup that is referenced by transactions. */
export async function safeDeleteLookup(
  kind: 'suppliers' | 'warehouses' | 'agents' | 'customers' | 'bankAccounts' | 'personnel' | 'trucks',
  id: string,
): Promise<{ ok: boolean; reason?: string }> {
  const [purchases, sales, deliveries, quotes] = await Promise.all([
    fetchTable('purchases'), fetchTable('sales'), fetchTable('deliveries'), fetchTable('supplierQuotes'),
  ])
  const used =
    (kind === 'suppliers' && (purchases.some((p) => p.supplierId === id) || quotes.some((q) => q.supplierId === id))) ||
    (kind === 'warehouses' && (purchases.some((p) => p.warehouseId === id) || sales.some((s) => s.warehouseId === id))) ||
    (kind === 'agents' && sales.some((s) => s.agentId === id)) ||
    (kind === 'customers' && sales.some((s) => s.customerId === id)) ||
    (kind === 'bankAccounts' && sales.some((s) => s.bankAccountId === id)) ||
    (kind === 'personnel' && deliveries.some((d) => [d.driverId, d.pahinanteId, d.loaderId, d.guardId].includes(id))) ||
    (kind === 'trucks' && deliveries.some((d) => d.truckId === id))
  if (used) return { ok: false, reason: 'This record is used by existing transactions and can’t be deleted.' }
  await repos[kind].remove(id)
  return { ok: true }
}
