/**
 * EXIF tag names, human value formatting and editability rules.
 */

import { translate, type Lang } from '../i18n'
import {
  decodeAscii,
  decodeNumberArray,
  decodeRationals,
  decodeUserComment,
  GPS_LATITUDE,
  GPS_LONGITUDE,
  TYPE_ASCII,
  TYPE_BYTE,
  TYPE_LONG,
  TYPE_RATIONAL,
  TYPE_SHORT,
  TYPE_SRATIONAL,
  TYPE_UNDEFINED,
  type IfdPath,
  type RawEntry,
} from './tiff'

const IFD0_NAMES: Record<number, string> = {
  0x0100: 'ImageWidth', 0x0101: 'ImageHeight', 0x0102: 'BitsPerSample',
  0x0103: 'Compression', 0x0106: 'PhotometricInterpretation', 0x010e: 'ImageDescription',
  0x010f: 'Make', 0x0110: 'Model', 0x0112: 'Orientation', 0x0115: 'SamplesPerPixel',
  0x011a: 'XResolution', 0x011b: 'YResolution', 0x011c: 'PlanarConfiguration',
  0x0128: 'ResolutionUnit', 0x0131: 'Software', 0x0132: 'DateTime', 0x013b: 'Artist',
  0x0213: 'YCbCrPositioning', 0x8298: 'Copyright',
}

const EXIF_NAMES: Record<number, string> = {
  0x829a: 'ExposureTime', 0x829d: 'FNumber', 0x8822: 'ExposureProgram',
  0x8827: 'ISO', 0x8830: 'SensitivityType', 0x8832: 'ISOSpeed',
  0x9000: 'ExifVersion', 0x9003: 'DateTimeOriginal', 0x9004: 'DateTimeDigitized',
  0x9101: 'ComponentsConfiguration', 0x9102: 'CompressedBitsPerPixel',
  0x9201: 'ShutterSpeedValue', 0x9202: 'ApertureValue', 0x9204: 'ExposureBias',
  0x9207: 'MeteringMode', 0x9208: 'LightSource', 0x9209: 'Flash', 0x920a: 'FocalLength',
  0x927c: 'MakerNote', 0x9286: 'UserComment', 0x9290: 'SubSecTime',
  0x9291: 'SubSecTimeOriginal', 0x9292: 'SubSecTimeDigitized',
  0xa000: 'FlashpixVersion', 0xa001: 'ColorSpace', 0xa002: 'PixelXDimension',
  0xa003: 'PixelYDimension', 0xa402: 'ExposureMode', 0xa403: 'WhiteBalance',
  0xa404: 'DigitalZoomRatio', 0xa405: 'FocalLengthIn35mmFilm', 0xa406: 'SceneCaptureType',
  0xa408: 'Contrast', 0xa409: 'Saturation', 0xa40a: 'Sharpness',
  0xa420: 'ImageUniqueID', 0xa430: 'CameraOwnerName', 0xa431: 'BodySerialNumber',
  0xa432: 'LensSpecification', 0xa433: 'LensMake', 0xa434: 'LensModel',
}

const GPS_NAMES: Record<number, string> = {
  0x0000: 'GPSVersionID', 0x0001: 'GPSLatitudeRef', 0x0002: 'GPSLatitude',
  0x0003: 'GPSLongitudeRef', 0x0004: 'GPSLongitude', 0x0005: 'GPSAltitudeRef',
  0x0006: 'GPSAltitude', 0x0007: 'GPSTimeStamp', 0x0010: 'GPSImgDirection',
  0x0012: 'GPSMapDatum', 0x001b: 'GPSProcessingMethod', 0x001d: 'GPSDateStamp',
  0x001f: 'GPSHPositioningError',
}

const IFD1_NAMES: Record<number, string> = {
  0x0112: 'ThumbnailOrientation', 0x0202: 'ThumbnailLength',
  0x011a: 'ThumbnailXResolution', 0x011b: 'ThumbnailYResolution', 0x0213: 'YCbCrPositioning',
}

const INTEROP_NAMES: Record<number, string> = {
  0x0001: 'InteroperabilityIndex', 0x0002: 'InteroperabilityVersion',
  0x1001: 'RelatedImageWidth', 0x1002: 'RelatedImageHeight',
}

