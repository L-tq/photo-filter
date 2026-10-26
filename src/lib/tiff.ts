/**
 * Preservation-focused TIFF/EXIF reader + writer.
 *
 * The EXIF payload of a JPEG APP1 segment (or a PNG eXIf chunk) is a TIFF
 * structure: an 8-byte header followed by IFD blocks whose entries point into
 * a shared data area. This module parses that structure into editable blocks
 * while keeping every entry's raw value bytes, and rebuilds a valid TIFF blob
 * after deletions/edits — unknown tags, MakerNotes (copied opaque) and IFD1
 * thumbnail images survive the round trip.
 *
 * Sub-IFD pointer tags (Exif 0x8769, GPS 0x8825, Interop 0xA005) and the
 * thumbnail offset tag (0x0201) are managed structurally: they never appear
 * in `entries` and are re-created with correct offsets on rebuild.
 */

export type IfdPath = 'ifd0' | 'exif' | 'gps' | 'interop' | 'ifd1'

export const PTR_TAGS = {
  exif: 0x8769,
  gps: 0x8825,
  interop: 0xa005,
} as const

export const TAG_THUMB_OFFSET = 0x0201
export const TAG_THUMB_LENGTH = 0x0202

export const TYPE_BYTE = 1
export const TYPE_ASCII = 2
export const TYPE_SHORT = 3
export const TYPE_LONG = 4
export const TYPE_RATIONAL = 5
export const TYPE_UNDEFINED = 7
export const TYPE_SRATIONAL = 10

const TYPE_SIZES: Record<number, number> = {
  1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 13: 4,
}

export interface RawEntry {
  tag: number
  type: number
  count: number
  /** Exactly count × type-size bytes. */
  value: Uint8Array
}

export interface RawIfd {
  /** Ascending by tag. Pointer/thumbnail-offset tags are excluded (managed structurally). */
  entries: RawEntry[]
  children: { exif?: RawIfd; gps?: RawIfd; interop?: RawIfd }
  /** Next IFD in the chain (IFD0 → IFD1 thumbnail → …). */
  next?: RawIfd
  isThumbChain?: boolean
  thumbnail?: Uint8Array
}

export interface TiffFile {
  littleEndian: boolean
  ifd0: RawIfd
}

export function entrySize(e: RawEntry): number {
  return (TYPE_SIZES[e.type] ?? 1) * e.count
}

// ---------------------------------------------------------------- reading

export function readU16(v: Uint8Array, at: number, le: boolean): number {
  return le ? (v[at] | (v[at + 1] << 8)) : ((v[at] << 8) | v[at + 1])
}

export function readU32(v: Uint8Array, at: number, le: boolean): number {
  if (le) return (v[at] | (v[at + 1] << 8) | (v[at + 2] << 16) | (v[at + 3] << 24)) >>> 0
  return ((v[at] << 24) | (v[at + 1] << 16) | (v[at + 2] << 8) | v[at + 3]) >>> 0
}

