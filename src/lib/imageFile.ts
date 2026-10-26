/**
 * Orchestration: load a photo, read its metadata, and export a new file with
 * filters applied (at the original resolution), EXIF edits applied, and
 * AI-related metadata removed. When no filter is selected the original
 * compressed bytes are reused, so an unedited export is lossless.
 */

import { detectAi, type AiFinding } from './aiDetect'
import * as jpeg from './jpeg'
import * as png from './png'
import type { Lang } from '../i18n'
import { translate } from '../i18n'
import {
  asciiEntry,
  approxRational,
  buildTiff,
  cloneTiff,
  decimalToDms,
  decodeRationals,
  deleteEntry,
  dmsToDecimal,
  findIfd,
  longEntry,
  parseTiff,
  rationalEntry,
  readU32,
  shortEntry,
  upsertEntry,
  GPS_LATITUDE,
  GPS_LATITUDE_REF,
  GPS_LONGITUDE,
  GPS_LONGITUDE_REF,
  TAG_THUMB_LENGTH,
  TYPE_ASCII,
  TYPE_BYTE,
  TYPE_LONG,
  TYPE_RATIONAL,
  TYPE_SHORT,
  TYPE_SRATIONAL,
  type IfdPath,
  type TiffFile,
} from './tiff'
import { analyzeXmp, summarizeXmp } from './xmp'
import { editKind, formatEntryValue, groupOf, tagName, TAG_USER_COMMENT, type EditKind, type ExifGroup } from './exifDb'
import { renderMist, type FilterKind, type FilterParams } from './filters'

export type PhotoWarning = 'warnJpegUnparsed' | 'warnPngUnparsed'

/** Load failures carry a localized error code; the UI renders the message. */
export type LoadErrorCode = 'errUnsupported' | 'errDecode'

export interface LoadedPhoto {
  fileName: string
  kind: 'jpeg' | 'png'
  bytes: Uint8Array
  bitmap: ImageBitmap
  width: number
  height: number
  jpeg: jpeg.JpegFile | null
  png: png.PngFile | null
  tiff: TiffFile | null
  xmp: string | null
  /** XMP packet with AI nodes removed (null → nothing was removed). */
  xmpFiltered: string | null
  c2paPayloads: Uint8Array[]
  iccPayloads: Uint8Array[]
  comment: string | null
  aiFindings: AiFinding[]
  warnings: PhotoWarning[]
}

export async function loadPhoto(file: File): Promise<LoadedPhoto> {
  const raw = new Uint8Array(await file.arrayBuffer())
  const isJpeg = raw[0] === 0xff && raw[1] === 0xd8
  const isPng =
    raw[0] === png.PNG_SIG[0] && raw[1] === png.PNG_SIG[1] && raw[2] === png.PNG_SIG[2] && raw[3] === png.PNG_SIG[3]
  if (!isJpeg && !isPng) {
    throw Object.assign(new Error('Unsupported format'), { code: 'errUnsupported' as const })
  }

  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(new Blob([raw], { type: isJpeg ? 'image/jpeg' : 'image/png' }))
  } catch {
    throw Object.assign(new Error('Decode failed'), { code: 'errDecode' as const })
  }

  const warnings: PhotoWarning[] = []
  let tiff: TiffFile | null = null
  let xmp: string | null = null
  let comment: string | null = null
  const c2paPayloads: Uint8Array[] = []
  const iccPayloads: Uint8Array[] = []

  const jf = isJpeg ? jpeg.parseJpeg(raw) : null
  const pf = isPng ? png.parsePng(raw) : null
  if (isJpeg && !jf) warnings.push('warnJpegUnparsed')
  if (isPng && !pf) warnings.push('warnPngUnparsed')

  if (jf) {
    for (const s of jf.segments) {
      if (jpeg.isExifSegment(s)) {
        tiff ??= parseTiff(s.payload.subarray(jpeg.EXIF_SIG.byteLength))
      } else if (jpeg.isXmpSegment(s)) {
        xmp ??= jpeg.xmpSegmentText(s.payload)
      } else if (jpeg.isC2paSegment(s)) {
        c2paPayloads.push(s.payload)
      } else if (jpeg.isIccSegment(s)) {
        iccPayloads.push(s.payload)
      } else if (s.marker === jpeg.COM) {
        comment ??= jpeg.payloadText(s.payload)
      }
    }
  }
  if (pf) {
    for (const c of pf.chunks) {
      if (c.type === 'eXIf') {
        tiff ??= parseTiff(c.data)
      } else if (png.isXmpChunk(c)) {
        xmp ??= png.xmpChunkText(c)
      } else if (png.isC2paChunk(c)) {
        c2paPayloads.push(c.data)
      }
    }
  }

  const xmpRes = xmp !== null ? analyzeXmp(xmp) : null
  const findings = detectAi({ tiff, xmp: null, c2paPayloads, comment: comment ?? undefined })
  if (xmpRes) findings.push(...xmpRes.findings)
  findings.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'ai' ? -1 : 1))

  return {
    fileName: file.name,
    kind: isJpeg ? 'jpeg' : 'png',
    bytes: raw,
    bitmap,
    width: bitmap.width,
    height: bitmap.height,
    jpeg: jf,
    png: pf,
    tiff,
    xmp,
    xmpFiltered: xmpRes?.filteredXml ?? null,
    c2paPayloads,
    iccPayloads,
    comment,
    aiFindings: findings,
    warnings,
  }
}

