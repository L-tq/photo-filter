import { describe, expect, it } from 'vitest'
import * as jpeg from '../src/lib/jpeg'

function fakeJpeg(parts: { marker: number; payload: number[] }[]): Uint8Array {
  const b: number[] = [0xff, 0xd8]
  for (const p of parts) {
    const len = p.payload.length + 2
    b.push(0xff, p.marker, len >> 8, len & 0xff, ...p.payload)
  }
  b.push(0xff, 0xda, 0x00, 0x0c) // SOS header
  b.push(0x12, 0x34, 0x56) // entropy data
  b.push(0xff, 0xd9) // EOI
  return new Uint8Array(b)
}

const EXIF_PAYLOAD = [0x45, 0x78, 0x69, 0x66, 0, 0, 0x49, 0x49, 42, 0, 8, 0, 0, 0]
const XMP_PAYLOAD = [...'http://ns.adobe.com/xap/1.0/\0'].map((c) => c.charCodeAt(0)).concat([0x3c, 0x78, 0x3e])
const JFIF_PAYLOAD = [0x4a, 0x46, 0x49, 0x46, 0]

describe('parseJpeg / serializeJpeg', () => {
  it('round-trips a multi-segment JPEG byte-for-byte', () => {
    const bytes = fakeJpeg([
      { marker: 0xe0, payload: JFIF_PAYLOAD },
      { marker: 0xe1, payload: EXIF_PAYLOAD },
      { marker: 0xe1, payload: XMP_PAYLOAD },
      { marker: 0xeb, payload: [1, 2, 3] },
      { marker: 0xdb, payload: [9, 9, 9] },
    ])
    const parsed = jpeg.parseJpeg(bytes)!
    expect(parsed.segments.map((s) => s.marker)).toEqual([0xe0, 0xe1, 0xe1, 0xeb, 0xdb])
    expect(Array.from(jpeg.serializeJpeg(parsed))).toEqual(Array.from(bytes))
  })

  it('rejects non-JPEG and corrupt data', () => {
    expect(jpeg.parseJpeg(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeNull()
    expect(jpeg.parseJpeg(new Uint8Array([0xff, 0xd8, 0x00, 0x99]))).toBeNull()
  })

  it('classifies metadata segments', () => {
    const parsed = jpeg.parseJpeg(
      fakeJpeg([
        { marker: 0xe0, payload: JFIF_PAYLOAD },
        { marker: 0xe1, payload: EXIF_PAYLOAD },
        { marker: 0xe1, payload: XMP_PAYLOAD },
        { marker: 0xe2, payload: [...'ICC_PROFILE\0'].map((c) => c.charCodeAt(0)) },
        { marker: 0xeb, payload: [0, 0, 0x6a, 0x70] },
      ]),
    )!
    expect(parsed.segments.map(jpeg.isExifSegment)).toEqual([false, true, false, false, false])
    expect(parsed.segments.map(jpeg.isXmpSegment)).toEqual([false, false, true, false, false])
    expect(parsed.segments.map(jpeg.isC2paSegment)).toEqual([false, false, false, false, true])
  })

  it('detects c2pa URNs hidden in APP1/APP2 payloads', () => {
    const seg: jpeg.JpegSegment = {
      marker: 0xe2,
      payload: new Uint8Array([...'blah urn:c2pa:x blah'].map((c) => c.charCodeAt(0))),
    }
    expect(jpeg.isC2paSegment(seg)).toBe(true)
  })

  it('replaces the EXIF segment and drops C2PA losslessly', () => {
    const bytes = fakeJpeg([
      { marker: 0xe0, payload: JFIF_PAYLOAD },
      { marker: 0xe1, payload: EXIF_PAYLOAD },
      { marker: 0xeb, payload: [1, 2, 3] },
      { marker: 0xdb, payload: [9, 9] },
    ])
    const parsed = jpeg.parseJpeg(bytes)!
    const segments = parsed.segments
      .filter((s) => !jpeg.isC2paSegment(s))
      .map((s) => (jpeg.isExifSegment(s) ? { marker: 0xe1, payload: jpeg.exifSegmentPayload(new Uint8Array([1, 2, 3])) } : s))
    const out = jpeg.parseJpeg(jpeg.serializeJpeg({ segments, tail: parsed.tail }))!
    expect(out.segments.map((s) => s.marker)).toEqual([0xe0, 0xe1, 0xdb])
    expect(Array.from(out.segments[1].payload)).toEqual([0x45, 0x78, 0x69, 0x66, 0, 0, 1, 2, 3])
    // scan data untouched (entropy bytes sit right before the EOI)
    expect(Array.from(out.tail.slice(-5, -2))).toEqual([0x12, 0x34, 0x56])
  })

  it('reads and writes XMP segment text', () => {
    const xml = '<x:xmpmeta xmlns:x="adobe:ns:meta/"/>'
    const payload = jpeg.xmpSegmentPayload(xml)
    expect(jpeg.xmpSegmentText(payload)).toBe(xml)
  })
})
