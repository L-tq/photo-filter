import { describe, expect, it } from 'vitest'
import {
  asciiEntry,
  approxRational,
  buildTiff,
  decodeAscii,
  decodeRationals,
  decodeUserComment,
  deleteEntry,
  longEntry,
  parseTiff,
  rationalEntry,
  readU16,
  readU32,
  shortEntry,
  upsertEntry,
  GPS_LATITUDE,
  TAG_THUMB_LENGTH,
  type RawIfd,
  type TiffFile,
} from '../src/lib/tiff'

/**
 * Independently hand-built TIFF blob (little-endian): IFD0 with Make
 * (out-of-line ASCII), Orientation (inline SHORT), Software (inline ASCII),
 * Exif SubIFD (UserComment), GPS IFD (lat ref + lat) and an IFD1 thumbnail.
 * Built byte-by-byte so it does not share code with buildTiff.
 */
function manualTiff(): Uint8Array {
  const make = [...'TestCam'].map((c) => c.charCodeAt(0)).concat([0]) // 8 bytes
  const software = [...'v1'].map((c) => c.charCodeAt(0)).concat([0]) // 3 bytes
  const comment = [...'ASCII'].map((c) => c.charCodeAt(0)).concat([0, 0, 0]).concat([...'hello'].map((c) => c.charCodeAt(0))) // 13 bytes
  const lat = [48, 1, 51, 1, 5013, 100] // 3 rationals as raw u32s
  const thumb = [0xff, 0xd8, 0xff, 0xd9]

  const ifd0Off = 8
  const ifd1Off = ifd0Off + 2 + 5 * 12 + 4 // 66 bytes
  const exifOff = ifd1Off + 2 + 2 * 12 + 4
  const gpsOff = exifOff + 2 + 1 * 12 + 4
  const dataOff = gpsOff + 2 + 2 * 12 + 4
  const makeOff = dataOff
  const commentOff = makeOff + make.length // 8
  const latOff = commentOff + comment.length
  const thumbOff = latOff + lat.length * 4

  const b: number[] = []
  const w16 = (v: number) => b.push(v & 0xff, (v >>> 8) & 0xff)
  const w32 = (v: number) => b.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff)
  const entry = (tag: number, type: number, count: number, data: number[]) => {
    w16(tag)
    w16(type)
    w32(count)
    if (data.length <= 4) {
      b.push(...data, ...new Array(4 - data.length).fill(0))
    } else {
      w32(data[0]) // out-of-line: data[0] is the offset
    }
  }
  const u16le = (v: number) => [v & 0xff, (v >>> 8) & 0xff]
  const u32le = (v: number) => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff]

  b.push(0x49, 0x49)
  w16(42)
  w32(ifd0Off)

  // IFD0 — 5 entries, ascending tags (0x010F, 0x0112, 0x0131, 0x8769, 0x8825)
  w16(5)
  entry(0x010f, 2, make.length, [makeOff])
  entry(0x0112, 3, 1, u16le(6))
  entry(0x0131, 2, software.length, software)
  entry(0x8769, 4, 1, u32le(exifOff))
  entry(0x8825, 4, 1, u32le(gpsOff))
  w32(ifd1Off)

  // IFD1 — thumbnail
  w16(2)
  entry(0x0201, 4, 1, u32le(thumbOff))
  entry(0x0202, 4, 1, u32le(thumb.length))
  w32(0)

  // Exif IFD
  w16(1)
  entry(0x9286, 7, comment.length, [commentOff])
  w32(0)

  // GPS IFD
  w16(2)
  entry(0x0001, 2, 2, [0x4e, 0]) // "N\0"
  entry(0x0002, 5, 3, [latOff])
  w32(0)

  b.push(...make, ...comment)
  for (const v of lat) w32(v)
  b.push(...thumb)

  return new Uint8Array(b)
}

describe('parseTiff', () => {
  it('parses a hand-built TIFF with all IFDs', () => {
    const t = parseTiff(manualTiff())
    expect(t).not.toBeNull()
    expect(t!.littleEndian).toBe(true)
    const ifd0 = t!.ifd0
    expect(decodeAscii(ifd0.entries.find((e) => e.tag === 0x010f)!.value)).toBe('TestCam')
    expect(ifd0.entries.find((e) => e.tag === 0x0112)!.value[0]).toBe(6)
    expect(decodeAscii(ifd0.entries.find((e) => e.tag === 0x0131)!.value)).toBe('v1')
    // pointer tags are structural, not entries
    expect(ifd0.entries.some((e) => e.tag === 0x8769)).toBe(false)
    expect(ifd0.children.exif).toBeDefined()
    expect(ifd0.children.gps).toBeDefined()
    const comment = ifd0.children.exif!.entries.find((e) => e.tag === 0x9286)!
    expect(decodeUserComment(comment.value)).toBe('hello')
    const gps = ifd0.children.gps!
    const lat = gps.entries.find((e) => e.tag === GPS_LATITUDE)!
    expect(decodeRationals(lat, true)).toEqual([
      [48, 1],
      [51, 1],
      [5013, 100],
    ])
    const ifd1 = ifd0.next!
    expect(ifd1.isThumbChain).toBe(true)
    expect(Array.from(ifd1.thumbnail!)).toEqual([0xff, 0xd8, 0xff, 0xd9])
  })

  it('rejects non-TIFF data', () => {
    expect(parseTiff(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]))).toBeNull()
  })
})

