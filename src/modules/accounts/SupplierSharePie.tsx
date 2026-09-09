import { Card } from '../../components/ui'
import { fmtCompactPeso } from '../../lib/format'
import type { SupplierStat } from '../../lib/metrics'
import type { Supplier } from '../../data/types'
import { supplierColor } from '../../lib/chartColors'

const CX = 80
const CY = 80
const R_OUT = 72
const R_IN = 44

function polar(r: number, angle: number): [number, number] {
  const rad = ((angle - 90) * Math.PI) / 180
  return [CX + r * Math.cos(rad), CY + r * Math.sin(rad)]
}

/** Annular (donut) sector from startAngle to endAngle, degrees clockwise from 12 o'clock. */
function sectorPath(start: number, end: number) {
  const large = end - start > 180 ? 1 : 0
  const [x1, y1] = polar(R_OUT, start)
  const [x2, y2] = polar(R_OUT, end)
  const [x3, y3] = polar(R_IN, end)
  const [x4, y4] = polar(R_IN, start)
  return `M${x1.toFixed(2)},${y1.toFixed(2)} A${R_OUT},${R_OUT} 0 ${large} 1 ${x2.toFixed(2)},${y2.toFixed(2)} L${x3.toFixed(2)},${y3.toFixed(2)} A${R_IN},${R_IN} 0 ${large} 0 ${x4.toFixed(2)},${y4.toFixed(2)} Z`
}

/** Donut of purchase spend share per supplier for the selected period. */
export default function SupplierSharePie({ stats, suppliers }: { stats: SupplierStat[]; suppliers: Supplier[] }) {
  const withSpend = stats.filter((s) => s.totalSpend > 0)
  const grand = withSpend.reduce((sum, s) => sum + s.totalSpend, 0)

  let angle = 0
  const slices = withSpend.map((s) => {
    const sweep = (s.totalSpend / grand) * 360
    const slice = { stat: s, start: angle, end: angle + sweep }
    angle += sweep
    return slice
  })

  return (
    <Card className="flex h-full flex-col" delay={50}>
      <div className="flex items-center gap-[10px] border-b border-linesoft px-[14px] py-[10px]">
        <span className="text-[13px] font-semibold">Bought from most</span>
      </div>
      <div className="flex flex-1 flex-col items-center justify-center gap-5 p-[14px]">
        <svg width="170" height="170" viewBox="0 0 160 160" role="img" aria-label="Share of purchase spend per supplier">
          {slices.length === 1 ? (
            <g>
              <circle cx={CX} cy={CY} r={R_OUT} fill={supplierColor(slices[0].stat.supplier.id, suppliers)} />
              <circle cx={CX} cy={CY} r={R_IN} fill="#fff" />
            </g>
          ) : (
            slices.map((sl) => (
              <path key={sl.stat.supplier.id} d={sectorPath(sl.start, Math.min(sl.end, sl.start + 359.9))} fill={supplierColor(sl.stat.supplier.id, suppliers)} stroke="#fff" strokeWidth="2">
                <title>{sl.stat.supplier.name} · {fmtCompactPeso(sl.stat.totalSpend)} · {Math.round(sl.stat.share * 100)}%</title>
              </path>
            ))
          )}
          <text x={CX} y={CY - 4} textAnchor="middle" fontSize="14" fontWeight="600" fill="#14181b" className="tnum">{fmtCompactPeso(grand)}</text>
          <text x={CX} y={CY + 12} textAnchor="middle" fontSize="9.5" fill="#78828b">total spend</text>
        </svg>
        {/* Names and colours only. The spend and share used to be repeated
            here, column for column, from the supplier table directly beneath -
            the same four rows twice on one screen. The table carries the
            figures; this carries the key to the slices, which is the one thing
            the table cannot do. */}
        <div className="flex w-full flex-wrap justify-center gap-x-5 gap-y-[6px] border-t border-linesoft pt-[12px] font-meta text-[12px]">
          {stats.map((s) => (
            <span key={s.supplier.id} className="flex items-center gap-[6px]">
              <span className="h-[8px] w-[8px] shrink-0 rounded-full" style={{ background: supplierColor(s.supplier.id, suppliers) }} />
              <span className={s.totalSpend > 0 ? 'text-lab' : 'text-faint'}>{s.supplier.name}</span>
            </span>
          ))}
        </div>
      </div>
    </Card>
  )
}
