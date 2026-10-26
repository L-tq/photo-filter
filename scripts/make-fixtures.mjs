#!/usr/bin/env node
/**
 * Generates test photos in samples/: clean.jpg, ai.jpg (AI-marked metadata +
 * fake C2PA manifest), meta.png. Base pixels come from Python/PIL if present.
 * The EXIF/XMP/JPEG/PNG assembly here is deliberately independent of the app's
 * own libraries, so it doubles as a cross-check.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'samples')
mkdirSync(OUT, { recursive: true })

// ---------------------------------------------------------------- base pixels
const pyScript = `
from PIL import Image, ImageDraw
W, H = 1280, 960
img = Image.new('RGB', (W, H))
d = ImageDraw.Draw(img)
for y in range(H):
    t = y / H
    d.line([(0, y), (W, y)], fill=(int(24 + 190 * t), int(18 + 120 * t), int(70 - 40 * t)))
d.ellipse([W // 2 - 150, H // 2 - 150, W // 2 + 150, H // 2 + 150], fill=(255, 232, 186))
for i in range(14):
    x = int(i * W / 14)
    d.rectangle([x, H - 260 - (i % 3) * 60, x + 46, H], fill=(16, 12, 9))
d.polygon([(0, H), (int(W * 0.42), int(H * 0.4)), (int(W * 0.7), H)], fill=(20, 15, 10))
img.save('${OUT}/base.jpg', quality=94)
img.save('${OUT}/base.png')
img.resize((96, 72)).save('${OUT}/thumb.jpg', quality=82)
`
try {
  execFileSync('python3', ['-c', pyScript], { stdio: 'inherit' })
} catch {
  if (!existsSync(join(OUT, 'base.jpg'))) {
    console.error('PIL unavailable and no base.jpg — cannot build fixtures.')
    process.exit(1)
  }
}

const baseJpg = readFileSync(join(OUT, 'base.jpg'))
const basePng = readFileSync(join(OUT, 'base.png'))
const thumb = readFileSync(join(OUT, 'thumb.jpg'))

// ---------------------------------------------------------------- TIFF builder
const T = {
  ASCII: 2, SHORT: 3, LONG: 4, RATIONAL: 5, UNDEFINED: 7,
}
const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1 }

function buildExif({ ai }) {
  const ascii = (s) => [...Buffer.from(s, 'latin1'), 0]
  const u16 = (v) => [v & 0xff, (v >>> 8) & 0xff]
  const u32 = (v) => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff]

  const userComment = [
    ...[...Buffer.from('ASCII', 'latin1')], 0, 0, 0,
    ...Buffer.from(ai ? 'Image generated with AI' : 'Developed with care', 'latin1'),
  ]
  const makerNote = Array.from({ length: 160 }, (_, i) => (i * 7) & 0xff)

  const ifd0 = [
    [0x010f, T.ASCII, ascii('TestCamWorks')],
    [0x0110, T.ASCII, ascii('X-100')],
    [0x0112, T.SHORT, u16(1)],
    [0x0131, T.ASCII, ascii(ai ? 'Stable Diffusion XL' : 'Mistdark Lab 1.0')],
    [0x0132, T.ASCII, ascii('2026:10:24 18:42:07')],
    [0x013b, T.ASCII, ascii('Jane Photographer')],
    [0x8298, T.ASCII, ascii('© 2026 Jane Photographer')],
  ]
  const exifIfd = [
    [0x829a, T.RATIONAL, [...u32(1), ...u32(250)]],
    [0x829d, T.RATIONAL, [...u32(28), ...u32(10)]],
    [0x8827, T.SHORT, u16(200)],
    [0x9003, T.ASCII, ascii('2026:10:24 18:42:07')],
    [0x920a, T.RATIONAL, [...u32(350), ...u32(10)]],
    [0x927c, T.UNDEFINED, makerNote],
    [0x9286, T.UNDEFINED, userComment],
    [0xa434, T.ASCII, ascii('TestCam 35mm f/2')],
    [0xea1c, T.UNDEFINED, [9, 9, 9, 9, 9, 9]], // unknown/proprietary tag
  ]
  const gpsIfd = [
    [0x0000, T.UNDEFINED, [2, 3, 0, 0]],
    [0x0001, T.ASCII, ascii('N')],
    [0x0002, T.RATIONAL, [...u32(48), ...u32(1), ...u32(51), ...u32(1), ...u32(50130), ...u32(1000)]],
    [0x0003, T.ASCII, ascii('E')],
    [0x0004, T.RATIONAL, [...u32(2), ...u32(1), ...u32(21), ...u32(1), ...u32(8340), ...u32(1000)]],
    [0x0006, T.RATIONAL, [...u32(35), ...u32(1)]],
    [0x0012, T.ASCII, ascii('WGS-84')],
  ]
  const ifd1 = [
    [0x0103, T.SHORT, u16(6)],
    [0x0202, T.LONG, u32(thumb.length)],
  ]

  // --- pass 1: IFD block offsets (each block: 2 + n*12 + 4) ---
  const size = (n) => 2 + n * 12 + 4
  const ifd0Off = 8
  const ifd1Off = ifd0Off + size(ifd0.length + 2) // + exif & gps pointers
  const exifOff = ifd1Off + size(ifd1.length + 1) // + thumbnail offset pointer
  const gpsOff = exifOff + size(exifIfd.length)

  // --- pass 2: data-area allocation for out-of-line values ---
  let cursor = gpsOff + size(gpsIfd.length)
  const slot = (entry) => {
    const byteLen = entry[2].length // payload is already serialized bytes
    if (byteLen <= 4) return -1
    if (cursor % 2) cursor++
    const off = cursor
    cursor += byteLen
    return off
  }
  const slots = new Map()
  for (const e of [...ifd0, ...ifd1, ...exifIfd, ...gpsIfd]) slots.set(e, slot(e))
  if (cursor % 2) cursor++
  const thumbOff = cursor
  cursor += thumb.length
  const total = cursor

  // pointer entry payloads now that offsets are known
  const ptrs0 = [
    [0x8769, T.LONG, u32(exifOff)],
    [0x8825, T.LONG, u32(gpsOff)],
  ]
  const ptrs1 = [[0x0201, T.LONG, u32(thumbOff)]]

  // --- pass 3: serialize ---
  const out = Buffer.alloc(total)
  let p = 0
  const w8 = (v) => { out[p++] = v & 0xff }
  const w16 = (v) => { w8(v); w8(v >>> 8) }
  const w32 = (v) => { w16(v & 0xffff); w16((v >>> 16) & 0xffff) }
  const wbytes = (arr) => { for (const v of arr) w8(v) }
  const at = (off) => { p = off }
  const padTo = (off) => { while (p < off) w8(0) }

  out[0] = 0x49; out[1] = 0x49
  at(2); w16(42); w32(ifd0Off)

  const writeIfd = (entries, nextOff) => {
    const all = [...entries].sort((a, x) => a[0] - x[0])
    w16(all.length)
    for (const entry of all) {
      const [tag, type, payload] = entry
      const count = payload.length / TYPE_SIZE[type]
      const byteLen = payload.length
      w16(tag); w16(type); w32(count)
      if (byteLen <= 4) {
        wbytes(payload)
        for (let i = payload.length; i < 4; i++) w8(0)
      } else {
        w32(slots.get(entry) ?? 0)
      }
    }
    w32(nextOff)
  }

  at(ifd0Off); writeIfd([...ifd0, ...ptrs0], ifd1Off)
  at(ifd1Off); writeIfd([...ifd1, ...ptrs1], 0)
  at(exifOff); writeIfd(exifIfd, 0)
  at(gpsOff); writeIfd(gpsIfd, 0)

  const dump = (entries) => {
    for (const e of entries) {
      const off = slots.get(e)
      if (off !== undefined && off >= 0) { at(off); wbytes(e[2]) }
    }
  }
  dump(ifd0); dump(ifd1); dump(exifIfd); dump(gpsIfd)
  at(thumbOff); wbytes([...thumb])
  return out
}

// ---------------------------------------------------------------- JPEG assembly
function injectJpeg(base, segments) {
  const parts = []
  const bu = Buffer.from(base)
  if (!(bu[0] === 0xff && bu[1] === 0xd8)) throw new Error('base not jpeg')
  parts.push(bu.subarray(0, 2))
  let pos = 2
  let inserted = false
  while (pos + 4 <= bu.length) {
    if (bu[pos] !== 0xff) break
    const marker = bu[pos + 1]
    if (marker === 0xda) break
    const len = (bu[pos + 2] << 8) | bu[pos + 3]
    if (!inserted && marker !== 0xe0) {
      for (const s of segments) {
        const p = Buffer.from(s.data)
        parts.push(Buffer.from([0xff, s.marker, (p.length + 2) >> 8, (p.length + 2) & 0xff]), p)
      }
      inserted = true
    }
    parts.push(bu.subarray(pos, pos + 2 + len))
    pos += 2 + len
  }
  if (!inserted) {
    for (const s of segments) {
      const p = Buffer.from(s.data)
      parts.push(Buffer.from([0xff, s.marker, (p.length + 2) >> 8, (p.length + 2) & 0xff]), p)
    }
  }
  parts.push(bu.subarray(pos))
  return Buffer.concat(parts)
}

const EXIF_SIG = Buffer.from([0x45, 0x78, 0x69, 0x66, 0, 0])
const XMP_SIG = Buffer.from('http://ns.adobe.com/xap/1.0/\0', 'latin1')

const xmp = (inner) => `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmlns:Iptc4xmpCore="http://iptc.org/std/Iptc4xmpCore/1.0/xmlns/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""${inner}>
   <dc:title><rdf:Alt><rdf:li xml:lang="x-default">Harbor dusk</rdf:li></rdf:Alt></dc:title>
   <dc:creator><rdf:Seq><rdf:li>Jane Photographer</rdf:li></rdf:Seq></dc:creator>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`

const cleanXmp = xmp('')
const aiXmp = xmp(`
    Iptc4xmpCore:digitalSourceType="urn:iptc:std:digitalSourceType:2018:trainedAlgorithmicMedia"
    xmp:CreatorTool="Adobe Firefly 2025"`)

// clean.jpg — realistic camera metadata, no AI
writeFileSync(
  join(OUT, 'clean.jpg'),
  injectJpeg(baseJpg, [
    { marker: 0xe1, data: Buffer.concat([EXIF_SIG, buildExif({ ai: false })]) },
    { marker: 0xe1, data: Buffer.concat([XMP_SIG, Buffer.from(cleanXmp, 'utf8')]) },
  ]),
)

// ai.jpg — AI software tag, AI UserComment, AI XMP, fake C2PA manifest (APP11)
const c2pa = Buffer.concat([
  Buffer.from([0, 0, 0, 0x40, 0x6a, 0x75, 0x6d, 0x62]), // seq + JUMBF-ish box header
  Buffer.from(JSON.stringify({
    urn: 'urn:c2pa:manifest',
    claim_generator: 'OpenAI DALL·E 3',
    assertions: [{ label: 'c2pa.actions', actions: [{ action: 'plated', softwareAgent: 'Stable Diffusion' }] }],
  }), 'latin1'),
])
writeFileSync(
  join(OUT, 'ai.jpg'),
  injectJpeg(baseJpg, [
    { marker: 0xe1, data: Buffer.concat([EXIF_SIG, buildExif({ ai: true })]) },
    { marker: 0xe1, data: Buffer.concat([XMP_SIG, Buffer.from(aiXmp, 'utf8')]) },
    { marker: 0xeb, data: c2pa },
  ]),
)

// meta.png — eXIf chunk + XMP iTXt naming an AI tool
const CRC = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return (buf) => {
    let c = 0xffffffff
    for (const byte of buf) c = t[(c ^ byte) & 0xff] ^ (c >>> 8)
    return Buffer.from([(c ^ 0xffffffff) >>> 24 & 255, (c ^ 0xffffffff) >>> 16 & 255, (c ^ 0xffffffff) >>> 8 & 255, (c ^ 0xffffffff) & 255])
  }
})()

function chunk(type, data) {
  return Buffer.concat([
    Buffer.from([data.length >>> 24, (data.length >>> 16) & 255, (data.length >>> 8) & 255, data.length & 255]),
    Buffer.from(type, 'latin1'),
    data,
    CRC(Buffer.concat([Buffer.from(type, 'latin1'), data])),
  ])
}

const pngXmp = `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:xmp="http://ns.adobe.com/xap/1.0/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about="" xmp:CreatorTool="ComfyUI">
   <dc:title><rdf:Alt><rdf:li xml:lang="x-default">Harbor dusk</rdf:li></rdf:Alt></dc:title>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`
const iTXt = Buffer.concat([
  Buffer.from('XML:com.adobe.xmp\0', 'latin1'),
  Buffer.from([0, 0, 0, 0]),
  Buffer.from(pngXmp, 'utf8'),
])

{
  const bu = Buffer.from(basePng)
  const ihdrEnd = 8 + 25 // sig + IHDR chunk
  const out = Buffer.concat([
    bu.subarray(0, ihdrEnd),
    chunk('eXIf', buildExif({ ai: false })),
    chunk('iTXt', iTXt),
    bu.subarray(ihdrEnd),
  ])
  writeFileSync(join(OUT, 'meta.png'), out)
}

console.log('fixtures written to samples/: clean.jpg, ai.jpg, meta.png (+ base.jpg/png, thumb.jpg)')
