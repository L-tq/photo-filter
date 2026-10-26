/**
 * Minimal store-only ZIP writer — used to bundle multi-photo exports into a
 * single archive. Entries are stored uncompressed (method 0): the payloads are
 * already-compressed JPEG/PNG bytes, so deflating them would waste CPU for no
 * meaningful size win.
 *
 * Layout: [local file header + data] × N, central directory, end-of-record.
 * Filenames are written as UTF-8 with general-purpose flag 0x0800 set, so
 * non-ASCII names (e.g. Chinese) survive extraction. Sizes stay under 4 GB,
 * which keeps the format's classic 32-bit fields valid — no ZIP64.
 */

import { crc32 } from './png'

export interface ZipEntry {
  name: string
  data: Uint8Array
}

/** DOS-format timestamp (2-second resolution, years since 1980). */
function dosDateTime(d: Date): { time: number; date: number } {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
  return { time, date }
}

function writeU16(v: DataView, offset: number, value: number): void {
  v.setUint16(offset, value, true)
}

function writeU32(v: DataView, offset: number, value: number): void {
  v.setUint32(offset, value, true)
}

export function createZip(entries: ZipEntry[], now = new Date()): Uint8Array {
  const encoder = new TextEncoder()
  const { time, date } = dosDateTime(now)

  const locals: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name)
    const crc = crc32(entry.data)
    const size = entry.data.byteLength

    // Local file header: signature, version 20, UTF-8 flag, store, sizes, name.
    const local = new Uint8Array(30 + nameBytes.byteLength)
    const lv = new DataView(local.buffer)
    writeU32(lv, 0, 0x04034b50)
    writeU16(lv, 4, 20)
    writeU16(lv, 6, 0x0800)
    writeU16(lv, 8, 0)
    writeU16(lv, 10, time)
    writeU16(lv, 12, date)
    writeU32(lv, 14, crc)
    writeU32(lv, 18, size)
    writeU32(lv, 22, size)
    writeU16(lv, 26, nameBytes.byteLength)
    writeU16(lv, 28, 0)
    local.set(nameBytes, 30)

    // Central directory record mirrors the local header plus the offset.
    const cd = new Uint8Array(46 + nameBytes.byteLength)
    const cv = new DataView(cd.buffer)
    writeU32(cv, 0, 0x02014b50)
    writeU16(cv, 4, 20)
    writeU16(cv, 6, 20)
    writeU16(cv, 8, 0x0800)
    writeU16(cv, 10, 0)
    writeU16(cv, 12, time)
    writeU16(cv, 14, date)
    writeU32(cv, 16, crc)
    writeU32(cv, 20, size)
    writeU32(cv, 24, size)
    writeU16(cv, 28, nameBytes.byteLength)
    writeU16(cv, 30, 0)
    writeU16(cv, 32, 0)
    writeU16(cv, 34, 0)
    writeU16(cv, 36, 0)
    writeU32(cv, 38, 0)
    writeU32(cv, 42, offset)
    cd.set(nameBytes, 46)

    locals.push(local, entry.data)
    central.push(cd)
    offset += local.byteLength + size
  }

  const centralSize = central.reduce((n, c) => n + c.byteLength, 0)
  const eocd = new Uint8Array(22)
  const ev = new DataView(eocd.buffer)
  writeU32(ev, 0, 0x06054b50)
  writeU16(ev, 4, 0)
  writeU16(ev, 6, 0)
  writeU16(ev, 8, entries.length)
  writeU16(ev, 10, entries.length)
  writeU32(ev, 12, centralSize)
  writeU32(ev, 16, offset)
  writeU16(ev, 20, 0)

  const total = offset + centralSize + 22
  const out = new Uint8Array(total)
  let at = 0
  for (const part of [...locals, ...central, eocd]) {
    out.set(part, at)
    at += part.byteLength
  }
  return out
}
