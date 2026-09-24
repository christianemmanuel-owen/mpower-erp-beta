import { useQueries, useQuery } from '@tanstack/react-query'
import { api } from './api'
import type {
  Agent, Announcement, AppSetting, AttendanceRecord, BankAccount, Customer, DashboardConfig, DashboardLayout, Delivery,
  DrugTest, Hauler, Holiday, HrSettingsRecord, LeaveRecord, PayrollRun, Personnel, PricePosting,
  Product, Purchase, Sale, Seat, Shift, StockThreshold, Supplier, SupplierQuote, Todo,
  Truck, TruckBanRule, VehicleMaintenance, Warehouse,
} from '../data/types'

/** Row type per table - mirrors what the server stores under each tbl. */
export interface Tables {
  suppliers: Supplier
  haulers: Hauler
  warehouses: Warehouse
  agents: Agent
  customers: Customer
  bankAccounts: BankAccount
  personnel: Personnel
  trucks: Truck
  purchases: Purchase
  sales: Sale
  deliveries: Delivery
  supplierQuotes: SupplierQuote
  seats: Seat
  shifts: Shift
  attendance: AttendanceRecord
  leaves: LeaveRecord
  holidays: Holiday
  payrollRuns: PayrollRun
  hrSettings: HrSettingsRecord
  // Added 2026-08-20 with the infrastructure layers - see src/data/types.ts.
  products: Product
  stockThresholds: StockThreshold
  todos: Todo
  announcements: Announcement
  pricePostings: PricePosting
  drugTests: DrugTest
  vehicleMaintenance: VehicleMaintenance
  truckBanRules: TruckBanRule
  dashboardConfigs: DashboardConfig
  dashboardLayouts: DashboardLayout
  /** Admin-written system configuration; see AppSetting. */
  appSettings: AppSetting
}

export type TableName = keyof Tables

export const tableKey = (name: TableName) => ['table', name] as const

export function fetchTable<K extends TableName>(name: K): Promise<Tables[K][]> {
  return api<Tables[K][]>(`/${name}`)
}

/** All rows of one table, kept fresh by polling - undefined while loading. */
export function useTable<K extends TableName>(name: K): Tables[K][] | undefined {
  return useQuery({ queryKey: tableKey(name), queryFn: () => fetchTable(name) }).data
}

/**
 * One table, only when this seat may read it - undefined while loading or
 * when not asked for. For the tables the server gates (HR's, say): asking
 * for one the seat cannot read is a 403, and a 403 in useTables leaves the
 * whole screen blank for ever, since it waits on every query to resolve.
 */
export function useTableIf<K extends TableName>(name: K, enabled: boolean): Tables[K][] | undefined {
  return useQuery({ queryKey: tableKey(name), queryFn: () => fetchTable(name), enabled }).data
}

/** Several tables at once (the common dashboard/board pattern) -
 * undefined until every table has loaded, then an object keyed by table name. */
export function useTables<K extends TableName>(names: readonly K[]): { [P in K]: Tables[P][] } | undefined {
  const results = useQueries({
    queries: names.map((name) => ({ queryKey: tableKey(name), queryFn: () => fetchTable(name) })),
  })
  if (results.some((r) => r.data === undefined)) return undefined
  return Object.fromEntries(names.map((name, i) => [name, results[i].data])) as { [P in K]: Tables[P][] }
}
