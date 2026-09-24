import { useToast } from './Toast'
import { useTables } from '../lib/data'
import { usePeek } from '../lib/peek'
import { canAccess, useAuth } from '../lib/auth'
import { repos } from '../data/repo'
import { isPending } from '../lib/approvals'
import { advancePatch } from '../lib/tripStages'
import { hasCatalog } from '../lib/products'
import { stockByWarehouse } from '../lib/metrics'
import { builtInRules, numberCodingSettings } from '../lib/numberCoding'
import { SaleForm } from '../modules/sales/Sales'
import { PurchaseForm } from '../modules/inventory/Inventory'
import TripDrawer from '../modules/logistics/TripDrawer'
import SettleDialog from '../modules/collection/SettleDialog'
import type { Delivery, DeliveryStatus, SaleInstallment, Warehouse } from '../data/types'

/**
 * The drawer a peeked record opens in - the same SaleForm, PurchaseForm or
 * TripDrawer its module uses, fed from the same tables, so what you can do
 * from Input history is exactly what you can do from the module. Mounted
 * once in the office shell; renders nothing until a peek is open, and only
 * then asks for the tables, so pages that never peek never pay for them.
 */
export default function RecordPeek() {
  const ctx = usePeek()
  if (!ctx?.peek) return null
  return <PeekBody tbl={ctx.peek.tbl} id={ctx.peek.id} onClose={ctx.close} />
}

function PeekBody({ tbl, id, onClose }: { tbl: 'sales' | 'purchases' | 'deliveries' | 'collection'; id: string; onClose: () => void }) {
  const toast = useToast()
  const { seat } = useAuth()
  const data = useTables([
    'sales', 'purchases', 'deliveries', 'customers', 'suppliers', 'agents', 'warehouses', 'bankAccounts', 'personnel',
    'haulers', 'products', 'trucks', 'vehicleMaintenance', 'truckBanRules', 'holidays', 'appSettings',
  ] as const)
  if (!data) return null
  const {
    sales, purchases, deliveries, customers, suppliers, agents, warehouses, bankAccounts, personnel,
    haulers, products, trucks, vehicleMaintenance, truckBanRules, holidays, appSettings,
  } = data

  if (tbl === 'sales') {
    const sale = sales.find((s) => s.id === id)
    if (!sale) { toast('That sale is no longer there.'); onClose(); return null }
    return (
      <SaleForm
        readOnly={!canAccess(seat, 'sales')}
        open onClose={onClose} editing={sale}
        agents={agents} customers={customers} warehouses={warehouses} bankAccounts={bankAccounts}
        personnel={personnel} purchases={purchases} sales={sales}
        products={products} showProduct={hasCatalog(products)}
        onNotice={toast}
      />
    )
  }

  if (tbl === 'purchases') {
    const purchase = purchases.find((p) => p.id === id)
    if (!purchase) { toast('That purchase is no longer there.'); onClose(); return null }
    const stock = stockByWarehouse(purchases, sales)
    const headroom = (w: Warehouse) => w.capacityLiters - Math.max(stock.get(w.id) ?? 0, 0)
    return (
      <PurchaseForm
        readOnly={!canAccess(seat, 'inventory')}
        open onClose={onClose} editing={purchase}
        suppliers={suppliers} haulers={haulers} warehouses={warehouses} bankAccounts={bankAccounts}
        headroom={headroom} onHand={stock} products={products}
        onNotice={toast}
      />
    )
  }

  if (tbl === 'collection') {
    const [saleId, instId] = id.split('::')
    const sale = sales.find((s) => s.id === saleId)
    const installment = sale?.installments.find((i) => i.id === instId)
    if (!sale || !installment) { toast('That payment is no longer there.'); onClose(); return null }
    // The same write Collect makes: the one installment patched inside its
    // sale, everything else on the sale untouched.
    async function save(sId: string, iId: string, patch: Partial<SaleInstallment>) {
      const target = sales.find((s) => s.id === sId)
      if (!target) return
      const result = await repos.sales.update(sId, {
        installments: target.installments.map((i) => (i.id === iId ? { ...i, ...patch } : i)),
      })
      if (isPending(result)) toast(result.message)
    }
    return (
      <SettleDialog
        readOnly={!canAccess(seat, 'collection')}
        entry={{ sale, installment }}
        sales={sales} customers={customers} personnel={personnel} bankAccounts={bankAccounts}
        onClose={onClose} onSave={save} onNotice={toast}
      />
    )
  }

  const trip = deliveries.find((d) => d.id === id)
  if (!trip) { toast('That trip is no longer there.'); onClose(); return null }
  const sale = sales.find((s) => s.id === trip.saleId)
  const codingSettings = numberCodingSettings(appSettings)
  const wh = warehouses.find((w) => w.id === sale?.warehouseId)
  async function advance(d: Delivery, next: DeliveryStatus, extra?: Partial<Delivery>) {
    try {
      const result = await repos.deliveries.update(d.id, advancePatch(d, next, seat, extra))
      if (isPending(result)) toast(result.message)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Couldn’t move this trip on.')
    }
  }
  return (
    <TripDrawer
      readOnly={!canAccess(seat, 'logistics')}
      delivery={trip}
      personnel={personnel}
      trucks={trucks}
      deliveries={deliveries}
      maintenance={vehicleMaintenance}
      banRules={[...builtInRules(codingSettings), ...truckBanRules]}
      holidays={holidays.map((h) => h.date.slice(0, 10))}
      liters={sale?.volumeLiters}
      checks={codingSettings}
      origin={wh ? { label: wh.name, query: wh.lat && wh.lng ? `${wh.lat},${wh.lng}` : wh.address, point: wh.lat && wh.lng ? { lat: wh.lat, lng: wh.lng } : undefined } : undefined}
      onClose={onClose}
      onNotice={toast}
      onAdvance={(next, patch) => advance(trip, next, patch)}
    />
  )
}
