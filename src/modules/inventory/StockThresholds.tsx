import { useState } from 'react'
import { AlertTriangle, Plus, Trash2 } from 'lucide-react'
import { Card, DataTable, Dialog, Field, GhostButton, Input, MiniDark, PrimaryButton, SectionLabel, Select, Switch, td } from '../../components/ui'
import { fmtLiters } from '../../lib/format'
import { stockFor } from '../../lib/metrics'
import { hasCatalog, productName, productOptions, productKey } from '../../lib/products'
import { useTables } from '../../lib/data'
import { repos } from '../../data/repo'
import { isPending } from '../../lib/approvals'
import type { StockThreshold } from '../../data/types'

/**
 * Low supply warning setup - Secondary Feature 2.3.
 *
 * "A configurable stock threshold per product and warehouse that alerts the
 * Client when stock falls below the specified amount."
 *
 * The alert itself is raised server-side, on the write that moves stock (see
 * app/server/stock.ts) and delivered through the notification channel (2.11).
 * This screen is only the configuration, plus a live view of where each
 * warehouse currently sits relative to its line - so an administrator setting a
 * level can see immediately whether it is sensible.
 *
 * The product column only appears once there is more than one product to choose
 * between. MPower trades diesel only today, so it stays hidden and the form
 * stays as simple as it is now.
 */
export default function StockThresholds({ onNotice }: { onNotice: (message: string) => void }) {
  const data = useTables(['stockThresholds', 'warehouses', 'purchases', 'sales', 'products'])
  const [adding, setAdding] = useState(false)

  if (!data) return <Card className="p-6"><p className="text-[13px] text-faint">Loading…</p></Card>
  const { stockThresholds, warehouses, purchases, sales, products } = data
  const showProduct = hasCatalog(products)

  const rows = stockThresholds
    .map((t) => ({
      threshold: t,
      warehouse: warehouses.find((w) => w.id === t.warehouseId),
      level: stockFor(purchases, sales, t.warehouseId, t.productId),
    }))
    .sort((a, b) => (a.warehouse?.name ?? '').localeCompare(b.warehouse?.name ?? ''))

  /**
   * Warehouses that can still take a new level.
   *
   * 2.3 asks for a threshold "per product and warehouse", and this used to
   * compare against the DEFAULT product only - so the moment a depot had a
   * diesel level it dropped out of the list, the "Add level" button vanished
   * with it, and the product dropdown below became unreachable in exactly the
   * multi-product case it exists for. A depot now stays offerable until every
   * product in the catalog has a level there. With no catalog there is a single
   * default product and this reduces to the old behaviour.
   */
  const productChoices = productOptions(products)
  const productIds = productChoices.length ? productChoices.map((p) => p.id) : [productKey()]
  const hasLevel = (warehouseId: string, productId: string) =>
    stockThresholds.some(
      (t) => t.warehouseId === warehouseId && productKey(t.productId) === productKey(productId),
    )
  const unconfigured = warehouses.filter((w) => productIds.some((pid) => !hasLevel(w.id, pid)))
  /** Depots carrying no level at all, listed so the page shows every depot's
   * standing rather than only the ones somebody remembered to configure. */
  const unwatched = warehouses.filter((w) => !stockThresholds.some((t) => t.warehouseId === w.id))

  return (
    <div className="flex flex-col gap-4">
      <Card>
        {/* Matches every other card header in the app: linesoft rule, paper
            ground, 10px eyebrow. It was a heavier fill2 rule with 12px of
            padding, so this one card sat a few pixels taller than the rest. */}
        <div className="flex items-center justify-between gap-3 border-b border-linesoft bg-paper px-[14px] py-[10px]">
          <div>
            <SectionLabel>Low supply warnings</SectionLabel>
            {/* No standing explanation and no counts. The table states every
                depot's level and standing directly, and a paragraph restating
                that is a thing to read past every visit. */}
          </div>
          {unconfigured.length > 0 && (
            <MiniDark onClick={() => setAdding(true)}>
              <span className="flex items-center gap-1"><Plus size={12} /> Add level</span>
            </MiniDark>
          )}
        </div>

        <AddThreshold
          open={adding}
          warehouses={unconfigured}
          products={productChoices}
          showProduct={showProduct}
          hasLevel={hasLevel}
          onNotice={onNotice}
          onDone={() => setAdding(false)}
        />

        <DataTable
          cols={[
            // "Depot" everywhere else in the app - Depots card, Store in depot,
            // From depot. Warehouse was the data model's word leaking out.
            { label: 'Depot' },
            ...(showProduct ? [{ label: 'Product' }] : []),
            { label: 'Warn below', align: 'right' as const },
            { label: 'On hand now', align: 'right' as const },
            { label: 'Status' },
            { label: 'Watching', align: 'right' as const },
          ]}
          empty="No warning levels set. Stock can run out without anyone being told."
        >
          {rows.map(({ threshold, warehouse, level }) => (
            <Row
              key={threshold.id}
              threshold={threshold}
              warehouseName={warehouse?.name ?? 'Unknown warehouse'}
              productLabel={productName(products, threshold.productId)}
              showProduct={showProduct}
              level={level}
              onNotice={onNotice}
            />
          ))}
          {/* Depots with no level at all. Shown greyed rather than omitted: a
              depot nobody is watching is exactly what an admin opening this page
              needs to notice. */}
          {unwatched.map((w) => (
            <tr key={`unwatched-${w.id}`} className="hover:bg-fill2">
              <td className={`${td} pl-4`}>
                <span className="text-[13px] text-mut">{w.name}</span>
              </td>
              {showProduct && <td className={`${td} text-[13px] text-faint`}>—</td>}
              <td className={`${td} text-right font-meta text-[12px] text-faint`}>Not set</td>
              <td className={`${td} tnum text-right text-[13px] text-mut`}>
                {fmtLiters(Math.max(stockFor(purchases, sales, w.id), 0))}
              </td>
              <td className={td}>
                <span className="font-meta text-[12px] text-faint">Not watched</span>
              </td>
              <td className={`${td} pr-4 text-right`}>
                {/* Off, and not switchable: there is no level to watch against
                    until one is added. */}
                <span className="inline-flex pr-[36px]">
                  <Switch checked={false} disabled label={`${w.name} has no warning level`} onChange={() => {}} />
                </span>
              </td>
            </tr>
          ))}
        </DataTable>
      </Card>
    </div>
  )
}

