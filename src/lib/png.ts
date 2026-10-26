/**
 * PNG chunk scanner/rebuilder with CRC computation.
 *
 * Metadata lives in ancillary chunks: eXIf (TIFF blob), iTXt with the
 * "XML:com.adobe.xmp" keyword (XMP packet), c2pa/caBX (C2PA manifest).
 * eXIf must be inserted after IHDR and before the first IDAT.
 */

export const PNG_SIG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

export interface PngChunk {
  type: string
  data: Uint8Array
}

export interface PngFile {
  chunks: PngChunk[]
  /** Bytes after IEND (rare, kept verbatim). */
  tail: Uint8Array
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < data.byteLength; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

export function parsePng(bytes: Uint8Array): PngFile | null {
  if (bytes.byteLength < 8) return null
  for (let i = 0; i < 8; i++) if (bytes[i] !== PNG_SIG[i]) return null
  const chunks: PngChunk[] = []
  let pos = 8
  while (pos + 12 <= bytes.byteLength) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset + pos, 8)
    const len = dv.getUint32(0)
    if (len > 0x7fff_ffff || pos + 12 + len > bytes.byteLength) return null
    const type =
      String.fromCharCode(bytes[pos + 4], bytes[pos + 5], bytes[pos + 6], bytes[pos + 7])
    chunks.push({ type, data: bytes.slice(pos + 8, pos + 8 + len) })
    pos += 12 + len
    if (type === 'IEND') return { chunks, tail: bytes.slice(pos) }
  }
  return null
}

export function serializePng(file: PngFile): Uint8Array {
  const parts: Uint8Array[] = [PNG_SIG]
  for (const c of file.chunks) {
    const head = new Uint8Array(8)
    new DataView(head.buffer).setUint32(0, c.data.byteLength)
    for (let i = 0; i < 4; i++) head[4 + i] = c.type.charCodeAt(i)
    const typeBytes = head.subarray(4)
    const crcBytes = new Uint8Array(4)
    const crc = crc32(concat3(typeBytes, c.data))
    new DataView(crcBytes.buffer).setUint32(0, crc)
    parts.push(head, c.data, crcBytes)
  }
  parts.push(file.tail)
  return concatBytes(parts)
}

function concat3(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.byteLength + b.byteLength)
  out.set(a)
  out.set(b, a.byteLength)
  return out
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.byteLength, 0)
  const out = new Uint8Array(total)
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.byteLength
  }
  return out
}

// ---------------------------------------------------------------- metadata chunks

const XMP_KEYWORD = 'XML:com.adobe.xmp'

export function isXmpChunk(c: PngChunk): boolean {
  if (c.type !== 'iTXt') return false
  const data = c.data
  for (let i = 0; i < Math.min(data.byteLength, 40); i++) {
    if (data[i] === 0) return payloadStartsWith(data.subarray(0, i), XMP_KEYWORD)
  }
  return false
}

function payloadStartsWith(data: Uint8Array, s: string): boolean {
  if (data.byteLength < s.length) return false
  for (let i = 0; i < s.length; i++) if (data[i] !== s.charCodeAt(i)) return false
  return true
}

/** iTXt payload: keyword\0 compFlag compMethod languageTag\0 translatedKeyword\0 text */
export function makeXmpChunk(xml: string): PngChunk {
  const prefix = new Uint8Array([
    ...bytesOf(XMP_KEYWORD),
    0, // keyword NUL
    0, // compression flag: uncompressed
    0, // compression method
    0, // empty language tag
    0, // empty translated keyword
  ])
  const text = new TextEncoder().encode(xml)
  const data = new Uint8Array(prefix.byteLength + text.byteLength)
  data.set(prefix)
  data.set(text, prefix.byteLength)
  return { type: 'iTXt', data }
}

function bytesOf(s: string): number[] {
  const out: number[] = []
  for (let i = 0; i < s.length; i++) out.push(s.charCodeAt(i) & 0xff)
  return out
}

export function xmpChunkText(c: PngChunk): string {
  // skip keyword\0 flag method lang\0 translated\0 (5 NUL-delimited/flag bytes)
  const data = c.data
  let nul = data.indexOf(0)
  let pos = nul + 1 + 2 // keyword + flag + method
  // language tag
  nul = data.indexOf(0, pos)
  pos = nul + 1
  // translated keyword
  nul = data.indexOf(0, pos)
  pos = nul + 1
  return new TextDecoder().decode(data.subarray(pos))
}

export function isC2paChunk(c: PngChunk): boolean {
  return c.type === 'c2pa' || c.type === 'caBX'
}
