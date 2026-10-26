import { describe, expect, it } from 'vitest'
import { createZip } from '../src/lib/zip'
import { crc32 } from '../src/lib/png'

/** Minimal reader that walks EOCD → central directory → local headers. */
function parseZip(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  // Find the EOCD signature scanning back (no comment is ever written).
  let eocd = -1
  for (let i = bytes.byteLength - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i
      break
    }
  }
  expect(eocd).toBeGreaterThanOrEqual(0)
  // EOCD: sig(4) disk(2) cdDisk(2) entriesHere(2) entriesTotal(2) cdSize(4) cdOffset(4)
  const count = view.getUint16(eocd + 8, true)
  expect(view.getUint16(eocd + 10, true)).toBe(count)
  const cdOffset = view.getUint32(eocd + 16, true)
  const decoder = new TextDecoder()

  const entries: { name: string; data: Uint8Array; utf8Flag: number; crc: number }[] = []
  let at = cdOffset
  for (let i = 0; i < count; i++) {
    expect(view.getUint32(at, true)).toBe(0x02014b50)
    const utf8Flag = view.getUint16(at + 8, true)
    const crc = view.getUint32(at + 16, true)
    const size = view.getUint32(at + 24, true)
    const nameLen = view.getUint16(at + 28, true)
    const localOffset = view.getUint32(at + 42, true)
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLen))

    expect(view.getUint32(localOffset, true)).toBe(0x04034b50)
    const localNameLen = view.getUint16(localOffset + 26, true)
    const extraLen = view.getUint16(localOffset + 28, true)
    const dataAt = localOffset + 30 + localNameLen + extraLen
    const data = bytes.subarray(dataAt, dataAt + size)
    entries.push({ name, data, utf8Flag, crc })
    at += 46 + nameLen
  }
  expect(at).toBe(eocd)
  return entries
}

describe('createZip', () => {
  it('stores entries verbatim with correct offsets, sizes and CRCs', () => {
    const a = new Uint8Array(1000).map((_, i) => (i * 7) & 0xff)
    const b = new Uint8Array([0xff, 0xd8, 0xff, 0xd9, 1, 2, 3])
    const zip = createZip([
      { name: 'photo-clean.jpg', data: a },
      { name: 'photo-black-mist.jpg', data: b },
    ])
    const entries = parseZip(zip)
    expect(entries.map((e) => e.name)).toEqual(['photo-clean.jpg', 'photo-black-mist.jpg'])
    for (const e of entries) {
      expect(crc32(e.data)).toBe(e.crc)
    }
    expect(Array.from(entries[0].data)).toEqual(Array.from(a))
    expect(Array.from(entries[1].data)).toEqual(Array.from(b))
  })

  it('flags UTF-8 names and round-trips non-ASCII filenames', () => {
    const zip = createZip([{ name: '港口-白柔.jpg', data: new Uint8Array([1, 2, 3]) }])
    const entries = parseZip(zip)
    expect(entries[0].utf8Flag & 0x0800).toBe(0x0800)
    expect(entries[0].name).toBe('港口-白柔.jpg')
    expect(Array.from(entries[0].data)).toEqual([1, 2, 3])
  })

  it('handles empty and zero-length entries', () => {
    const zip = createZip([
      { name: 'empty.bin', data: new Uint8Array(0) },
      { name: 'x.jpg', data: new Uint8Array(5) },
    ])
    const entries = parseZip(zip)
    expect(entries).toHaveLength(2)
    expect(entries[0].data.byteLength).toBe(0)
    expect(entries[0].crc).toBe(0)
  })
})
