import { describe, expect, it } from 'vitest'
import * as png from '../src/lib/png'

function chunk(type: string, data: number[]): number[] {
  const b: number[] = []
  const len = data.length
  b.push((len >>> 24) & 0xff, (len >>> 16) & 0xff, (len >>> 8) & 0xff, len & 0xff)
  b.push(...[...type].map((c) => c.charCodeAt(0)))
  b.push(...data)
  const bytes = new Uint8Array([...[...type].map((c) => c.charCodeAt(0)), ...data])
  const crc = png.crc32(bytes)
  b.push((crc >>> 24) & 0xff, (crc >>> 16) & 0xff, (crc >>> 8) & 0xff, crc & 0xff)
  return b
}

function fakePng(extra: number[][]): Uint8Array {
  const sig = Array.from(png.PNG_SIG)
  const ihdr = chunk('IHDR', [0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0])
  const idat = chunk('IDAT', [0x78, 0x9c, 0x63, 0x00, 0x01])
  const iend = chunk('IEND', [])
  const body = [ihdr, ...extra, idat, iend].flat()
  return new Uint8Array([...sig, ...body])
}

describe('crc32', () => {
  it('matches the canonical test vector', () => {
    expect(png.crc32(new Uint8Array([...'123456789'].map((c) => c.charCodeAt(0))))).toBe(0xcbf43926)
  })
})

describe('parsePng / serializePng', () => {
  it('round-trips chunks with recomputed CRCs', () => {
    const bytes = fakePng([chunk('eXIf', [0x49, 0x49, 42, 0])])
    const parsed = png.parsePng(bytes)!
    expect(parsed.chunks.map((c) => c.type)).toEqual(['IHDR', 'eXIf', 'IDAT', 'IEND'])
    expect(Array.from(png.serializePng(parsed))).toEqual(Array.from(bytes))
  })

  it('rejects non-PNG data', () => {
    expect(png.parsePng(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]))).toBeNull()
  })

  it('inserts an eXIf chunk after IHDR and drops c2pa', () => {
    const parsed = png.parsePng(fakePng([chunk('c2pa', [9, 9, 9])]))!
    let chunks = parsed.chunks.filter((c) => !png.isC2paChunk(c))
    chunks = [...chunks.slice(0, 1), { type: 'eXIf', data: new Uint8Array([7, 7, 7]) }, ...chunks.slice(1)]
    const out = png.parsePng(png.serializePng({ chunks, tail: parsed.tail }))!
    expect(out.chunks.map((c) => c.type)).toEqual(['IHDR', 'eXIf', 'IDAT', 'IEND'])
    expect(Array.from(out.chunks[1].data)).toEqual([7, 7, 7])
  })
})

describe('XMP chunks', () => {
  it('builds and reads an XMP iTXt chunk', () => {
    const c = png.makeXmpChunk('<x>x</x>')
    expect(png.isXmpChunk(c)).toBe(true)
    expect(png.xmpChunkText(c)).toBe('<x>x</x>')
    const notXmp: png.PngChunk = { type: 'iTXt', data: new Uint8Array([...'Comment\0'].map((x) => x.charCodeAt(0)).concat([0, 0, 0, 0])) }
    expect(png.isXmpChunk(notXmp)).toBe(false)
  })
})
