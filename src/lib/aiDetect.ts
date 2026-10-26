/**
 * AI-metadata detection.
 *
 * Scans EXIF text fields, XMP packets, JPEG comments and C2PA manifests for
 * markers of AI generation or editing. Two strictness tiers: `tool` for fields
 * that name software (full keyword list) and `text` for free-text fields
 * (only unambiguous markers, to avoid false positives like "fireflies").
 */

import { decodeAscii, decodeUserComment, findIfd, type IfdPath, type TiffFile } from './tiff'

export interface AiFinding {
  where: 'exif' | 'xmp' | 'c2pa' | 'comment'
  tagName: string
  /** Display value or parameter (e.g. byte count for C2PA). */
  value: string
  /** i18n key describing why this is AI-related. */
  key: AiReasonKey
  /** Matched keyword, interpolated into the localized reason. */
  keyword?: string
  severity: 'ai' | 'provenance'
  /** Present for EXIF findings → the tag deleted on export. */
  exifTag?: { ifd: IfdPath; tag: number }
}

export type AiReasonKey =
  | 'reasonExifSoftware'
  | 'reasonExifText'
  | 'reasonComment'
  | 'reasonXmpSource'
  | 'reasonXmpTool'
  | 'reasonXmpText'
  | 'reasonC2paAi'
  | 'reasonC2pa'

export type KeywordTier = 'tool' | 'text'

const TOOL_KEYWORDS = [
  'dall[·\\-\\s]?e', 'midjourney', 'stable[\\-\\s]?diffusion', 'sdxl', 'comfyui',
  'automatic1111', 'invoke[\\-\\s]?ai', 'invokeai', 'firefly', 'flux(\\.?1)?',
  'imagen', 'gemini', 'nano[\\s\\-]?banana', 'grok', 'ideogram', 'recraft',
  'leonardo\\.ai', 'runway(ml)?', 'sora', 'krea', 'gigagan', 'nightcafe',
  'starryai', 'deepai', 'craiyon', 'artbreeder', 'synthid',
  'trainedalgorithmicmedia', 'algorithmicmedia',
  'generative[\\s\\-]?(ai|model|fill|expand|edit|remove)',
  'ai[\\s\\-]?(generated|edited|assisted|enhanced|image|photo|model|tool)',
  'artificial[\\s\\-]?intelligence',
  '(created|made|generated|edited|processed|upscaled|retouched|enhanced)[\\s\\-]+(with|by|using)[\\s\\-]+ai\\b',
  '(with|by)[\\s\\-]+ai\\b',
]

/** Ambiguous words (firefly, gemini, runway, …) are excluded from free text. */
const TEXT_KEYWORDS = [
  'dall[·\\-\\s]?e', 'midjourney', 'stable[\\-\\s]?diffusion', 'sdxl', 'comfyui',
  'automatic1111', 'invoke[\\s\\-]?ai', 'nano[\\s\\-]?banana', 'ideogram',
  'recraft', 'leonardo\\.ai', 'nightcafe', 'craiyon', 'synthid',
  'trainedalgorithmicmedia', 'algorithmicmedia',
  'generative[\\s\\-]?(ai|model|fill|expand|edit|remove)',
  'ai[\\s\\-]?(generated|edited|assisted|enhanced|image|photo|model|tool)',
  'artificial[\\s\\-]?intelligence',
  '(created|made|generated|edited|processed|upscaled|retouched|enhanced)[\\s\\-]+(with|by|using)[\\s\\-]+ai\\b',
  '(with|by)[\\s\\-]+ai\\b',
]

const REGEXES: Record<KeywordTier, RegExp> = {
  tool: new RegExp(TOOL_KEYWORDS.join('|'), 'i'),
  text: new RegExp(TEXT_KEYWORDS.join('|'), 'i'),
}

/** Returns the matched keyword, or null. */
export function aiMatch(text: string, tier: KeywordTier): string | null {
  const m = REGEXES[tier].exec(text)
  return m ? m[0] : null
}

export interface AiScanInput {
  tiff: TiffFile | null
  xmp: string | null
  c2paPayloads: Uint8Array[]
  comment?: string
}

function snippet(text: string): string {
  const t = text.trim().replace(/\s+/g, ' ')
  return t.length > 120 ? t.slice(0, 117) + '…' : t
}

function latin1(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.byteLength; i++) s += String.fromCharCode(bytes[i])
  return s
}

export function detectAi(input: AiScanInput): AiFinding[] {
  const out: AiFinding[] = []

  if (input.tiff) {
    const checks: { ifd: IfdPath; tag: number; name: string; tier: KeywordTier }[] = [
      { ifd: 'ifd0', tag: 0x0131, name: 'Software', tier: 'tool' },
      { ifd: 'ifd0', tag: 0x010e, name: 'ImageDescription', tier: 'text' },
      { ifd: 'ifd0', tag: 0x013b, name: 'Artist', tier: 'text' },
      { ifd: 'ifd0', tag: 0x8298, name: 'Copyright', tier: 'text' },
      { ifd: 'exif', tag: 0x9286, name: 'UserComment', tier: 'text' },
    ]
    for (const c of checks) {
      const ifd = findIfd(input.tiff, c.ifd)
      const e = ifd?.entries.find((x) => x.tag === c.tag)
      if (!e) continue
      const text = c.tag === 0x9286 ? decodeUserComment(e.value) : decodeAscii(e.value)
      const kw = aiMatch(text, c.tier)
      if (kw) {
        out.push({
          where: 'exif',
          tagName: c.name,
          value: snippet(text),
          key: c.tag === 0x0131 ? 'reasonExifSoftware' : 'reasonExifText',
          keyword: kw,
          severity: 'ai',
          exifTag: { ifd: c.ifd, tag: c.tag },
        })
      }
    }
  }

  // XMP findings are produced alongside filtering in xmp.ts (avoid a cycle:
  // detectAi is called with pre-computed xmp findings).
  if (input.comment) {
    const kw = aiMatch(input.comment, 'text')
    if (kw) {
      out.push({
        where: 'comment',
        tagName: 'Comment',
        value: snippet(input.comment),
        key: 'reasonComment',
        keyword: kw,
        severity: 'ai',
      })
    }
  }

  for (const payload of input.c2paPayloads) {
    const text = latin1(payload).slice(0, 65536)
    const kw = aiMatch(text, 'tool')
    out.push({
      where: 'c2pa',
      tagName: 'C2PA manifest',
      value: String(payload.byteLength),
      key: kw ? 'reasonC2paAi' : 'reasonC2pa',
      keyword: kw || undefined,
      severity: kw ? 'ai' : 'provenance',
    })
  }

  return out
}
