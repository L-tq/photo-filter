import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useT } from '../i18n'

interface Props {
  original: HTMLCanvasElement
  filtered: HTMLCanvasElement
  /** Intrinsic pixel size of the preview canvases (fit is computed from these). */
  naturalW: number
  naturalH: number
  /** Localized label of the active filter, shown on the left (filtered) side. */
  filterLabel: string
  /** While true the original is shown full-frame. */
  hold: boolean
}

const MAX_ZOOM = 8
const MIN_ZOOM = 1

interface ZoomState {
  /** Scale relative to fit-to-view. */
  s: number
  /** Extra pan offset in viewport pixels. */
  x: number
  y: number
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

export default function CompareSlider({ original, filtered, naturalW, naturalH, filterLabel, hold }: Props) {
  const t = useT()
  const viewportRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const topRef = useRef<HTMLDivElement>(null)

  const [vp, setVp] = useState({ w: 0, h: 0 })
  const [pos, setPos] = useState(50) // divider position, % of image width
  const [zoom, setZoom] = useState<ZoomState>({ s: 1, x: 0, y: 0 })
  const [panning, setPanning] = useState(false)
  const dragRef = useRef<{ mode: 'divider' | 'pan'; startX: number; startY: number; baseX: number; baseY: number } | null>(null)

  // mount the two canvases
  useEffect(() => {
    const b = bottomRef.current
    const tp = topRef.current
    if (!b || !tp) return
    b.appendChild(original)
    tp.appendChild(filtered)
    return () => {
      original.remove()
      filtered.remove()
    }
  }, [original, filtered])

  // reset view when the photo changes
  useEffect(() => {
    setZoom({ s: 1, x: 0, y: 0 })
    setPos(50)
  }, [original, filtered])

  // track viewport size
  useLayoutEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const measure = () => setVp({ w: el.clientWidth, h: el.clientHeight })
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    measure()
    return () => ro.disconnect()
  }, [])

  // geometry: fit-size of the image, then zoomed placement
  const fit = Math.min(1, (vp.w - 12) / naturalW || 1, (vp.h - 12) / naturalH || 1)
  const dw = Math.max(1, Math.round(naturalW * fit))
  const dh = Math.max(1, Math.round(naturalH * fit))
  const w = dw * zoom.s
  const h = dh * zoom.s
  const left = w <= vp.w ? (vp.w - w) / 2 : clamp((vp.w - w) / 2 + zoom.x, vp.w - w, 0)
  const top = h <= vp.h ? (vp.h - h) / 2 : clamp((vp.h - h) / 2 + zoom.y, vp.h - h, 0)

  const placement = (s: number, x: number, y: number) => {
    const w2 = dw * s
    const h2 = dh * s
    return {
      left: w2 <= vp.w ? (vp.w - w2) / 2 : clamp((vp.w - w2) / 2 + x, vp.w - w2, 0),
      top: h2 <= vp.h ? (vp.h - h2) / 2 : clamp((vp.h - h2) / 2 + y, vp.h - h2, 0),
    }
  }

  /** Zoom to `ns`, keeping the content point under viewport (cx, cy) fixed. */
  const zoomTo = (ns: number, cx: number, cy: number) => {
    setZoom((z) => {
      const target = clamp(ns, MIN_ZOOM, MAX_ZOOM)
      if (target === z.s) return z
      const cur = placement(z.s, z.x, z.y)
      const px = (cx - cur.left) / z.s
      const py = (cy - cur.top) / z.s
      const w3 = dw * target
      const h3 = dh * target
      let l3 = cx - px * target
      let t3 = cy - py * target
      l3 = w3 <= vp.w ? (vp.w - w3) / 2 : clamp(l3, vp.w - w3, 0)
      t3 = h3 <= vp.h ? (vp.h - h3) / 2 : clamp(t3, vp.h - h3, 0)
      return { s: target, x: l3 - (vp.w - w3) / 2, y: t3 - (vp.h - h3) / 2 }
    })
  }

  // wheel zoom needs a non-passive native listener (React's is passive)
  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      zoomTo(zoom.s * Math.exp(-e.deltaY * 0.0016), e.clientX - rect.left, e.clientY - rect.top)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  })

  const setDividerFromClientX = (clientX: number) => {
    const rect = viewportRef.current?.getBoundingClientRect()
    if (!rect) return
    setPos(clamp(((clientX - rect.left - left) / w) * 100, 0, 100))
  }

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    const onHandle = (e.target as HTMLElement).closest('.handle') !== null
    const mode: 'divider' | 'pan' = onHandle || zoom.s <= 1 ? 'divider' : 'pan'
    dragRef.current = { mode, startX: e.clientX, startY: e.clientY, baseX: zoom.x, baseY: zoom.y }
    if (mode === 'pan') setPanning(true)
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current
    if (!d) return
    if (d.mode === 'divider') {
      setDividerFromClientX(e.clientX)
    } else {
      setZoom((z) => ({ ...z, x: d.baseX + (e.clientX - d.startX), y: d.baseY + (e.clientY - d.startY) }))
    }
  }

  const endDrag = () => {
    dragRef.current = null
    setPanning(false)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (zoom.s <= 1) return
    const step = 60
    if (e.key === 'ArrowLeft') setZoom((z) => ({ ...z, x: z.x + step }))
    if (e.key === 'ArrowRight') setZoom((z) => ({ ...z, x: z.x - step }))
    if (e.key === 'ArrowUp') setZoom((z) => ({ ...z, y: z.y + step }))
    if (e.key === 'ArrowDown') setZoom((z) => ({ ...z, y: z.y - step }))
  }

  const dividerX = left + (w * pos) / 100
  const zoomed = zoom.s > 1.001

  return (
    <div
      ref={viewportRef}
      className={`zoom-viewport${zoomed ? ' zoomed' : ''}${panning ? ' panning' : ''}`}
      tabIndex={0}
      role="application"
      aria-label={`${filterLabel} / ${t('tagOriginal')}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={onKeyDown}
      onDoubleClick={() => (zoomed ? setZoom({ s: 1, x: 0, y: 0 }) : zoomTo(2, vp.w / 2, vp.h / 2))}
    >
      <div
        className="zoom-content"
        style={{
          width: dw,
          height: dh,
          left,
          top,
          transform: `scale(${zoom.s})`,
          transformOrigin: '0 0',
        }}
      >
        <div ref={bottomRef} className="layer" />
        <div
          ref={topRef}
          className="layer top"
          style={{ clipPath: hold ? 'inset(0 100% 0 0)' : `inset(0 ${100 - pos}% 0 0)` }}
        />
      </div>

      <div className="compare-overlay">
        <span className="tag left" style={{ left: left + 10, top: top + 10 }}>
          {filterLabel}
        </span>
        <span className="tag right" style={{ left: left + w - 10, top: top + 10 }}>
          {t('tagOriginal')}
        </span>
        <div className="divider" style={{ left: dividerX, top, height: h, opacity: hold ? 0 : 1 }} />
        <div
          className="handle"
          role="slider"
          tabIndex={0}
          aria-label={t('tagOriginal')}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(hold ? 100 : pos)}
          style={{ left: dividerX, top: top + h / 2, opacity: hold ? 0 : 0.95 }}
          onDoubleClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft') setPos((p) => clamp(p - 3, 0, 100))
            if (e.key === 'ArrowRight') setPos((p) => clamp(p + 3, 0, 100))
          }}
        >
          ⇄
        </div>
      </div>

      <div
        className="zoom-controls"
        onPointerDown={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
      >
        <button aria-label={t('zoomOut')} title={t('zoomOut')} onClick={() => zoomTo(zoom.s / 1.25, vp.w / 2, vp.h / 2)}>
          −
        </button>
        <span className="zoom-pct">{Math.round(zoom.s * 100)}%</span>
        <button aria-label={t('zoomIn')} title={t('zoomIn')} onClick={() => zoomTo(zoom.s * 1.25, vp.w / 2, vp.h / 2)}>
          +
        </button>
        <button
          className="fit"
          aria-label={t('zoomFit')}
          title={t('zoomFit')}
          onClick={() => setZoom({ s: 1, x: 0, y: 0 })}
        >
          ⤢
        </button>
      </div>
    </div>
  )
}
