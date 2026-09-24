import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { Maximize2, RotateCw, X } from 'lucide-react'
import { fmtDate } from '../lib/format'
import { Dialog, GhostButton, PrimaryButton } from './ui'
import { resignSnoozed, snoozeResign } from '../lib/signGuard'

/**
 * A signature drawn with a finger or a mouse.
 *
 * Kept deliberately small in place: a 3:1 canvas, one pen, Clear and Done.
 * On a phone that strip is cramped for a real signature, so the pad can be
 * opened full-screen - the whole width of the phone and most of its height -
 * and signed there; Done closes it with the signature in place. The image
 * is stored as a PNG data URL of a few kilobytes on the record itself, which
 * is enough to print on the slip and to show who signed. It is not a
 * cryptographic signature and does not claim to be - it replaces a pen on a
 * printed sheet, nothing more.
 */
export interface SignatureValue {
  name: string
  image: string
  at: string
}

export default function SignaturePad({ label, name, value, onChange, layout = 'card' }: {
  label: string
  /** Whose signature this is, printed under the line. */
  name: string
  value?: SignatureValue
  onChange: (v: SignatureValue | undefined) => void
  /** `row`: the caller shows the role, the name and the date beside the
   *  pad, so the pad itself carries neither a heading nor a name. */
  layout?: 'card' | 'row'
}) {
  const row = layout === 'row'
  const small = useRef<SurfaceHandle>(null)
  const big = useRef<SurfaceHandle>(null)
  const [dirty, setDirty] = useState(false)
  // Re-sign asks first - see lib/signGuard.
  const [confirming, setConfirming] = useState(false)
  const [skip, setSkip] = useState(false)
  const [bigDirty, setBigDirty] = useState(false)
  // closed → open → closing: the sheet stays mounted through `closing` so
  // its exit animation has something to play on.
  const [phase, setPhase] = useState<'closed' | 'open' | 'closing'>('closed')
  const expanded = phase !== 'closed'
  const openBig = () => setPhase('open')
  const closeBig = () => setPhase((p) => (p === 'open' ? 'closing' : p))
  useEffect(() => {
    if (phase !== 'closing') return
    const t = window.setTimeout(() => setPhase('closed'), 200)
    return () => window.clearTimeout(t)
  }, [phase])
  // A phone held upright: the pad is turned sideways so the long edge of the
  // screen is the width of the signature, as wide as it would be in
  // landscape without asking anyone to rotate the phone. Recomputed if they do.
  const [rotated, setRotated] = useState(false)
  const [size, setSize] = useState({ w: 0, h: 0 })

  // Nothing behind the full-screen pad should scroll while it is up.
  useEffect(() => {
    if (!expanded) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const measure = () => {
      const w = window.innerWidth
      const h = window.innerHeight
      setSize({ w, h })
      setRotated(h > w && w < 900)
    }
    measure()
    window.addEventListener('resize', measure)
    return () => { document.body.style.overflow = prev; window.removeEventListener('resize', measure) }
  }, [expanded])

  const sign = (image: string) => onChange({ name, image, at: new Date().toISOString() })
  const btn = 'inline-flex h-[36px] cursor-pointer items-center rounded-[8px] border-0 px-[14px] font-meta text-[12px] font-semibold disabled:cursor-default disabled:opacity-40'

  return (
    <div className="min-w-0">
      {!row && <p className="m-0 mb-[6px] font-meta text-[11px] font-semibold uppercase tracking-[.08em] text-mut">{label}</p>}
      {value ? (
        /* Signed: the same sheet, with the signature sitting on its line. */
        <div className="rounded-[10px] border border-line bg-white">
          <div className="relative">
            <img src={value.image} alt={`${value.name}'s signature`} className="block aspect-[2.4/1] w-full object-contain" />
            <Baseline />
          </div>
          <div className="flex h-[44px] items-center justify-between gap-[8px] border-t border-linesoft pl-[12px] pr-[4px]">
            {row ? (
              <span className="truncate font-meta text-[12px] text-mut">Signed on this pad</span>
            ) : (
              <span className="min-w-0">
                <span className="block truncate text-[13px] font-semibold leading-[1.2]">{value.name}</span>
                <span className="block whitespace-nowrap font-meta text-[11px] text-mut">Signed {fmtDate(value.at)}</span>
              </span>
            )}
            {/* The guardrail. A signature is the record that someone checked
                or received; one thumb on Re-sign wiped it. So it asks, in a
                dialog - and a person fixing several in a row can say so
                once and not be asked again for five minutes (lib/signGuard). */}
            <button
              type="button"
              onClick={() => (resignSnoozed() ? onChange(undefined) : setConfirming(true))}
              className={`${btn} shrink-0 bg-transparent px-[10px] text-tealtext`}
            >
              Re-sign
            </button>
          </div>
        </div>
      ) : (
        /* Unsigned: white, a line to sign on, "Sign here" until the pen
           touches, and the expand control in the corner - the small pad is
           the big one at a smaller size, not a different thing. */
        <div className="rounded-[10px] border border-line bg-white">
          <Surface ref={small} label={label} onDirty={setDirty}>
            <Baseline />
            {!dirty && (
              <span aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center font-meta text-[13px] text-faint">
                Sign here
              </span>
            )}
            <button
              type="button"
              onClick={openBig}
              aria-label={`Open a larger ${label.toLowerCase()} signature pad`}
              data-tip="Sign on a bigger pad"
              className="absolute right-[8px] top-[8px] inline-flex h-[32px] w-[32px] cursor-pointer items-center justify-center rounded-full border-0 bg-fill2 text-mut hover:text-ink"
            >
              <Maximize2 size={14} strokeWidth={2} />
            </button>
          </Surface>
          {/* One thing in the footer at a time. Until the pen touches, it
              says who is signing; once there is ink, it offers Clear and
              Done. Both at once crushed the name to a letter in a narrow
              column and showed two greyed buttons with nothing to do. The
              buttons are finger-sized because this is signed on a phone at
              the tailgate as often as at a desk. */}
          <div className="flex h-[44px] items-center justify-between gap-[8px] border-t border-linesoft pl-[12px] pr-[4px] @container">
            {dirty ? (
              <>
                {/* The name was on show until the pen touched; in a narrow
                    column it gives its room to the buttons. */}
                {!row && <span className="hidden truncate font-meta text-[12px] text-mut @[300px]:block">{name || 'Not assigned'}</span>}
                <span className="ml-auto flex shrink-0 items-center gap-[2px]">
                  <button type="button" onClick={() => small.current?.clear()} className={`${btn} bg-transparent px-[10px] text-tealtext`}>
                    Clear
                  </button>
                  <button type="button" onClick={() => { const img = small.current?.image(); if (img) sign(img) }} className={`${btn} bg-ink text-white`}>
                    Done
                  </button>
                </span>
              </>
            ) : (
              <span className="truncate font-meta text-[12px] text-mut">
                {row ? 'Draw here, or open the bigger pad.'
                  : name ? <>Signing as <span className="font-semibold text-ink">{name}</span></> : 'Not assigned'}
              </span>
            )}
          </div>
        </div>
      )}

      <Dialog
        open={confirming}
        title="Replace this signature?"
        subtitle={value ? `${label} · ${value.name} · signed ${fmtDate(value.at)}` : undefined}
        onClose={() => { setConfirming(false); setSkip(false) }}
        width={440}
        footer={
          <>
            <GhostButton onClick={() => { setConfirming(false); setSkip(false) }}>Keep it</GhostButton>
            <PrimaryButton tone="danger" onClick={() => { if (skip) snoozeResign(); setConfirming(false); setSkip(false); onChange(undefined) }}>
              Re-sign
            </PrimaryButton>
          </>
        }
      >
        {/* The thing being wiped, so it is a signature being thrown away and
            not a button being pressed. */}
        {value && (
          <div className="relative rounded-[10px] border border-line bg-paper">
            <img src={value.image} alt={`${value.name}'s signature`} className="block h-[120px] w-full object-contain opacity-80" />
            <Baseline />
          </div>
        )}
        <p className="m-0 mt-[12px] text-[13px] leading-[1.5] text-lab">
          It is wiped and {value?.name ?? 'the signer'} signs again. Nothing else on the record changes.
        </p>
        <label className="mt-[12px] flex cursor-pointer items-start gap-[9px] rounded-[8px] border border-line bg-paper px-[10px] py-[8px] text-[13px] leading-[1.4] text-ink">
          <input
            type="checkbox"
            checked={skip}
            onChange={(e) => setSkip(e.target.checked)}
            className="mt-[2px] h-[15px] w-[15px] shrink-0 cursor-pointer accent-ink"
          />
          <span>
            <span className="block font-semibold">I know what I’m doing</span>
            <span className="block font-meta text-[12px] text-mut">Don’t ask again for the next 5 minutes on any pad.</span>
          </span>
        </label>
      </Dialog>

      {/* The big pad, after the way Jobber collects a signature on site and
          Apple Notes draws one: a plain white surface with a thin baseline
          and an × at its foot, "Sign here" faint in the middle until the pen
          touches, Clear beside a Confirm button. On an upright phone the
          whole sheet is turned sideways so the long edge is the signature.
          It scales up out of the small pad and back down into it. */}
      {expanded && (
        <div
          role="dialog"
          aria-label={`${label} signature`}
          className="fixed left-0 top-0 z-[1100] bg-white"
          onAnimationEnd={(e) => { if (phase === 'closing') { e.stopPropagation(); setPhase('closed') } }}
          style={rotated
            // Laid out as a landscape screen (height × width), then turned a
            // quarter turn anticlockwise so its top runs down the left edge -
            // the way the phone reads once it is turned clockwise in the hand.
            ? { width: size.h, height: size.w, transformOrigin: 'top left', transform: 'rotate(-90deg) translateX(-100%)' }
            : { width: size.w || '100vw', height: size.h || '100vh' }}
        >
          {/* The animation lives on an inner frame so it scales about the
              centre whatever way the outer one is turned. */}
          <div className={`${phase === 'closing' ? 'sig-out' : 'sig-in'} flex h-full w-full flex-col`}>
          <div className="flex items-center gap-[10px] px-[12px] py-[10px]">
            <button type="button" onClick={closeBig} aria-label="Close without signing" className="inline-flex h-[36px] w-[36px] cursor-pointer items-center justify-center rounded-full border-0 bg-fill2 text-ink">
              <X size={17} strokeWidth={2} />
            </button>
            <span className="min-w-0 flex-1 text-center">
              <span className="block text-[15px] font-semibold leading-[1.2]">{label}</span>
              <span className="block truncate font-meta text-[12px] text-mut">{name || 'Not assigned'}</span>
            </span>
            {/* Two words and a picture, not a sentence. */}
            <span className={`inline-flex h-[36px] w-[80px] items-center justify-end gap-[5px] font-meta text-[11px] font-semibold uppercase tracking-[.05em] text-faint ${rotated ? '' : 'invisible'}`} aria-hidden={!rotated}>
              <RotateCw size={13} strokeWidth={2} /> Turn phone
            </span>
          </div>
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-[16px] py-[6px]">
            <Surface ref={big} label={label} fill rotated={rotated} onDirty={setBigDirty}>
              <Baseline />
              {!bigDirty && (
                <span aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center font-meta text-[15px] text-faint">
                  Sign here
                </span>
              )}
            </Surface>
          </div>
          <div className="flex items-center gap-[10px] px-[16px] py-[12px] pb-[max(12px,env(safe-area-inset-bottom))]">
            <button type="button" onClick={() => big.current?.clear()} disabled={!bigDirty} className="h-[44px] cursor-pointer rounded-[10px] border-0 bg-transparent px-[14px] font-meta text-[14px] font-semibold text-tealtext disabled:opacity-40">
              Clear
            </button>
            <button
              type="button"
              disabled={!bigDirty}
              onClick={() => { const img = big.current?.image(); if (img) { sign(img); closeBig() } }}
              className="h-[44px] flex-1 cursor-pointer rounded-[10px] border-0 bg-ink px-[16px] font-meta text-[14px] font-semibold text-white transition-transform active:scale-[.98] disabled:opacity-40"
            >
              Confirm signature
            </button>
          </div>
          </div>
        </div>
      )}
    </div>
  )
}

