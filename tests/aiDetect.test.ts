import { describe, expect, it } from 'vitest'
import { aiMatch, detectAi } from '../src/lib/aiDetect'
import { asciiEntry, buildTiff, parseTiff, type RawEntry, type TiffFile } from '../src/lib/tiff'

function tiffWith(ifd0Entries: RawEntry[], exifEntries: RawEntry[] = []): TiffFile {
  const t: TiffFile = { littleEndian: true, ifd0: { entries: ifd0Entries, children: {} } }
  if (exifEntries.length) t.ifd0.children.exif = { entries: exifEntries, children: {} }
  return parseTiff(buildTiff(t))!
}

describe('aiMatch tiers', () => {
  it('tool tier matches known generators', () => {
    for (const s of ['Adobe Firefly', 'Made with Midjourney v6', 'Stable Diffusion XL', 'DALL·E 3', 'Google Imagen', 'ComfyUI', 'FLUX.1 [dev]']) {
      expect(aiMatch(s, 'tool')).toBeTruthy()
    }
  })

  it('text tier avoids ambiguous words', () => {
    expect(aiMatch('fireflies at night', 'text')).toBeNull()
    expect(aiMatch('the plane left the runway', 'text')).toBeNull()
    expect(aiMatch('my gemini rising sign', 'text')).toBeNull()
    expect(aiMatch('AI-generated image', 'text')).toBeTruthy()
    expect(aiMatch('made with Stable Diffusion', 'text')).toBeTruthy()
  })
})

describe('detectAi on EXIF', () => {
  it('flags AI software with an EXIF locator', () => {
    const tiff = tiffWith([asciiEntry(0x0131, 'Stable Diffusion XL')])
    const findings = detectAi({ tiff, xmp: null, c2paPayloads: [] })
    expect(findings).toHaveLength(1)
    expect(findings[0].exifTag).toEqual({ ifd: 'ifd0', tag: 0x0131 })
    expect(findings[0].severity).toBe('ai')
  })

  it('flags UserComment in the Exif sub-IFD', () => {
    const tiff = tiffWith([], [asciiEntry(0x9286, 'created by AI')])
    const findings = detectAi({ tiff, xmp: null, c2paPayloads: [] })
    expect(findings[0].exifTag).toEqual({ ifd: 'exif', tag: 0x9286 })
  })

  it('leaves clean metadata alone', () => {
    const tiff = tiffWith([asciiEntry(0x0131, 'Adobe Lightroom Classic 14.0'), asciiEntry(0x013b, 'Jane')])
    expect(detectAi({ tiff, xmp: null, c2paPayloads: [] })).toHaveLength(0)
  })

  it('flags JPEG comments mentioning AI', () => {
    const findings = detectAi({ tiff: null, xmp: null, c2paPayloads: [], comment: 'Edited with AI' })
    expect(findings[0].where).toBe('comment')
  })

  it('reports C2PA manifests, AI when the generator says so', () => {
    const gen = new Uint8Array([...'{"claim_generator":"OpenAI DALL-E 3"}'].map((c) => c.charCodeAt(0)))
    const plain = new Uint8Array([0, 0, 0x6a, 0x70, 1, 2, 3])
    const findings = detectAi({ tiff: null, xmp: null, c2paPayloads: [gen, plain] })
    expect(findings).toHaveLength(2)
    expect(findings.find((f) => f.severity === 'ai')?.where).toBe('c2pa')
    expect(findings.find((f) => f.severity === 'provenance')).toBeTruthy()
  })
})
