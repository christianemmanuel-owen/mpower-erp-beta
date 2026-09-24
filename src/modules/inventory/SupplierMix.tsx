import { useState } from 'react'
import { Card, InfoTip, filterCls } from '../../components/ui'
import { supplierColor } from '../../lib/chartColors'
import { fmtLiters, fmtNum } from '../../lib/format'
import type { Supplier } from '../../data/types'

/**
 * Where today's stock came from, by supplier - the client's "out of the
 * total, how much came from where" - with three ways to look at it.
 *
 * The stacked bars are the default because the question is about shares and
 * a bar answers it fastest. The mosaic adds depot size to the same picture,
 * and the supplier chart flips it to "where is our Petron fuel". The choice
 * is remembered per browser.
 */
export interface MixRow {
  id: string
  name: string
  onHand: number
  sources: Record<string, number>
}

export interface MixSource {
  id: string
  name: string
  liters: number
}

type View = 'bars' | 'mosaic' | 'supplier'
const VIEWS: { key: View; label: string }[] = [
  { key: 'bars', label: 'Shares' },
  { key: 'mosaic', label: 'Mosaic' },
  { key: 'supplier', label: 'By supplier' },
]
const VIEW_KEY = 'stock.supplierMix.view'
const UNKNOWN = '#c8ced3'

export default function SupplierMix({ total, depots, sources, suppliers }: {
  /** The whole book. */
  total: MixRow
  depots: MixRow[]
  /** Suppliers in display order (largest share first). */
  sources: MixSource[]
  suppliers: Supplier[]
}) {
  const [view, setView] = useState<View>(() => {
    try {
      const v = localStorage.getItem(VIEW_KEY) as View | null
      return v && VIEWS.some((x) => x.key === v) ? v : 'bars'
    } catch {
      return 'bars'
    }
  })
  const pick = (v: View) => {
    setView(v)
    try { localStorage.setItem(VIEW_KEY, v) } catch { /* a browser with site data blocked still gets the view, just not remembered */ }
  }
  const color = (id: string) => (id === '?' ? UNKNOWN : supplierColor(id, suppliers))

  return (
    <Card className="mb-3 flex flex-col">
      <div className="flex flex-wrap items-center gap-[10px] border-b border-linesoft px-[14px] py-[10px]">
        <span className="text-[13px] font-semibold">Supplier mix</span>
        <InfoTip label="Supplier mix">
          What remains of each supplier's deliveries, as of today. A sale draws from
          every supplier's litres in the tank in proportion to their share at the
          time. Open a depot to read it as of another day.
        </InfoTip>
        <span className="ml-auto flex flex-wrap items-center gap-[14px]">
          {view !== 'supplier' && sources.map((r) => (
            <span key={r.id} className="inline-flex items-center gap-[5px] whitespace-nowrap font-meta text-[12px] text-lab">
              <span className="h-[7px] w-[7px] shrink-0 rounded-full" style={{ background: color(r.id) }} aria-hidden />
              {r.name}
            </span>
          ))}
          {/* A select rather than a row of pills: five pills were wider than
              the legend they sat beside, for a choice made once. */}
          <select
            value={view}
            onChange={(e) => pick(e.target.value as View)}
            aria-label="View"
            className={`${filterCls} h-[28px] w-auto min-w-0 py-0 text-[12px]`}
          >
            {VIEWS.map((v) => <option key={v.key} value={v.key}>{v.label}</option>)}
          </select>
        </span>
      </div>

      <div className="flex min-h-[300px] flex-col justify-center px-[14px] py-[18px]">
        {view === 'bars' && (
          <div className="flex flex-col gap-[20px]">
            <MixBar row={total} order={sources} color={color} strong />
            {depots.map((d) => <MixBar key={d.id} row={d} order={sources} color={color} />)}
          </div>
        )}
        {view === 'mosaic' && <Mosaic total={total} depots={depots} order={sources} color={color} />}
        {view === 'supplier' && <BySupplier depots={depots} order={sources} color={color} />}
      </div>
    </Card>
  )
}

/** One row as a bar split by supplier, in legend order. Shares under 8% are
 *  drawn but not labelled - the label would not fit. */
function MixBar({ row, order, color, strong }: {
  row: MixRow
  order: MixSource[]
  color: (id: string) => string
  strong?: boolean
}) {
  const segs = order.map((r) => ({ id: r.id, name: r.name, liters: row.sources[r.id] ?? 0 })).filter((x) => x.liters >= 0.5)
  return (
    <div className="grid grid-cols-[120px_1fr_88px] items-center gap-[12px]">
      <span className={`truncate text-[13px] ${strong ? 'font-semibold text-ink' : 'text-lab'}`}>{row.name}</span>
      <span className="block">
        <span
          className={`flex gap-[2px] overflow-hidden rounded-[7px] ${strong ? 'h-[36px]' : 'h-[28px]'}`}
          role="img"
          aria-label={`${row.name}: ${segs.map((x) => `${Math.round((x.liters / row.onHand) * 100)}% ${x.name}`).join(', ')}`}
        >
          {row.onHand > 0 && segs.map((x) => {
            const pct = (x.liters / row.onHand) * 100
            return (
              <span
                key={x.id}
                title={`${x.name} · ${fmtLiters(x.liters)} · ${Math.round(pct)}%`}
                className="flex items-center justify-center overflow-hidden whitespace-nowrap rounded-[3px] font-meta text-[12px] font-semibold text-white first:rounded-l-[7px] last:rounded-r-[7px]"
                style={{ width: `${pct}%`, background: color(x.id) }}
              >
                {pct >= 8 ? `${Math.round(pct)}%` : ''}
              </span>
            )
          })}
        </span>
      </span>
      <span className={`tnum text-right font-meta text-[12px] ${strong ? 'font-semibold text-ink' : 'text-mut'}`}>{fmtLiters(row.onHand)}</span>
    </div>
  )
}

