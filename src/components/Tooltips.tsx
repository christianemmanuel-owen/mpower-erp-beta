import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

/**
 * One tooltip for the whole app, drawn on <body>.
 *
 * Any element with `data-tip="…"` gets it on hover or keyboard focus. It used
 * to be a CSS ::after on the element itself, which was clipped by whatever the
 * element sat inside - a table that scrolls, a card with rounded corners, a
 * dialog body - and the topmost row's tip ran off the top of the card while a
 * cell's tip hid under the row above. Drawn at body level with fixed
 * coordinates, it is never inside anything that can clip it, and it flips
 * below the control when there is no room above.
 *
 * Delegated: one pair of listeners on the document rather than one per
 * control, so a control added later, or rendered in a portal, is covered too.
 */
const GAP = 6
const DELAY_MS = 250

interface Tip { text: string; x: number; y: number; below: boolean }

export default function Tooltips() {
  const [tip, setTip] = useState<Tip | null>(null)

  useEffect(() => {
    let timer = 0
    let current: Element | null = null

    const place = (el: Element) => {
      const text = el.getAttribute('data-tip')?.trim()
      if (!text) return
      const r = el.getBoundingClientRect()
      // Above by default; below when the control is near the top edge.
      const below = r.top < 44
      setTip({ text, x: r.left + r.width / 2, y: below ? r.bottom + GAP : r.top - GAP, below })
    }
    const show = (el: Element) => {
      if (el === current) return
      current = el
      window.clearTimeout(timer)
      timer = window.setTimeout(() => place(el), DELAY_MS)
    }
    const hide = () => {
      current = null
      window.clearTimeout(timer)
      setTip(null)
    }

    const over = (e: Event) => {
      const el = (e.target as Element | null)?.closest?.('[data-tip]')
      if (el) show(el)
      else if (current) hide()
    }
    const out = (e: MouseEvent) => {
      const el = (e.target as Element | null)?.closest?.('[data-tip]')
      const to = e.relatedTarget as Element | null
      if (el && el === current && !(to && el.contains(to))) hide()
    }
    const focusIn = (e: FocusEvent) => {
      const el = (e.target as Element | null)?.closest?.('[data-tip]')
      // Only keyboard focus: a click focuses too, and a tip under the pointer
      // that stays after the click is noise.
      if (el && el.matches(':focus-visible')) show(el)
    }
    const onScrollOrKey = () => hide()

    document.addEventListener('mouseover', over)
    document.addEventListener('mouseout', out)
    document.addEventListener('focusin', focusIn)
    document.addEventListener('focusout', hide)
    document.addEventListener('mousedown', hide)
    document.addEventListener('keydown', onScrollOrKey)
    window.addEventListener('scroll', onScrollOrKey, true)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('mouseover', over)
      document.removeEventListener('mouseout', out)
      document.removeEventListener('focusin', focusIn)
      document.removeEventListener('focusout', hide)
      document.removeEventListener('mousedown', hide)
      document.removeEventListener('keydown', onScrollOrKey)
      window.removeEventListener('scroll', onScrollOrKey, true)
    }
  }, [])

  if (!tip) return null
  // Clamp to the viewport so a tip on a control at the right edge stays on screen.
  const half = 130
  const x = Math.min(Math.max(tip.x, half + 8), window.innerWidth - half - 8)
  return createPortal(
    <div
      role="tooltip"
      className="tip-pop pointer-events-none fixed z-[1400] max-w-[260px] whitespace-nowrap rounded-[6px] bg-ink px-[8px] py-[4px] font-meta text-[11.5px] font-medium leading-[1.35] text-white"
      style={{ left: x, top: tip.y, transform: `translate(-50%, ${tip.below ? '0' : '-100%'})` }}
    >
      {tip.text}
    </div>,
    document.body,
  )
}