// ---------------------------------------------------------------- EXIF table

export interface ExifRow {
  id: string
  ifd: IfdPath
  tag: number
  name: string
  group: ExifGroup
  display: string
  editKind: EditKind
  ai?: AiFinding
}

export interface XmpRow {
  name: string
  value: string
  ai?: AiFinding
}

function gpsDisplay(tiff: TiffFile, ifd: NonNullable<ReturnType<typeof findIfd>>, tag: number): string | null {
  const e = ifd.entries.find((x) => x.tag === tag)
  if (!e) return null
  const refTag = tag === GPS_LATITUDE ? GPS_LATITUDE_REF : GPS_LONGITUDE_REF
  const ref = ifd.entries.find((x) => x.tag === refTag)
  const refText = ref ? String.fromCharCode(ref.value[0] ?? 0) : ''
  const pairs = decodeRationals(e, tiff.littleEndian)
  if (pairs.length !== 3) return null
  const dec = dmsToDecimal(pairs, refText)
  return `${dec.toFixed(6)}°${refText || ''}`
}

export function buildExifRows(photo: LoadedPhoto, lang: Lang = 'en'): ExifRow[] {
  const rows: ExifRow[] = []
  if (!photo.tiff) return rows
  const tiff = photo.tiff
  const aiByTag = new Map(
    photo.aiFindings.filter((f) => f.exifTag).map((f) => [`${f.exifTag!.ifd}:${f.exifTag!.tag}`, f]),
  )
  for (const ifdPath of ['ifd0', 'exif', 'interop', 'gps', 'ifd1'] as IfdPath[]) {
    const ifd = findIfd(tiff, ifdPath)
    if (!ifd) continue
    for (const e of ifd.entries) {
      const id = `${ifdPath}:${e.tag}`
      let display: string
      const kind = editKind(ifdPath, e)
      if (kind === 'gps-lat' || kind === 'gps-lon') {
        display = gpsDisplay(tiff, ifd, e.tag) ?? formatEntryValue(tiff.littleEndian, e, ifdPath, lang)
      } else if (ifdPath === 'ifd1' && e.tag === TAG_THUMB_LENGTH) {
        display = translate(lang, 'valueThumb', { n: readU32(e.value, 0, tiff.littleEndian).toLocaleString() })
      } else {
        display = formatEntryValue(tiff.littleEndian, e, ifdPath, lang)
      }
      rows.push({
        id,
        ifd: ifdPath,
        tag: e.tag,
        name: tagName(ifdPath, e.tag),
        group: groupOf(ifdPath),
        display,
        editKind: kind,
        ai: aiByTag.get(id),
      })
    }
  }
  return rows
}

