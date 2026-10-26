#!/usr/bin/env node
/**
 * Verifies an exported photo against its original:
 *   node scripts/verify-export.mjs <original> <exported> [--expect key=value,...] [--expect-missing key,...] [--expect-byte-identical]
 *
 * Checks:
 *  - identical pixel dimensions
 *  - no AI keywords anywhere in the exported bytes / metadata
 *  - every original EXIF tag still present with an equal value, except those
 *    listed in --expect-missing or overridden by --expect key=value
 *  - --expect-byte-identical: files are byte-identical (lossless passthrough)
 */
import { readFileSync } from 'node:fs'
import exifr from 'exifr'

const args = process.argv.slice(2)
const paths = args.filter((a) => !a.startsWith('--'))
const flags = new Set(args.filter((a) => a.startsWith('--')))
const opt = (name) => {
  const a = args.find((x) => x.startsWith(`--${name}=`))
  return a ? a.slice(name.length + 3) : null
}
const expect = opt('expect') // key=value,key=value
const expectMissing = opt('expect-missing') // key,key

const fails = []
const passes = []
const check = (ok, msg) => (ok ? passes : fails).push(msg)

const [origPath, expPath] = paths
if (!origPath || !expPath) {
  console.error('usage: verify-export.mjs <original> <exported> [flags]')
  process.exit(2)
}

const origBuf = readFileSync(origPath)
const expBuf = readFileSync(expPath)

const parseOpts = { tiff: true, exif: true, gps: true, ifd1: true, xmp: false, translateValues: false, reviveValues: false, mergeOutput: false }
const orig = await exifr.parse(origBuf, parseOpts)
const exp = await exifr.parse(expBuf, parseOpts)

// 1. dimensions (independent SOF/IHDR read)
function dimensions(buf) {
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let pos = 2
    while (pos + 8 < buf.length) {
      if (buf[pos] !== 0xff) return null
      const marker = buf[pos + 1]
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: buf.readUInt16BE(pos + 5), width: buf.readUInt16BE(pos + 7) }
      }
      if (marker === 0xda) return null
      pos += 2 + buf.readUInt16BE(pos + 2)
    }
    return null
  }
  if (buf.readUInt32BE(0) === 0x89504e47) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
  }
  return null
}
const oSize = dimensions(origBuf)
const eSize = dimensions(expBuf)
check(
  oSize && eSize && oSize.width === eSize.width && oSize.height === eSize.height,
  `dimensions match (${eSize?.width}×${eSize?.height})`,
)

// 2. AI keywords must not survive
const AI_RE = /(dall[·.\-\s]?e|midjourney|stable[\-\s]?diffusion|sdxl|comfyui|firefly|trainedalgorithmicmedia|algorithmicmedia|openai|synthid|generative[\-\s]?(ai|model|fill)|ai[\-\s]?(generated|edited|assisted|enhanced)|claim_generator)/i
const latin1 = expBuf.toString('latin1')
check(!AI_RE.test(latin1), `exported bytes contain no AI markers`)

// 3. tag preservation (merged view for friendly keys)
const origFlat = await exifr.parse(origBuf, { tiff: true, exif: true, gps: true, xmp: false })
const expFlat = (await exifr.parse(expBuf, { tiff: true, exif: true, gps: true, xmp: false })) ?? {}
const overrides = Object.fromEntries((expect ?? '').split(',').filter(Boolean).map((kv) => kv.split('=')))
const missing = new Set((expectMissing ?? '').split(',').filter(Boolean))

const norm = (v) => {
  if (v == null) return String(v)
  if (Array.isArray(v)) return v.map(norm).join(',')
  if (typeof v === 'number') return String(Math.round(v * 1e6) / 1e6)
  return String(v).trim()
}

for (const [key, value] of Object.entries(origFlat ?? {})) {
  if (key === 'thumbnail' || typeof value === 'object' && value !== null && !Array.isArray(value)) continue
  const nv = norm(value)
  if (key in overrides) {
    check(norm(expFlat[key]) === overrides[key], `${key} edited to “${overrides[key]}”`)
  } else if (missing.has(key)) {
    check(!(key in (expFlat ?? {})), `${key} removed`)
  } else {
    const same = norm(expFlat[key]) === nv
    check(same, `${key} preserved (${nv.slice(0, 40)})`)
  }
}
for (const key of missing) {
  if (!(key in (origFlat ?? {}))) check(true, `${key} (was absent, still absent)`)
}

// 4. optional byte-identity
if (flags.has('--expect-byte-identical')) {
  check(origBuf.equals(expBuf), 'files are byte-identical (lossless passthrough)')
}

console.log(`\n${origPath} → ${expPath}\n`)
for (const p of passes) console.log(`  ✓ ${p}`)
for (const f of fails) console.log(`  ✗ FAIL: ${f}`)
console.log(`\n${passes.length} passed, ${fails.length} failed`)
process.exit(fails.length ? 1 : 0)