export const TAG_USER_COMMENT = 0x9286
export const TAG_IMAGE_DESCRIPTION = 0x010e
export const TAG_SOFTWARE = 0x0131
export const TAG_ARTIST = 0x013b
export const TAG_DATETIME_ORIGINAL = 0x9003

export function tagName(ifd: IfdPath, tag: number): string {
  const table =
    ifd === 'ifd0' ? IFD0_NAMES :
    ifd === 'exif' ? EXIF_NAMES :
    ifd === 'gps' ? GPS_NAMES :
    ifd === 'ifd1' ? IFD1_NAMES :
    INTEROP_NAMES
  return table[tag] ?? `Tag 0x${tag.toString(16).padStart(4, '0')}`
}

export type ExifGroup = 'photo' | 'gps' | 'thumbnail'

export function groupOf(ifd: IfdPath): ExifGroup {
  if (ifd === 'gps') return 'gps'
  if (ifd === 'ifd1') return 'thumbnail'
  return 'photo'
}

/** Human-readable value for display; never throws. */
export function formatEntryValue(le: boolean, e: RawEntry, ifd: IfdPath, lang: Lang = 'en'): string {
  try {
    if (e.tag === TAG_USER_COMMENT) return decodeUserComment(e.value) || translate(lang, 'valueEmpty')
    if (e.type === TYPE_ASCII) return decodeAscii(e.value) || translate(lang, 'valueEmpty')
    if (e.type === TYPE_UNDEFINED) {
      if (ifd === 'gps' && e.tag === 0x001b) return decodeAscii(e.value.subarray(8)) || translate(lang, 'valueEmpty')
      const text = decodeAscii(e.value)
      if (text.length >= Math.max(1, e.value.byteLength - 2) && /^[\x20-\x7e\u00a0-\uffff]*$/.test(text)) {
        return text || translate(lang, 'valueEmpty')
      }
      if (e.value.byteLength > 24) {
        return translate(lang, 'valueBytes', { n: e.value.byteLength.toLocaleString() })
      }
      return '0x' + Array.from(e.value).map((b) => b.toString(16).padStart(2, '0')).join(' ')
    }
    if (e.type === TYPE_RATIONAL || e.type === TYPE_SRATIONAL) {
      const pairs = decodeRationals(e, le)
      if (ifd === 'gps' && (e.tag === GPS_LATITUDE || e.tag === GPS_LONGITUDE) && pairs.length === 3) {
        return pairs.map(([n, d]) => `${n}/${d}`).join(', ')
      }
      return pairs.map(([n, d]) => (d === 1 ? `${n}` : `${n}/${d}`)).join(', ')
    }
    const nums = decodeNumberArray(e, le)
    if (nums.length > 12) {
      return `${nums.slice(0, 12).join(', ')} ${translate(lang, 'valueMany', { n: nums.length })}`
    }
    return nums.join(', ') || translate(lang, 'valueEmpty')
  } catch {
    return translate(lang, 'valueUnreadable')
  }
}

export type EditKind = 'text' | 'number' | 'gps-lat' | 'gps-lon' | null

const NUMERIC_SINGLE = new Set([TYPE_BYTE, TYPE_SHORT, TYPE_LONG, TYPE_RATIONAL, TYPE_SRATIONAL, 6, 8, 9])

/** Which UI editor a row supports; null = read-only. */
export function editKind(ifd: IfdPath, e: RawEntry): EditKind {
  if (ifd === 'gps') {
    if (e.tag === GPS_LATITUDE) return 'gps-lat'
    if (e.tag === GPS_LONGITUDE) return 'gps-lon'
    if (e.tag === 0x0001 || e.tag === 0x0003) return null // refs auto-managed with coordinates
  }
  if (e.type === TYPE_ASCII) return 'text'
  if (e.tag === TAG_USER_COMMENT && e.type === TYPE_UNDEFINED) return 'text'
  if (e.type === TYPE_UNDEFINED) return null
  if (e.count === 1 && NUMERIC_SINGLE.has(e.type)) return 'number'
  return null
}