/** Column width is the depot's share of all stock; each column is split by
 *  supplier. Every rectangle's area is litres. */
function Mosaic({ total, depots, order, color }: { total: MixRow; depots: MixRow[]; order: MixSource[]; color: (id: string) => string }) {
  const W = 1000
  const H = 220
  const GAP = 6
  const usable = W - GAP * (depots.length - 1)
  let x = 0
  return (
    <svg viewBox={`0 0 ${W} ${H + 44}`} className="block h-auto w-full" role="img" aria-label="Stock by depot and supplier, area proportional to litres">
      {depots.map((d) => {
        const w = total.onHand > 0 ? (d.onHand / total.onHand) * usable : 0
        const x0 = x
        x += w + GAP
        let y = 0
        const segs = order.map((r) => ({ id: r.id, name: r.name, liters: d.sources[r.id] ?? 0 })).filter((s) => s.liters >= 0.5)
        return (
          <g key={d.id}>
            {d.onHand > 0 && segs.map((s, i) => {
              const h = (s.liters / d.onHand) * (H - 2 * (segs.length - 1))
              const y0 = y
              y += h + 2
              const pct = Math.round((s.liters / d.onHand) * 100)
              const short = s.name.split(' ')[0]
              return (
                <g key={s.id}>
                  <rect x={x0} y={y0} width={w} height={h} rx={3} fill={color(s.id)}>
                    <title>{`${d.name} · ${s.name} · ${fmtLiters(s.liters)} · ${pct}%`}</title>
                  </rect>
                  {h >= 22 && w >= 90 && (
                    <text x={x0 + w / 2} y={y0 + h / 2 + 4} textAnchor="middle" fontSize={12} fontWeight={600} fill="#fff" className="font-meta">{short} {pct}%</text>
                  )}
                  {i === 0 && null}
                </g>
              )
            })}
            <text x={x0 + w / 2} y={H + 20} textAnchor="middle" fontSize={13} fontWeight={600} fill="#14181b">{d.name}</text>
            <text x={x0 + w / 2} y={H + 36} textAnchor="middle" fontSize={11} fill="#616a72" className="tnum font-meta">
              {fmtLiters(d.onHand)} · {total.onHand > 0 ? Math.round((d.onHand / total.onHand) * 100) : 0}%
            </text>
          </g>
        )
      })}
    </svg>
  )
}

/** Litres per supplier, a bar per depot in that supplier's colour, on one
 *  axis - so any two bars anywhere compare. */
function BySupplier({ depots, order, color }: { depots: MixRow[]; order: MixSource[]; color: (id: string) => string }) {
  const W = 1000
  const H = 230
  const max = Math.max(1, ...order.flatMap((s) => depots.map((d) => d.sources[s.id] ?? 0)))
  const cluster = W / Math.max(order.length, 1)
  const bw = Math.min(34, (cluster - 40) / Math.max(depots.length, 1) - 6)
  const shade = (i: number) => 1 - i * (0.55 / Math.max(depots.length - 1, 1))
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H + 50}`} className="block h-auto w-full" role="img" aria-label="Litres on hand by supplier and depot">
        <line x1={0} y1={H} x2={W} y2={H} stroke="#e5e8ea" />
        <line x1={0} y1={H / 2} x2={W} y2={H / 2} stroke="#eef0f2" />
        <text x={0} y={H / 2 - 4} fontSize={10} fill="#a8b0b7" className="tnum font-meta">{fmtNum(Math.round(max / 2))}</text>
        <text x={0} y={-2 + 10} fontSize={10} fill="#a8b0b7" className="tnum font-meta">{fmtNum(max)}</text>
        {order.map((s, si) => {
          const cx = si * cluster + cluster / 2
          const groupW = depots.length * bw + (depots.length - 1) * 6
          const x0 = cx - groupW / 2
          const top = depots.reduce((m, d) => Math.max(m, d.sources[s.id] ?? 0), 0)
          return (
            <g key={s.id}>
              {depots.map((d, di) => {
                const v = d.sources[s.id] ?? 0
                const h = (v / max) * (H - 16)
                const x = x0 + di * (bw + 6)
                return (
                  <g key={d.id}>
                    <rect x={x} y={H - h} width={bw} height={Math.max(h, v > 0 ? 2 : 0)} rx={3} fill={color(s.id)} opacity={shade(di)}>
                      <title>{`${s.name} · ${d.name} · ${fmtLiters(v)}`}</title>
                    </rect>
                    {v === top && v > 0 && (
                      <text x={x + bw / 2} y={H - h - 5} textAnchor="middle" fontSize={10} fill="#525b63" className="tnum font-meta">{fmtNum(v)}</text>
                    )}
                  </g>
                )
              })}
              <text x={cx} y={H + 18} textAnchor="middle" fontSize={13} fontWeight={600} fill="#14181b">{s.name}</text>
              <text x={cx} y={H + 34} textAnchor="middle" fontSize={11} fill="#616a72" className="tnum font-meta">{fmtLiters(s.liters)}</text>
            </g>
          )
        })}
      </svg>
      <div className="mt-[6px] flex flex-wrap gap-[14px] font-meta text-[12px] text-lab">
        {depots.map((d, di) => (
          <span key={d.id} className="inline-flex items-center gap-[5px]">
            <span className="h-[9px] w-[9px] rounded-[2px] bg-sec" style={{ opacity: shade(di) }} aria-hidden />
            {d.name}
          </span>
        ))}
      </div>
    </div>
  )
}