export function parseTiff(data: Uint8Array): TiffFile | null {
  if (data.byteLength < 8) return null
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const bom = dv.getUint16(0)
  if (bom !== 0x4949 && bom !== 0x4d4d) return null
  const le = bom === 0x4949
  if (dv.getUint16(2, le) !== 42) return null
  const visited = new Set<number>()

  const readIfd = (off: number, inThumbChain: boolean, depth: number): RawIfd | null => {
    if (off === 0 || visited.has(off) || depth > 10) return null
    if (off < 8 || off + 2 > data.byteLength) return null
    visited.add(off)
    const count = dv.getUint16(off, le)
    const end = off + 2 + count * 12 + 4
    if (end > data.byteLength) return null
    const ifd: RawIfd = { entries: [], children: {}, isThumbChain: inThumbChain }
    const pointers: { tag: number; off: number }[] = []

    for (let i = 0; i < count; i++) {
      const p = off + 2 + i * 12
      const tag = dv.getUint16(p, le)
      const type = dv.getUint16(p + 2, le)
      const cnt = dv.getUint32(p + 4, le)
      if (cnt > 0x0100_0000) continue // absurd count → corrupt entry, drop it
      const size = (TYPE_SIZES[type] ?? 1) * cnt
      let value: Uint8Array
      if (size <= 4) {
        value = data.slice(p + 8, p + 8 + size)
      } else {
        const dOff = dv.getUint32(p + 8, le)
        if (dOff + size > data.byteLength) continue // points past the blob → drop
        value = data.slice(dOff, dOff + size)
      }
      if (tag === PTR_TAGS.exif || tag === PTR_TAGS.gps || tag === PTR_TAGS.interop) {
        if (value.byteLength >= 4) pointers.push({ tag, off: readU32(value, 0, le) })
        continue
      }
      if (inThumbChain && tag === TAG_THUMB_OFFSET) {
        if (value.byteLength >= 4) pointers.push({ tag, off: readU32(value, 0, le) })
        continue
      }
      ifd.entries.push({ tag, type, count: cnt, value })
    }

    for (const { tag, off } of pointers) {
      if (tag === PTR_TAGS.exif) ifd.children.exif = readIfd(off, false, depth + 1) ?? undefined
      else if (tag === PTR_TAGS.gps) ifd.children.gps = readIfd(off, false, depth + 1) ?? undefined
      else if (tag === PTR_TAGS.interop) ifd.children.interop = readIfd(off, false, depth + 1) ?? undefined
      else if (tag === TAG_THUMB_OFFSET) {
        const lenEntry = ifd.entries.find((e) => e.tag === TAG_THUMB_LENGTH)
        if (lenEntry && lenEntry.value.byteLength >= 4) {
          const len = readU32(lenEntry.value, 0, le)
          if (off >= 8 && len > 0 && off + len <= data.byteLength) {
            ifd.thumbnail = data.slice(off, off + len)
          }
        }
      }
    }

    ifd.entries.sort((a, b) => a.tag - b.tag)
    const nextOff = dv.getUint32(end - 4, le)
    if (nextOff !== 0) ifd.next = readIfd(nextOff, true, depth + 1) ?? undefined
    return ifd
  }

  const ifd0Off = dv.getUint32(4, le)
  const ifd0 = readIfd(ifd0Off, false, 0)
  if (!ifd0) return null
  return { littleEndian: le, ifd0 }
}

// ---------------------------------------------------------------- writing

/**
 * Re-serialises the structure. Entry value bytes are emitted verbatim and
 * must therefore already be encoded in `t.littleEndian` byte order — use the
 * entry makers (`asciiEntry`, `longEntry`, …) with the matching endianness.
 */
export function buildTiff(t: TiffFile): Uint8Array {
  // Flatten blocks in canonical order: each IFD, then its Exif sub-IFD (with
  // Interop), then GPS, then the next chain IFD (thumbnail).
  const blocks: { ifd: RawIfd; isThumb: boolean }[] = []
  const collect = (ifd: RawIfd, isThumb: boolean) => {
    blocks.push({ ifd, isThumb })
    if (ifd.children.exif) {
      blocks.push({ ifd: ifd.children.exif, isThumb: false })
      if (ifd.children.exif.children.interop) blocks.push({ ifd: ifd.children.exif.children.interop!, isThumb: false })
    }
    if (ifd.children.gps) blocks.push({ ifd: ifd.children.gps!, isThumb: false })
    if (ifd.next) collect(ifd.next, true)
  }
  collect(t.ifd0, false)

  const managedCount = (ifd: RawIfd, isThumb: boolean): number =>
    (ifd.children.exif ? 1 : 0) +
    (ifd.children.gps ? 1 : 0) +
    (ifd.children.interop ? 1 : 0) +
    (isThumb && ifd.thumbnail ? 1 : 0)

  // Pass 1: IFD offsets, laid out sequentially right after the 8-byte header.
  let cursor = 8
  const offsets = new Map<RawIfd, number>()
  for (const b of blocks) {
    offsets.set(b.ifd, cursor)
    cursor += 2 + (b.ifd.entries.length + managedCount(b.ifd, b.isThumb)) * 12 + 4
  }

  // Pass 2: data-area slots for oversized values and thumbnail blobs.
  const dataSlots = new Map<RawEntry, number>()
  const thumbSlots = new Map<RawIfd, number>()
  for (const b of blocks) {
    for (const e of b.ifd.entries) {
      if (entrySize(e) > 4) {
        cursor = (cursor + 1) & ~1
        dataSlots.set(e, cursor)
        cursor += entrySize(e)
      }
    }
    if (b.isThumb && b.ifd.thumbnail) {
      cursor = (cursor + 1) & ~1
      thumbSlots.set(b.ifd, cursor)
      cursor += b.ifd.thumbnail.byteLength
    }
  }

  const le = t.littleEndian
  const out = new Uint8Array(cursor)
  const dv = new DataView(out.buffer)
  const w16 = (o: number, v: number) => dv.setUint16(o, v, le)
  const w32 = (o: number, v: number) => dv.setUint32(o, v, le)
  const ptrEntry = (tag: number, offset: number): RawEntry => ({
    tag,
    type: TYPE_LONG,
    count: 1,
    value: u32Bytes(offset, le),
  })

  out[0] = le ? 0x49 : 0x4d
  out[1] = le ? 0x49 : 0x4d
  w16(2, 42)
  w32(4, 8)

  for (const b of blocks) {
    const { ifd } = b
    const managed: RawEntry[] = []
    if (ifd.children.exif) managed.push(ptrEntry(PTR_TAGS.exif, offsets.get(ifd.children.exif)!))
    if (ifd.children.gps) managed.push(ptrEntry(PTR_TAGS.gps, offsets.get(ifd.children.gps)!))
    if (ifd.children.interop) managed.push(ptrEntry(PTR_TAGS.interop, offsets.get(ifd.children.interop)!))
    if (b.isThumb && ifd.thumbnail) managed.push(ptrEntry(TAG_THUMB_OFFSET, thumbSlots.get(ifd)!))

    const all = [...ifd.entries, ...managed].sort((a, x) => a.tag - x.tag)
    const off = offsets.get(ifd)!
    w16(off, all.length)
    let p = off + 2
    for (const e of all) {
      w16(p, e.tag)
      w16(p + 2, e.type)
      w32(p + 4, e.count)
      if (entrySize(e) <= 4) {
        out.set(e.value.subarray(0, 4), p + 8) // out is zero-initialised → inline padding
      } else {
        w32(p + 8, dataSlots.get(e)!)
      }
      p += 12
    }
    w32(p, ifd.next ? offsets.get(ifd.next)! : 0)
  }

  for (const [e, slot] of dataSlots) out.set(e.value, slot)
  for (const [ifd, slot] of thumbSlots) out.set(ifd.thumbnail!, slot)
  return out
}

