import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { detectAi } from '../src/lib/aiDetect'
import { isC2paSegment, isExifSegment, isXmpSegment, parseJpeg, xmpSegmentText } from '../src/lib/jpeg'
import { buildTiff, cloneTiff, deleteEntry, decodeAscii, findIfd, parseTiff } from '../src/lib/tiff'
import { analyzeXmp } from '../src/lib/xmp'

/**
 * Runs the app's own readers against the generated sample files (run
 * `npm run fixtures` first). Skipped silently when samples are absent.
 */
const hasSamples = existsSync('samples/ai.jpg') && existsSync('samples/clean.jpg') && existsSync('samples/meta.png')

function scan(path: string) {
  const bytes = new Uint8Array(readFileSync(path))
  const jf = parseJpeg(bytes)!
  const exifSeg = jf.segments.find(isExifSegment)!
  const tiff = parseTiff(exifSeg.payload.subarray(6))!
  const xmpSeg = jf.segments.find(isXmpSegment)
  const xmp = xmpSeg ? xmpSegmentText(xmpSeg.payload) : null
  const c2pa = jf.segments.filter(isC2paSegment).map((s) => s.payload)
  const findings = detectAi({ tiff, xmp: null, c2paPayloads: c2pa })
  if (xmp) findings.push(...analyzeXmp(xmp).findings)
  return { jf, tiff, xmp, findings }
}

describe.skipIf(!hasSamples)('generated fixtures', () => {
  it('ai.jpg triggers every AI marker', () => {
    const { findings } = scan('samples/ai.jpg')
    const where = findings.map((f) => `${f.where}:${f.tagName}`).sort()
    expect(where).toContain('exif:Software')
    expect(where).toContain('exif:UserComment')
    expect(where).toContain('xmp:Iptc4xmpCore:digitalSourceType')
    expect(where).toContain('xmp:xmp:CreatorTool')
    expect(where.some((w) => w.startsWith('c2pa:'))).toBe(true)
    expect(findings.every((f) => f.severity === 'ai')).toBe(true)
  })

  it('clean.jpg is clean', () => {
    const { findings, tiff } = scan('samples/clean.jpg')
    expect(findings).toHaveLength(0)
    expect(decodeAscii(findIfd(tiff, 'ifd0')!.entries.find((e) => e.tag === 0x013b)!.value)).toBe('Jane Photographer')
    expect(tiff.ifd0.next?.thumbnail?.byteLength).toBeGreaterThan(1000)
  })

  it('survives a full edit round trip on ai.jpg', () => {
    const { tiff, xmp } = scan('samples/ai.jpg')
    const t = cloneTiff(tiff)
    deleteEntry(t.ifd0, 0x0131) // Software (AI)
    const rebuilt = parseTiff(buildTiff(t))!
    expect(rebuilt.ifd0.entries.some((e) => e.tag === 0x0131)).toBe(false)
    // unknown tag, maker note, thumbnail, GPS survive
    expect(rebuilt.ifd0.children.exif?.entries.some((e) => e.tag === 0x927c)).toBe(true)
    expect(rebuilt.ifd0.children.exif?.entries.some((e) => e.tag === 0xea1c)).toBe(true)
    expect(rebuilt.ifd0.children.gps?.entries.some((e) => e.tag === 0x0002)).toBe(true)
    expect(rebuilt.ifd0.next?.thumbnail?.byteLength).toBe(tiff.ifd0.next?.thumbnail?.byteLength)

    const x = analyzeXmp(xmp!)
    expect(x.filteredXml).not.toBeNull()
    expect(x.filteredXml).not.toContain('Firefly')
    expect(x.filteredXml).not.toContain('trainedAlgorithmicMedia')
    expect(x.filteredXml).toContain('Harbor dusk')
  })
})