export function buildXmpRows(photo: LoadedPhoto): XmpRow[] {
  if (photo.xmp === null) return []
  const fields = summarizeXmp(photo.xmp)
  const byName = new Map<string, AiFinding>()
  for (const f of photo.aiFindings) if (f.where === 'xmp') byName.set(f.tagName.toLowerCase(), f)
  return fields.map((f) => ({ ...f, ai: byName.get(f.name.toLowerCase()) }))
}

// ---------------------------------------------------------------- export

export type EditOp = { op: 'set'; text: string } | { op: 'delete' }
export type EditMap = Record<string, EditOp>

export interface ExportOptions {
  kind: FilterKind
  params: FilterParams
  edits: EditMap
  jpegQuality: number
}

export type NoteKey =
  | 'noteLossless'
  | 'noteExifTooLarge'
  | 'noteNoExif'
  | 'noteExifAiRemoved'
  | 'noteC2paRemoved'
  | 'noteXmpCleaned'

export interface ExportNote {
  key: NoteKey
  n?: number
}

export interface ExportResult {
  blob: Blob
  fileName: string
  /** Structured notes — localized by the UI. */
  notes: ExportNote[]
}

function applyUserEdits(t: TiffFile, edits: EditMap): void {
  const le = t.littleEndian
  for (const [id, edit] of Object.entries(edits)) {
    const colon = id.indexOf(':')
    const ifd = findIfd(t, id.slice(0, colon) as IfdPath)
    const tag = parseInt(id.slice(colon + 1), 10)
    if (!ifd || !Number.isFinite(tag)) continue

    if (edit.op === 'delete') {
      deleteEntry(ifd, tag)
      continue
    }
    const text = edit.text

    if (tag === GPS_LATITUDE || tag === GPS_LONGITUDE) {
      const dec = parseFloat(text)
      if (!Number.isFinite(dec) || Math.abs(dec) > 180) continue
      const { pairs, sign } = decimalToDms(dec)
      if (tag === GPS_LATITUDE) {
        upsertEntry(ifd, rationalEntry(GPS_LATITUDE, pairs, le))
        upsertEntry(ifd, asciiEntry(GPS_LATITUDE_REF, sign > 0 ? 'N' : 'S'))
      } else {
        upsertEntry(ifd, rationalEntry(GPS_LONGITUDE, pairs, le))
        upsertEntry(ifd, asciiEntry(GPS_LONGITUDE_REF, sign > 0 ? 'E' : 'W'))
      }
      continue
    }

    if (tag === TAG_USER_COMMENT) {
      const prefix = new Uint8Array(8)
      prefix.set([0x41, 0x53, 0x43, 0x49, 0x49, 0, 0, 0]) // "ASCII\0\0\0"
      const body = new Uint8Array(text.length)
      for (let i = 0; i < text.length; i++) body[i] = text.charCodeAt(i) & 0xff
      const value = new Uint8Array(8 + body.byteLength)
      value.set(prefix)
      value.set(body, 8)
      upsertEntry(ifd, { tag, type: 7, count: value.byteLength, value })
      continue
    }

    const orig = ifd.entries.find((e) => e.tag === tag)
    if (!orig) continue
    if (orig.type === TYPE_ASCII) {
      upsertEntry(ifd, asciiEntry(tag, text))
      continue
    }
    const v = parseFloat(text)
    if (!Number.isFinite(v)) continue
    if (orig.type === TYPE_SHORT) upsertEntry(ifd, shortEntry(tag, Math.round(v), le))
    else if (orig.type === TYPE_LONG) upsertEntry(ifd, longEntry(tag, Math.round(v), le))
    else if (orig.type === TYPE_BYTE) {
      const value = new Uint8Array(1)
      value[0] = Math.round(v) & 0xff
      upsertEntry(ifd, { tag, type: TYPE_BYTE, count: 1, value })
    } else if (orig.type === TYPE_RATIONAL || orig.type === TYPE_SRATIONAL) {
      upsertEntry(ifd, rationalEntry(tag, [approxRational(v)], le))
    }
  }
}