export function u32Bytes(v: number, le: boolean): Uint8Array {
  const b = new Uint8Array(4)
  if (le) {
    b[0] = v & 0xff; b[1] = (v >>> 8) & 0xff; b[2] = (v >>> 16) & 0xff; b[3] = (v >>> 24) & 0xff
  } else {
    b[0] = (v >>> 24) & 0xff; b[1] = (v >>> 16) & 0xff; b[2] = (v >>> 8) & 0xff; b[3] = v & 0xff
  }
  return b
}

export function u16Bytes(v: number, le: boolean): Uint8Array {
  const b = new Uint8Array(2)
  if (le) { b[0] = v & 0xff; b[1] = (v >>> 8) & 0xff } else { b[0] = (v >>> 8) & 0xff; b[1] = v & 0xff }
  return b
}

// ---------------------------------------------------------------- editing

export function findIfd(t: TiffFile, path: IfdPath): RawIfd | undefined {
  switch (path) {
    case 'ifd0': return t.ifd0
    case 'exif': return t.ifd0.children.exif
    case 'gps': return t.ifd0.children.gps
    case 'interop': return t.ifd0.children.exif?.children.interop
    case 'ifd1': return t.ifd0.next
  }
}

export function deleteEntry(ifd: RawIfd, tag: number): void {
  ifd.entries = ifd.entries.filter((e) => e.tag !== tag)
}

export function upsertEntry(ifd: RawIfd, entry: RawEntry): void {
  const i = ifd.entries.findIndex((e) => e.tag === entry.tag)
  if (i >= 0) ifd.entries[i] = entry
  else {
    ifd.entries.push(entry)
    ifd.entries.sort((a, b) => a.tag - b.tag)
  }
}

/** Deep clone (plain data + typed arrays only). */
export function cloneTiff(t: TiffFile): TiffFile {
  return structuredClone(t)
}

// ---------------------------------------------------------------- value makers

/** EXIF ASCII values are NUL-terminated byte strings (latin-1 here). */
export function asciiEntry(tag: number, text: string): RawEntry {
  const value = new Uint8Array(text.length + 1)
  for (let i = 0; i < text.length; i++) value[i] = text.charCodeAt(i) & 0xff
  return { tag, type: TYPE_ASCII, count: value.byteLength, value }
}

export function longEntry(tag: number, v: number, le = true): RawEntry {
  return { tag, type: TYPE_LONG, count: 1, value: u32Bytes(v >>> 0, le) }
}

export function shortEntry(tag: number, v: number, le = true): RawEntry {
  return { tag, type: TYPE_SHORT, count: 1, value: u16Bytes(v & 0xffff, le) }
}