function Row({ threshold, warehouseName, productLabel, showProduct, level, onNotice }: {
  threshold: StockThreshold
  warehouseName: string
  productLabel: string
  showProduct: boolean
  level: number
  onNotice: (message: string) => void
}) {
  const [value, setValue] = useState(String(threshold.thresholdLiters))
  const below = level < threshold.thresholdLiters
  const off = threshold.active === false

  async function save() {
    const n = Number(value)
    if (!Number.isFinite(n) || n < 0 || n === threshold.thresholdLiters) {
      setValue(String(threshold.thresholdLiters))
      return
    }
    // Clearing lastAlertedAt on a level change means a newly-raised line alerts
    // straight away rather than staying silent because it alerted at the old one.
    const result = await repos.stockThresholds.update(threshold.id, { thresholdLiters: n, lastAlertedAt: undefined })
    if (isPending(result)) onNotice(result.message)
  }

  return (
    <tr className={off ? 'opacity-50' : ''}>
      <td className={td}>{warehouseName}</td>
      {showProduct && <td className={td}>{productLabel}</td>}
      <td className={`${td} text-right`}>
        {/* Right-aligned to sit under its heading and above "On hand now", so
            the level and the figure it is compared against line up. */}
        <span className="inline-block w-[104px]">
          <Input
            type="number"
            min={0}
            className="nospin tnum text-right"
            aria-label={`Warn below, ${warehouseName}`}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onBlur={save}
          />
        </span>
      </td>
      <td className={`${td} tnum text-right font-semibold`}>{fmtLiters(level)}</td>
      <td className={td}>
        {off ? (
          <span className="font-meta text-[12px] text-faint">Off</span>
        ) : below ? (
          <span className="flex items-center gap-[5px] font-meta text-[12px] font-semibold text-redtext">
            <AlertTriangle size={13} strokeWidth={2} /> Below level
          </span>
        ) : (
          <span className="font-meta text-[12px] text-mut">OK</span>
        )}
      </td>
      <td className={`${td} pr-4 text-right`}>
        <span className="flex items-center justify-end gap-[10px]">
          <Switch
            checked={!off}
            label={`Watch ${warehouseName}`}
            onChange={async (next) => {
              const result = await repos.stockThresholds.update(threshold.id, { active: next })
              if (isPending(result)) onNotice(result.message)
            }}
          />
          <button
            type="button"
            title="Remove this warning level"
            aria-label={`Remove the warning level for ${warehouseName}`}
            onClick={async () => {
              const result = await repos.stockThresholds.remove(threshold.id)
              if (isPending(result)) onNotice(result.message)
            }}
            className="flex h-[26px] w-[26px] cursor-pointer items-center justify-center rounded-[6px] border-0 bg-transparent text-mut transition-colors hover:bg-fill2 hover:text-redtext"
          >
            <Trash2 size={14} strokeWidth={1.8} />
          </button>
        </span>
      </td>
    </tr>
  )
}