function canvasToBlob(canvas: HTMLCanvasElement, mime: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('The browser failed to encode the image.'))),
      mime,
      quality,
    )
  })
}

export async function exportPhoto(photo: LoadedPhoto, opts: ExportOptions): Promise<ExportResult> {
  const notes: ExportNote[] = []

  // 1. Pixel layer — original bytes unless a filter is applied.
  let pixelBytes: Uint8Array | null = null
  if (opts.kind !== 'none') {
    const canvas = renderMist(photo.bitmap, photo.width, photo.height, opts.kind, opts.params)
    const blob = await canvasToBlob(
      canvas,
      photo.kind === 'jpeg' ? 'image/jpeg' : 'image/png',
      photo.kind === 'jpeg' ? opts.jpegQuality : undefined,
    )
    pixelBytes = new Uint8Array(await blob.arrayBuffer())
  } else {
    notes.push({ key: 'noteLossless' })
  }

  // 2. EXIF: strip AI tags, apply user edits, rebuild with full preservation.
  // When neither is needed the original payload bytes are reused verbatim, so
  // an untouched export stays byte-identical. exifTiff is always the raw TIFF
  // blob (no "Exif\0\0" signature).
  let exifTiff: Uint8Array | null = null
  const aiExifTags = photo.aiFindings.filter((f) => f.exifTag)
  const hasEdits = Object.keys(opts.edits).length > 0
  if (photo.tiff && aiExifTags.length === 0 && !hasEdits) {
    const orig = photo.jpeg?.segments.find(jpeg.isExifSegment)
    const chunk = photo.png?.chunks.find((c) => c.type === 'eXIf')
    if (photo.kind === 'jpeg' && orig) exifTiff = orig.payload.subarray(jpeg.EXIF_SIG.byteLength)
    else if (photo.kind === 'png' && chunk) exifTiff = chunk.data
  }
  if (photo.tiff && exifTiff === null) {
    const t = cloneTiff(photo.tiff)
    let removed = 0
    for (const f of photo.aiFindings) {
      if (f.exifTag) {
        const ifd = findIfd(t, f.exifTag.ifd)
        if (ifd) {
          deleteEntry(ifd, f.exifTag.tag)
          removed++
        }
      }
    }
    if (removed) notes.push({ key: 'noteExifAiRemoved', n: removed })
    applyUserEdits(t, opts.edits)
    const built = buildTiff(t)
    if (photo.kind === 'jpeg' && built.byteLength + 8 > 65533) {
      notes.push({ key: 'noteExifTooLarge' })
    } else {
      exifTiff = built
    }
  }
  if (!photo.tiff) notes.push({ key: 'noteNoExif' })

  // 3. XMP: reuse the original payload bytes unless the packet was AI-filtered.
  // xmpBytes is container-ready (JPEG: sig + packet, PNG: iTXt chunk data).
  let xmpBytes: Uint8Array | null = null
  if (photo.xmp !== null) {
    if (photo.xmpFiltered !== null && photo.xmpFiltered.trim() !== '') {
      xmpBytes =
        photo.kind === 'jpeg'
          ? jpeg.xmpSegmentPayload(photo.xmpFiltered)
          : png.makeXmpChunk(photo.xmpFiltered).data
    } else if (photo.xmpFiltered !== null) {
      xmpBytes = null // packet emptied → drop it entirely
    } else {
      const orig = photo.jpeg?.segments.find(jpeg.isXmpSegment)
      const chunk = photo.png?.chunks.find(png.isXmpChunk)
      if (photo.kind === 'jpeg' && orig) xmpBytes = orig.payload
      else if (photo.kind === 'png' && chunk) xmpBytes = chunk.data
    }
  }

  // 4. Container assembly.
  const baseBytes = pixelBytes ?? photo.bytes
  let blob: Blob
  if (photo.kind === 'jpeg') {
    const parsed = jpeg.parseJpeg(baseBytes)
    if (!parsed) throw new Error('Could not assemble the output JPEG.')
    let segments: jpeg.JpegSegment[]
    if (!pixelBytes) {
      // patch metadata segments in place — byte-identical when unchanged
      segments = parsed.segments
        .map((s): jpeg.JpegSegment | null => {
          if (jpeg.isExifSegment(s)) return exifTiff ? { marker: jpeg.APP1, payload: jpeg.exifSegmentPayload(exifTiff) } : null
          if (jpeg.isXmpSegment(s)) return xmpBytes ? { marker: jpeg.APP1, payload: xmpBytes } : null
          if (jpeg.isC2paSegment(s)) return null
          return s
        })
        .filter((s): s is jpeg.JpegSegment => s !== null)
    } else {
      const meta: jpeg.JpegSegment[] = []
      if (exifTiff) meta.push({ marker: jpeg.APP1, payload: jpeg.exifSegmentPayload(exifTiff) })
      if (xmpBytes) meta.push({ marker: jpeg.APP1, payload: xmpBytes })
      for (const icc of photo.iccPayloads) meta.push({ marker: jpeg.APP2, payload: icc })
      const base = parsed.segments.filter(
        (s) => !jpeg.isExifSegment(s) && !jpeg.isXmpSegment(s) && !jpeg.isC2paSegment(s),
      )
      const at = base.length > 0 && base[0].marker === jpeg.APP0 ? 1 : 0
      segments = [...base.slice(0, at), ...meta, ...base.slice(at)]
    }
    if (photo.c2paPayloads.length) notes.push({ key: 'noteC2paRemoved' })
    blob = new Blob([jpeg.serializeJpeg({ segments, tail: parsed.tail })], { type: 'image/jpeg' })
  } else {
    const parsed = png.parsePng(baseBytes)
    if (!parsed) throw new Error('Could not assemble the output PNG.')
    let chunks: png.PngChunk[]
    if (!pixelBytes) {
      chunks = parsed.chunks
        .map((c): png.PngChunk | null => {
          if (c.type === 'eXIf') return exifTiff ? { type: 'eXIf', data: exifTiff } : null
          if (png.isXmpChunk(c)) return xmpBytes ? { type: 'iTXt', data: xmpBytes } : null
          if (png.isC2paChunk(c)) return null
          return c
        })
        .filter((c): c is png.PngChunk => c !== null)
    } else {
      const meta: png.PngChunk[] = []
      if (exifTiff) meta.push({ type: 'eXIf', data: exifTiff })
      if (xmpBytes) meta.push({ type: 'iTXt', data: xmpBytes })
      if (photo.png) for (const c of photo.png.chunks) if (c.type === 'iCCP') meta.push({ ...c })
      const base = parsed.chunks.filter((c) => c.type !== 'eXIf' && !png.isXmpChunk(c) && !png.isC2paChunk(c))
      const ihdr = base.findIndex((c) => c.type === 'IHDR')
      const at = ihdr >= 0 ? ihdr + 1 : 0
      chunks = [...base.slice(0, at), ...meta, ...base.slice(at)]
    }
    if (photo.c2paPayloads.length) notes.push({ key: 'noteC2paRemoved' })
    blob = new Blob([png.serializePng({ chunks, tail: parsed.tail })], { type: 'image/png' })
  }

  const dot = photo.fileName.lastIndexOf('.')
  const stem = dot > 0 ? photo.fileName.slice(0, dot) : photo.fileName
  const suffix =
    opts.kind === 'none' ? 'clean' : opts.kind === 'blackMist' ? 'black-mist' : 'white-mist'
  const fileName = `${stem}-${suffix}.${photo.kind === 'jpeg' ? 'jpg' : 'png'}`

  if (photo.xmpFiltered !== null) notes.push({ key: 'noteXmpCleaned' })
  return { blob, fileName, notes }
}