describe('buildTiff round trip', () => {
  it('rebuilds a parsed TIFF with identical values', () => {
    const t1 = parseTiff(manualTiff())!
    const bytes = buildTiff(t1)
    const t2 = parseTiff(bytes)!
    expect(t2.littleEndian).toBe(t1.littleEndian)
    const dump = (t: TiffFile) => JSON.stringify(t, (_k, v) => (v instanceof Uint8Array ? Array.from(v) : v))
    expect(dump(t2)).toBe(dump(t1))
  })

  it('is stable: build(parse(build(x))) === build(x)', () => {
    const t1 = parseTiff(manualTiff())!
    const b1 = buildTiff(t1)
    const b2 = buildTiff(parseTiff(b1)!)
    expect(Array.from(b2)).toEqual(Array.from(b1))
  })

  it('preserves unknown and binary entries through rebuild', () => {
    const t1 = parseTiff(manualTiff())!
    const makerBytes = new Uint8Array(400).map((_, i) => i & 0xff)
    upsertEntry(t1.ifd0, { tag: 0xc612, type: 7, count: 400, value: makerBytes })
    const t2 = parseTiff(buildTiff(t1))!
    const mn = t2.ifd0.entries.find((e) => e.tag === 0xc612)!
    expect(Array.from(mn.value)).toEqual(Array.from(makerBytes))
  })

  it('supports big-endian round trip', () => {
    const gps: RawIfd = {
      entries: [
        asciiEntry(0x0001, 'N'),
        rationalEntry(GPS_LATITUDE, [[48, 1], [51, 1], [5013, 100]], false),
      ],
      children: {},
    }
    const t: TiffFile = {
      littleEndian: false,
      ifd0: {
        entries: [asciiEntry(0x010f, 'TestCam'), shortEntry(0x0112, 6, false), longEntry(0x0202, 1234, false)],
        children: { gps },
      },
    }
    const out = parseTiff(buildTiff(t))!
    expect(out.littleEndian).toBe(false)
    expect(decodeAscii(out.ifd0.entries.find((e) => e.tag === 0x010f)!.value)).toBe('TestCam')
    expect(readU16(out.ifd0.entries.find((e) => e.tag === 0x0112)!.value, 0, false)).toBe(6)
    expect(readU32(out.ifd0.entries.find((e) => e.tag === 0x0202)!.value, 0, false)).toBe(1234)
    expect(decodeRationals(out.ifd0.children.gps!.entries.find((e) => e.tag === GPS_LATITUDE)!, false)[0]).toEqual([48, 1])
  })
})

describe('editing', () => {
  it('deletes and rewrites tags while keeping the rest', () => {
    const t = parseTiff(manualTiff())!
    deleteEntry(t.ifd0, 0x0131) // Software
    upsertEntry(t.ifd0, asciiEntry(0x013b, 'New Artist'))
    const out = parseTiff(buildTiff(t))!
    expect(out.ifd0.entries.some((e) => e.tag === 0x0131)).toBe(false)
    expect(decodeAscii(out.ifd0.entries.find((e) => e.tag === 0x013b)!.value)).toBe('New Artist')
    expect(decodeAscii(out.ifd0.entries.find((e) => e.tag === 0x010f)!.value)).toBe('TestCam')
    expect(out.ifd0.children.gps).toBeDefined()
    expect(out.ifd0.next!.thumbnail).toBeDefined()
  })

  it('keeps thumbnail and thumb length entry through chain rebuild', () => {
    const t = parseTiff(manualTiff())!
    const out = parseTiff(buildTiff(t))!
    const len = out.ifd0.next!.entries.find((e) => e.tag === TAG_THUMB_LENGTH)!
    expect(len.value.byteLength).toBe(4)
    expect(out.ifd0.next!.thumbnail!.byteLength).toBe(4)
  })

  it('numeric entry helpers encode correctly', () => {
    const ifd: RawIfd = { entries: [], children: {} }
    upsertEntry(ifd, shortEntry(0x0112, 8))
    upsertEntry(ifd, longEntry(0x0202, 1234))
    upsertEntry(ifd, rationalEntry(GPS_LATITUDE, [[48, 1], [51, 1], [5013, 100]]))
    const t: TiffFile = { littleEndian: true, ifd0: ifd }
    const out = parseTiff(buildTiff(t))!
    expect(out.ifd0.entries.find((e) => e.tag === 0x0112)!.value[0]).toBe(8)
    const dv = new DataView(out.ifd0.entries.find((e) => e.tag === 0x0202)!.value.buffer)
    expect(dv.getUint32(0, true)).toBe(1234)
    expect(decodeRationals(out.ifd0.entries.find((e) => e.tag === GPS_LATITUDE)!, true)).toHaveLength(3)
  })
})

describe('approxRational', () => {
  it('converts decimals to close rationals', () => {
    expect(approxRational(0.5)).toEqual([1, 2])
    const [n, d] = approxRational(48.8584)
    expect(Math.abs(n / d - 48.8584)).toBeLessThan(1e-6)
  })
})