function AddThreshold({ open, warehouses, products, showProduct, hasLevel, onDone, onNotice }: {
  open: boolean
  warehouses: { id: string; name: string }[]
  products: { id: string; name: string }[]
  showProduct: boolean
  hasLevel: (warehouseId: string, productId: string) => boolean
  onDone: () => void
  onNotice: (message: string) => void
}) {
  const [warehouseId, setWarehouseId] = useState(warehouses[0]?.id ?? '')
  const [productId, setProductId] = useState(products[0]?.id ?? '')
  const [liters, setLiters] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function save() {
    const n = Number(liters)
    if (!warehouseId) return setError('Select a depot.')
    if (!Number.isFinite(n) || n <= 0) return setError('Enter a level above zero.')
    // A depot can be offerable because *some* product still needs a level while
    // the pair actually chosen already has one.
    if (hasLevel(warehouseId, showProduct ? productId : '')) {
      return setError('That warehouse already has a level for this product. Edit it in the table below.')
    }
    setError(null)
    const result = await repos.stockThresholds.add({
      warehouseId,
      // Blank means the default product - keeps diesel records identical to the
      // ones created before the catalog existed.
      productId: showProduct ? productId : undefined,
      thresholdLiters: n,
      active: true,
    })
    if (isPending(result)) onNotice(result.message)
    onDone()
  }

  return (
    <Dialog
      open={open}
      title="Add warning level"
      width={480}
      onClose={onDone}
      footer={
        <>
          <PrimaryButton onClick={save}>Save level</PrimaryButton>
          <GhostButton onClick={onDone}>Cancel</GhostButton>
          {error && <span className="ml-auto font-meta text-[12px] font-semibold text-redtext">{error}</span>}
        </>
      }
    >
      <div className="grid grid-cols-1 gap-[14px]">
      <Field label="Warehouse">
        <Select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
          {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </Select>
      </Field>
      {showProduct && (
        <Field label="Product">
          <Select value={productId} onChange={(e) => setProductId(e.target.value)}>
            {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </Field>
      )}
      <Field label="Warn below (liters)" hint="Everyone with Stock access is notified once when it drops past this.">
        <Input type="number" min={1} value={liters} placeholder="e.g. 20000" onChange={(e) => setLiters(e.target.value)} />
      </Field>
      </div>
    </Dialog>
  )
}
