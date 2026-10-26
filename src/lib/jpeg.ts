/**
 * JPEG segment scanner/rebuilder.
 *
 * Parses the marker segments that precede the scan (SOS) into a list, keeping
 * everything from SOS to EOF as an opaque tail. `serializeJpeg` re-emits the
 * file byte-for-byte as long as segments were not modified, which is what
 * makes lossless metadata surgery possible.
 */

export const SOI = 0xd8
export const SOS = 0xda
export const APP0 = 0xe0
export const APP1 = 0xe1
export const APP2 = 0xe2
export const APP11 = 0xeb
export const APP13 = 0xed
export const COM = 0xfe

export interface JpegSegment {
  marker: number
  /** Segment payload, i.e. bytes after the marker and the 2-byte length. */
  payload: Uint8Array
}

export interface JpegFile {
  segments: JpegSegment[]
  /** From the SOS marker (FFDA) through EOI / EOF, verbatim. */
  tail: Uint8Array
}

export function parseJpeg(bytes: Uint8Array): JpegFile | null {
  if (bytes.byteLength < 4 || bytes[0] !== 0xff || bytes[1] !== SOI) return null
  const segments: JpegSegment[] = []
  let pos = 2
  while (pos + 4 <= bytes.byteLength) {
    if (bytes[pos] !== 0xff) return null // desynchronised → refuse rather than guess
    let marker = bytes[pos + 1]
    if (marker === 0xff) {
      pos++ // fill byte before a marker
      continue
    }
    if (marker === SOI || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      pos += 2 // standalone marker (unexpected before SOS, but harmless)
      continue
    }
    if (marker === SOS) {
      return { segments, tail: bytes.slice(pos) }
    }
    const len = (bytes[pos + 2] << 8) | bytes[pos + 3]
    if (len < 2 || pos + 2 + len > bytes.byteLength) return null
    segments.push({ marker, payload: bytes.slice(pos + 4, pos + 2 + len) })
    pos += 2 + len
  }
  return null
}

export function serializeJpeg(file: JpegFile): Uint8Array {
  const parts: Uint8Array[] = [new Uint8Array([0xff, SOI])]
  for (const s of file.segments) {
    const len = s.payload.byteLength + 2
    if (len > 0xffff) throw new Error(`segment 0x${s.marker.toString(16)} too large (${len} bytes)`)
    parts.push(new Uint8Array([0xff, s.marker, len >> 8, len & 0xff]), s.payload)
  }
  parts.push(file.tail)
  return concatBytes(parts)
}

export function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.byteLength, 0)
  const out = new Uint8Array(total)
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.byteLength
  }
  return out
}

// ---------------------------------------------------------------- classifiers

export const EXIF_SIG = new Uint8Array([0x45, 0x78, 0x69, 0x66, 0, 0]) // "Exif\0\0"
const XMP_SIG = asciiBytes('http://ns.adobe.com/xap/1.0/\0')
const ICC_SIG = asciiBytes('ICC_PROFILE\0')
const PSIR_SIG = asciiBytes('Photoshop 3.0\0') // APP13 Photoshop image resources

export function asciiBytes(s: string): Uint8Array {
  const b = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xff
  return b
}

function startsWith(payload: Uint8Array, sig: Uint8Array): boolean {
  if (payload.byteLength < sig.byteLength) return false
  for (let i = 0; i < sig.byteLength; i++) if (payload[i] !== sig[i]) return false
  return true
}

export function payloadContains(payload: Uint8Array, needleAscii: string): boolean {
  if (payload.byteLength < needleAscii.length) return false
  const n = asciiBytes(needleAscii)
  const limit = payload.byteLength - n.byteLength
  outer: for (let i = 0; i <= limit; i++) {
    for (let j = 0; j < n.byteLength; j++) if (payload[i + j] !== n[j]) continue outer
    return true
  }
  return false
}

export function isExifSegment(s: JpegSegment): boolean {
  return s.marker === APP1 && startsWith(s.payload, EXIF_SIG)
}

export function isXmpSegment(s: JpegSegment): boolean {
  return s.marker === APP1 && startsWith(s.payload, XMP_SIG)
}

export function isIccSegment(s: JpegSegment): boolean {
  return s.marker === APP2 && startsWith(s.payload, ICC_SIG)
}

export function isIptcSegment(s: JpegSegment): boolean {
  return s.marker === APP13 && startsWith(s.payload, PSIR_SIG)
}

/**
 * C2PA manifests ride in APP11 (JUMBF boxes per ISO 19566-3). Some writers
 * also embed the manifest in other segments, so scan for the URN too.
 */
export function isC2paSegment(s: JpegSegment): boolean {
  if (s.marker === APP11) return true
  return (
    (s.marker === APP1 || s.marker === APP2) &&
    (payloadContains(s.payload, 'urn:c2pa') || payloadContains(s.payload, 'c2pa:'))
  )
}

export function exifSegmentPayload(tiff: Uint8Array): Uint8Array {
  return concatBytes([EXIF_SIG, tiff])
}

export function xmpSegmentPayload(xml: string): Uint8Array {
  // XMP packets are UTF-8 by spec
  return concatBytes([XMP_SIG, new TextEncoder().encode(xml)])
}

/** XMP packet text from an APP1 XMP segment payload (UTF-8). */
export function xmpSegmentText(payload: Uint8Array): string {
  return new TextDecoder('utf-8').decode(payload.subarray(XMP_SIG.byteLength))
}

/** Segment payload as latin-1 text, for display/inspection. */
export function payloadText(payload: Uint8Array): string {
  let s = ''
  for (let i = 0; i < payload.byteLength; i++) s += String.fromCharCode(payload[i])
  return s
}
