import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import type { DateRange } from './metrics'

function iso(d: Date) {
  return d.toISOString().slice(0, 10)
}

export const presets = [
  { key: 'today', label: 'Today', days: 0 },
  { key: '7d', label: '7D', days: 6 },
  { key: '15d', label: '15D', days: 14 },
  { key: '30d', label: '30D', days: 29 },
  { key: '90d', label: '90D', days: 89 },
] as const

/** How many calendar days a range spans, for "vs the 7 days before". */
export function rangeDays(range: DateRange): number {
  return Math.round((Date.parse(range.to) - Date.parse(range.from)) / 86_400_000) + 1
}

interface RangeCtx {
  range: DateRange
  preset: string
  setPreset: (key: string) => void
  setCustom: (from: string, to: string) => void
}

const Ctx = createContext<RangeCtx | null>(null)

export function RangeProvider({ children }: { children: ReactNode }) {
  const [preset, setPresetKey] = useState('30d')
  const [custom, setCustomRange] = useState<DateRange | null>(null)

  const range = useMemo<DateRange>(() => {
    if (preset === 'custom' && custom) return custom
    const p = presets.find((x) => x.key === preset) ?? presets.find((x) => x.key === '30d')!
    const to = new Date()
    const from = new Date()
    from.setDate(from.getDate() - p.days)
    return { from: iso(from), to: iso(to) }
  }, [preset, custom])

  const value = useMemo(
    () => ({
      range,
      preset,
      setPreset: (key: string) => setPresetKey(key),
      setCustom: (from: string, to: string) => {
        setCustomRange({ from, to })
        setPresetKey('custom')
      },
    }),
    [range, preset],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useRange() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useRange outside provider')
  return ctx
}

// The toolbar scale, like every other control that sits in a page header.
// `ctl` is what gives it the app's chevron - see select.ctl in index.css.
const selectCls = 'ctl h-[28px] rounded-[6px] border border-inputline bg-white px-[10px] font-meta text-[12px] font-[inherit] text-ink focus:border-teal focus:outline-none'

export function RangePicker() {
  const { preset, setPreset, range, setCustom } = useRange()
  return (
    <div className="flex items-center gap-2">
      <select value={preset} onChange={(e) => setPreset(e.target.value)} className={selectCls}>
        {presets.map((p) => (
          <option key={p.key} value={p.key}>{p.label}</option>
        ))}
        <option value="custom">Custom</option>
      </select>
      {preset === 'custom' && (
        <span className="flex items-center gap-1 text-[13px]">
          <input type="date" value={range.from} onChange={(e) => setCustom(e.target.value, range.to)} className={selectCls} />
          –
          <input type="date" value={range.to} onChange={(e) => setCustom(range.from, e.target.value)} className={selectCls} />
        </span>
      )}
    </div>
  )
}