/** One or more RATIONAL (type 5) values from [num, den] pairs. */
export function rationalEntry(tag: number, pairs: [number, number][], le = true): RawEntry {
  const value = new Uint8Array(pairs.length * 8)
  const dv = new DataView(value.buffer)
  pairs.forEach(([n, d], i) => {
    dv.setUint32(i * 8, n >>> 0, le)
    dv.setUint32(i * 8 + 4, Math.max(1, d) >>> 0, le)
  })
  return { tag, type: TYPE_RATIONAL, count: pairs.length, value }
}

/** Approximate a decimal as a rational via continued fractions. */
export function approxRational(x: number, maxDen = 1_000_000): [number, number] {
  if (!Number.isFinite(x)) return [0, 1]
  const sign = x < 0 ? -1 : 1
  x = Math.abs(x)
  let [n0, d0, n1, d1] = [1, 0, Math.floor(x), 1]
  let frac = x - Math.floor(x)
  for (let i = 0; i < 64 && d1 <= maxDen; i++) {
    if (frac < 1e-12) break
    const a = Math.floor(1 / frac)
    const nn = n0 + a * n1
    const dd = d0 + a * d1
    if (dd > maxDen) break
    ;[n0, d0, n1, d1] = [n1, d1, nn, dd]
    frac = 1 / frac - a
  }
  return [sign * n1, d1]
}

// ---------------------------------------------------------------- value decoding

export function decodeAscii(value: Uint8Array): string {
  let end = value.byteLength
  while (end > 0 && value[end - 1] === 0) end--
  let s = ''
  for (let i = 0; i < end; i++) s += String.fromCharCode(value[i])
  return s
}

/** UserComment starts with an 8-byte charset id ("ASCII\0\0\0" etc.). */
export function decodeUserComment(value: Uint8Array): string {
  if (value.byteLength >= 8) {
    const prefix = decodeAscii(value.subarray(0, 8))
    if (/^(ASCII|UNICODE|JIS|\\0+|)$/i.test(prefix.trim().replace(/\0/g, ''))) {
      return decodeAscii(value.subarray(8)).replace(/^\0+/, '')
    }
  }
  return decodeAscii(value)
}

export function decodeNumberArray(e: RawEntry, le: boolean): number[] {
  const out: number[] = []
  const size = TYPE_SIZES[e.type] ?? 1
  const n = Math.min(e.count, Math.floor(e.value.byteLength / size))
  for (let i = 0; i < n; i++) {
    const at = i * size
    switch (e.type) {
      case TYPE_BYTE:
      case TYPE_ASCII:
      case TYPE_UNDEFINED: out.push(e.value[at]); break
      case TYPE_SHORT: out.push(readU16(e.value, at, le)); break
      case TYPE_LONG: out.push(readU32(e.value, at, le)); break
      case 6: out.push((e.value[at] << 24) >> 24); break
      case 8: out.push((readU16(e.value, at, le) << 16) >> 16); break
      case 9: out.push(readU32(e.value, at, le) | 0); break
      case TYPE_RATIONAL:
      case TYPE_SRATIONAL: {
        const num = readU32(e.value, at, le)
        const den = readU32(e.value, at + 4, le)
        out.push(den === 0 ? 0 : num / den)
        break
      }
      default: out.push(e.value[at])
    }
  }
  return out
}

export function decodeRationals(e: RawEntry, le: boolean): [number, number][] {
  const out: [number, number][] = []
  const n = Math.floor(Math.min(e.count, e.value.byteLength / 8))
  for (let i = 0; i < n; i++) {
    out.push([readU32(e.value, i * 8, le), readU32(e.value, i * 8 + 4, le)])
  }
  return out
}

// ---------------------------------------------------------------- GPS helpers

export const GPS_LATITUDE = 0x0002
export const GPS_LATITUDE_REF = 0x0001
export const GPS_LONGITUDE = 0x0004
export const GPS_LONGITUDE_REF = 0x0003

export function dmsToDecimal(pairs: [number, number][], ref: string): number {
  const vals = pairs.map(([n, d]) => (d === 0 ? 0 : n / d))
  const dec = (vals[0] ?? 0) + (vals[1] ?? 0) / 60 + (vals[2] ?? 0) / 3600
  return ref.startsWith('S') || ref.startsWith('W') ? -dec : dec
}

export function decimalToDms(dec: number): { pairs: [number, number][]; sign: 1 | -1 } {
  const sign = dec < 0 ? -1 : 1
  const abs = Math.abs(dec)
  const deg = Math.floor(abs)
  const minFloat = (abs - deg) * 60
  const min = Math.floor(minFloat)
  const sec = (minFloat - min) * 60
  return {
    pairs: [
      [deg, 1],
      [min, 1],
      approxRational(sec, 1000),
    ],
    sign,
  }
}
