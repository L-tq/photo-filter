/**
 * Black Mist / White Mist filter rendering.
 *
 * Both are diffusion looks: the image is blurred (GPU-accelerated ctx.filter),
 * then the blurred copy is screen-blended back. White Mist lifts the blacks
 * into a dreamy veil; Black Mist keeps blacks deep with a contrast S-curve
 * and slight desaturation (classic Pro-Mist lens behaviour).
 *
 * `renderMist` works at any resolution — the blur radius scales with the
 * canvas' larger dimension so a preview matches the full-resolution export.
 */

export type FilterKind = 'none' | 'blackMist' | 'whiteMist'

export interface FilterParams {
  /** Blend amount of the diffusion, 0..1. */
  strength: number
  /** Blur radius as a fraction of the larger image dimension, 0..1. */
  diffusion: number
  /** 0 = veil over the whole image, 1 = bloom highlights only, 0..1. */
  bloom: number
}

export const DEFAULT_PARAMS: FilterParams = { strength: 0.55, diffusion: 0.5, bloom: 0.65 }

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}

export function supportsCanvasBlur(): boolean {
  try {
    const ctx = document.createElement('canvas').getContext('2d')!
    ctx.filter = 'blur(2px)'
    return ctx.filter !== 'none' && ctx.filter !== ''
  } catch {
    return false
  }
}

/** Blur via ctx.filter, with a downscale/upscale fallback when unsupported. */
function blurredCopy(src: HTMLCanvasElement, radius: number): HTMLCanvasElement {
  const w = src.width
  const h = src.height
  const out = document.createElement('canvas')
  out.width = w
  out.height = h
  const ctx = out.getContext('2d')!
  if (supportsCanvasBlur()) {
    ctx.filter = `blur(${radius.toFixed(2)}px)`
    ctx.drawImage(src, 0, 0)
    ctx.filter = 'none'
    return out
  }
  // Fallback: repeated minification gives a smooth bilinear approximation.
  const shift = Math.max(1, Math.round(Math.log2(radius / 2)))
  const dw = Math.max(1, w >> shift)
  const dh = Math.max(1, h >> shift)
  const small = document.createElement('canvas')
  small.width = dw
  small.height = dh
  const sctx = small.getContext('2d')!
  sctx.imageSmoothingEnabled = true
  sctx.drawImage(src, 0, 0, dw, dh)
  ctx.imageSmoothingEnabled = true
  ctx.drawImage(small, 0, 0, w, h)
  return out
}

export function renderMist(
  src: CanvasImageSource,
  width: number,
  height: number,
  kind: FilterKind,
  p: FilterParams,
): HTMLCanvasElement {
  const base = document.createElement('canvas')
  base.width = width
  base.height = height
  const bctx = base.getContext('2d', { willReadFrequently: true })!
  bctx.drawImage(src, 0, 0, width, height)
  if (kind === 'none') return base

  const radius = Math.max(1.5, p.diffusion * 0.03 * Math.max(width, height))
  const glow = blurredCopy(base, radius)

  const baseData = bctx.getImageData(0, 0, width, height)
  const glowData = glow.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, width, height)
  const bd = baseData.data
  const gd = glowData.data

  const s = Math.min(1, Math.max(0, p.strength))
  const bloom = Math.min(1, Math.max(0, p.bloom))
  const black = kind === 'blackMist'
  const contrast = 1 + 0.32 * s
  const desat = 1 - 0.12 * s
  const veil = 0.035 * s

  for (let i = 0; i < bd.length; i += 4) {
    const gr = gd[i] / 255
    const gg = gd[i + 1] / 255
    const gb = gd[i + 2] / 255
    const lumGlow = 0.299 * gr + 0.587 * gg + 0.114 * gb
    const hi = smoothstep(0.55, 0.85, lumGlow)
    const mask = 1 - bloom * (1 - hi)
    const a = s * mask

    // screen blend with the masked glow
    let r = 1 - (1 - bd[i] / 255) * (1 - gr * a)
    let g = 1 - (1 - bd[i + 1] / 255) * (1 - gg * a)
    let b = 1 - (1 - bd[i + 2] / 255) * (1 - gb * a)

    if (black) {
      // S-curve restores blacks, slight desaturation → Pro-Mist character
      r = 0.5 + (r - 0.5) * contrast
      g = 0.5 + (g - 0.5) * contrast
      b = 0.5 + (b - 0.5) * contrast
      const l = 0.299 * r + 0.587 * g + 0.114 * b
      r = l + (r - l) * desat
      g = l + (g - l) * desat
      b = l + (b - l) * desat
    } else {
      // gentle veil that lifts shadows without clipping highlights
      r += veil * (1 - r)
      g += veil * (1 - g)
      b += veil * (1 - b)
    }

    bd[i] = r <= 0 ? 0 : r >= 1 ? 255 : (r * 255 + 0.5) | 0
    bd[i + 1] = g <= 0 ? 0 : g >= 1 ? 255 : (g * 255 + 0.5) | 0
    bd[i + 2] = b <= 0 ? 0 : b >= 1 ? 255 : (b * 255 + 0.5) | 0
  }

  bctx.putImageData(baseData, 0, 0)
  return base
}