/** The line to sign on, with the × at its foot - Apple Notes' cue, which
 *  everyone already reads as "sign here". */
function Baseline() {
  return (
    <span aria-hidden className="pointer-events-none absolute inset-x-[12px] bottom-[22%] flex items-end gap-[8px]">
      <X size={13} strokeWidth={2} className="mb-[-6px] shrink-0 text-faint" />
      <span className="h-px flex-1 bg-line" />
    </span>
  )
}

interface SurfaceHandle {
  clear: () => void
  /** The drawing as a PNG data URL, or null when nothing has been drawn. */
  image: () => string | null
}

/**
 * The canvas and the pen. Draws at device resolution so a phone signature
 * is not a blurry one; `fill` lets it take whatever height its parent gives
 * it (the full-screen pad), otherwise it is a fixed strip.
 */
/** Width to height of every pad and of the signed image. One shape, so the
 *  full-screen pad and the strip it is shown in agree. */
const ASPECT = 2.4

const Surface = forwardRef<SurfaceHandle, { label: string; fill?: boolean; rotated?: boolean; onDirty: (d: boolean) => void; children?: React.ReactNode }>(
  function Surface({ label, fill = false, rotated = false, onDirty, children }, ref) {
    const canvas = useRef<HTMLCanvasElement>(null)
    const box = useRef<HTMLDivElement>(null)
    const drawing = useRef(false)
    const dirty = useRef(false)

    useEffect(() => {
      const el = canvas.current
      if (!el) return
      const fit = () => {
        const scale = window.devicePixelRatio || 1
        const frame = box.current
        if (fill && frame?.parentElement) {
          // As large as the parent allows at the fixed shape: width-bound in
          // portrait, height-bound in landscape. clientWidth/Height, not the
          // bounding rect: a turned pad's rect is its rotated footprint.
          const parent = frame.parentElement
          const cs = getComputedStyle(parent)
          const pw = parent.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)
          const ph = parent.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)
          const w = Math.max(0, Math.min(pw, ph * ASPECT))
          frame.style.width = `${w}px`
          frame.style.height = `${w / ASPECT}px`
        }
        const w = el.clientWidth
        const h = el.clientHeight
        if (el.width === w * scale && el.height === h * scale) return
        el.width = w * scale
        el.height = h * scale
        const ctx = el.getContext('2d')
        if (ctx) {
          ctx.scale(scale, scale)
          ctx.lineWidth = fill ? 3 : 2
          ctx.lineCap = 'round'
          ctx.lineJoin = 'round'
          ctx.strokeStyle = '#14181b'
        }
        dirty.current = false
        onDirty(false)
      }
      fit()
      // The full-screen pad resizes with the phone turning; a resize blanks
      // the canvas, so whatever was drawn has to be redone.
      const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(fit) : null
      ro?.observe(fill && box.current?.parentElement ? box.current.parentElement : el)
      return () => ro?.disconnect()
    }, [fill, onDirty])

    useImperativeHandle(ref, () => ({
      clear: () => {
        const el = canvas.current
        const ctx = el?.getContext('2d')
        if (el && ctx) ctx.clearRect(0, 0, el.width, el.height)
        dirty.current = false
        onDirty(false)
      },
      image: () => (dirty.current && canvas.current ? canvas.current.toDataURL('image/png') : null),
    }), [onDirty])

    const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
      const r = e.currentTarget.getBoundingClientRect()
      // On the turned pad the canvas's own x runs up the screen and its y runs
      // to the right; the bounding box is the axis-aligned one, so map back.
      if (rotated) return { x: r.bottom - e.clientY, y: e.clientX - r.left }
      return { x: e.clientX - r.left, y: e.clientY - r.top }
    }
    const start = (e: React.PointerEvent<HTMLCanvasElement>) => {
      const ctx = canvas.current?.getContext('2d')
      if (!ctx) return
      e.currentTarget.setPointerCapture(e.pointerId)
      const p = point(e)
      ctx.beginPath()
      ctx.moveTo(p.x, p.y)
      drawing.current = true
    }
    const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!drawing.current) return
      const ctx = canvas.current?.getContext('2d')
      if (!ctx) return
      const p = point(e)
      ctx.lineTo(p.x, p.y)
      ctx.stroke()
      if (!dirty.current) { dirty.current = true; onDirty(true) }
    }
    const end = () => { drawing.current = false }

    return (
      <div ref={box} className={`relative ${fill ? '' : 'w-full'}`} style={fill ? undefined : { aspectRatio: String(ASPECT) }}>
        <canvas
          ref={canvas}
          role="img"
          aria-label={`${label} signature pad`}
          className="absolute inset-0 block h-full w-full cursor-crosshair touch-none rounded-[10px] bg-white"
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerLeave={end}
          onPointerCancel={end}
        />
        {children}
      </div>
    )
  },
)
