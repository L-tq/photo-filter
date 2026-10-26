/**
 * Tiny i18n: two locales (en / zh), template interpolation ({n}), React
 * context + hook. The English dictionary defines the key set; the Chinese
 * dictionary must match it (enforced by its type).
 */

import { createContext, useCallback, useContext } from 'react'

export type Lang = 'en' | 'zh'

const en = {
  tagline: 'diffusion & metadata darkroom',
  newPhoto: 'New photo',

  // dropzone
  dropTitleA: 'Drop a photo',
  dropTitleB: 'into the darkroom',
  dropSub: 'Apply diffusion filters, inspect metadata, strip AI markers — then export at full resolution.',
  dropHint: 'JPEG · PNG — click or drag · nothing leaves this device',
  developing: 'Developing…',

  // tabs & panels
  tabFilters: 'Filters',
  tabMetadata: 'Metadata',
  aiCount: '{n} AI',
  editCount: '{n}',

  // filter panel
  filterTitle: 'Diffusion',
  filterSub: 'Pro-Mist style optical looks. Drag the divider on the preview to compare.',
  filterNone: 'Original',
  filterBlack: 'Black Mist',
  filterWhite: 'White Mist',
  filterNoneDesc: 'Untouched pixels',
  filterBlackDesc: 'Bloom with deep blacks',
  filterWhiteDesc: 'Dreamy haze, lifted shadows',
  paramStrength: 'Strength',
  paramDiffusion: 'Diffusion',
  paramBloom: 'Bloom',
  paramStrengthHint: 'Blend amount of the diffusion',
  paramDiffusionHint: 'Softness / blur radius',
  paramBloomHint: 'Veil everywhere → highlights only',
  resetParams: 'reset parameters',

  // stage
  tagOriginal: 'ORIGINAL',
  holdOriginal: 'Hold to view original',
  exportsAt: 'exports at {w}×{h}',
  zoomIn: 'Zoom in',
  zoomOut: 'Zoom out',
  zoomFit: 'Fit to view',

  // metadata panel
  metaTitle: 'Metadata',
  metaSub: 'EXIF is read directly from the file. Edits apply on export; everything untouched is preserved bit-for-bit.',
  aiBannerTitle: 'AI-generated / AI-edited markers found — {n}',
  aiBannerNote: 'These tags are highlighted below and removed automatically when you export.',
  searchPlaceholder: 'Search tags & values…',
  resetEdits: 'reset {n} edits',
  groupPhoto: 'Camera & photo',
  groupGps: 'Location',
  groupThumb: 'Embedded thumbnail',
  groupXmp: 'XMP packet',
  xmpReadOnly: 'read-only',
  xmpCleaned: 'read-only · cleaned on export',
  removedOnExport: ' — removed on export',
  rowDeleted: 'This tag will be removed on export',
  rowEdited: 'Edited value (applied on export)',
  rowEdit: 'Edit value',
  rowDelete: 'Remove this tag on export',
  rowUndo: 'Undo edit',
  emptyMeta: 'No EXIF or XMP metadata found in this file.',
  preserveNote: 'GPS coordinates, maker notes, thumbnails and unknown tags are preserved through export.',
  searchLabel: 'Search metadata',
  valueEmpty: '(empty)',
  valueUnreadable: '(unreadable)',
  valueBytes: '{n} bytes of data (preserved)',
  valueThumb: '{n} byte embedded thumbnail (preserved)',
  valueMany: '… ({n} values)',

  // findings
  whereExif: 'EXIF',
  whereXmp: 'XMP',
  whereC2pa: 'C2PA',
  whereComment: 'Comment',
  reasonExifSoftware: 'EXIF Software names AI software (“{kw}”)',
  reasonExifText: 'EXIF {tag} mentions AI (“{kw}”)',
  reasonComment: 'JPEG comment mentions AI (“{kw}”)',
  reasonXmpSource: 'IPTC DigitalSourceType marks the image as AI-generated (trainedAlgorithmicMedia)',
  reasonXmpTool: 'XMP {tag} names AI software (“{kw}”)',
  reasonXmpText: 'XMP {tag} mentions AI (“{kw}”)',
  reasonC2paAi: 'C2PA Content Credentials manifest present, generator mentions AI (“{kw}”)',
  reasonC2pa: 'C2PA Content Credentials manifest present (provenance data; stripped on export)',
  c2paValue: '{n}-byte manifest',

  // warnings
  warnJpegUnparsed: 'JPEG structure could not be parsed — export will re-encode the image.',
  warnPngUnparsed: 'PNG structure could not be parsed — export will re-encode the image.',

  // export
  jpegQuality: 'JPEG quality',
  pngLossless: 'PNG (lossless)',
  aiRemovedNote: ' · AI tags removed',
  exportBtn: 'Export photo',
  exportBusy: 'Developing…',
  exportFailed: 'Export failed.',
  savedNote: 'Saved {name} ({n} bytes)',
  noteLossless: 'No filter applied — original image data kept bit-for-bit.',
  noteExifTooLarge: 'The EXIF block grew past the JPEG segment limit and was omitted from the export.',
  noteNoExif: 'No EXIF metadata was present or it could not be parsed.',
  noteExifAiRemoved: 'Removed {n} AI-related EXIF tag(s).',
  noteC2paRemoved: 'Removed the C2PA Content Credentials manifest.',
  noteXmpCleaned: 'Removed AI-related entries from the XMP packet.',

  // errors
  errUnsupported: 'Unsupported format — please choose a JPEG or PNG photo.',
  errDecode: 'The image could not be decoded by this browser.',
  errGeneric: 'The file could not be loaded.',
}

const zh: typeof en = {
  tagline: '雾化滤镜 · 元数据暗房',
  newPhoto: '换一张',

  dropTitleA: '把照片',
  dropTitleB: '放进暗房',
  dropSub: '应用扩散滤镜、查看元数据、清除 AI 标记，然后按原始分辨率导出。',
  dropHint: 'JPEG · PNG — 点击或拖入 · 照片不会离开本机',
  developing: '冲洗中…',

  tabFilters: '滤镜',
  tabMetadata: '元数据',
  aiCount: '{n} 处 AI',
  editCount: '{n}',

  filterTitle: '扩散',
  filterSub: 'Pro-Mist 风格光学效果。拖动预览上的分割线即可对比。',
  filterNone: '原图',
  filterBlack: '黑柔',
  filterWhite: '白柔',
  filterNoneDesc: '未处理的原始像素',
  filterBlackDesc: '高光泛光，黑色深邃',
  filterWhiteDesc: '梦幻朦胧，暗部提升',
  paramStrength: '强度',
  paramDiffusion: '扩散',
  paramBloom: '泛光',
  paramStrengthHint: '扩散效果的混合强度',
  paramDiffusionHint: '柔化程度（模糊半径）',
  paramBloomHint: '从整体蒙雾到仅高光泛光',
  resetParams: '重置参数',

  tagOriginal: '原图',
  holdOriginal: '按住查看原图',
  exportsAt: '以 {w}×{h} 导出',
  zoomIn: '放大',
  zoomOut: '缩小',
  zoomFit: '适应窗口',

  metaTitle: '元数据',
  metaSub: 'EXIF 直接从文件读取。编辑在导出时生效；未改动的数据将逐位保留。',
  aiBannerTitle: '检测到 AI 生成 / AI 编辑标记 — {n} 处',
  aiBannerNote: '以下标记已高亮，导出时将自动移除。',
  searchPlaceholder: '搜索标签与值…',
  resetEdits: '重置 {n} 处编辑',
  groupPhoto: '相机与照片',
  groupGps: '位置',
  groupThumb: '内嵌缩略图',
  groupXmp: 'XMP 数据包',
  xmpReadOnly: '只读',
  xmpCleaned: '只读 · 导出时清理',
  removedOnExport: ' — 导出时移除',
  rowDeleted: '此标签将在导出时移除',
  rowEdited: '已编辑的值（导出时生效）',
  rowEdit: '编辑数值',
  rowDelete: '导出时移除此标签',
  rowUndo: '撤销编辑',
  emptyMeta: '此文件中未找到 EXIF 或 XMP 元数据。',
  preserveNote: 'GPS 坐标、厂商注释、缩略图与未知标签在导出时完整保留。',
  searchLabel: '搜索元数据',
  valueEmpty: '（空）',
  valueUnreadable: '（无法读取）',
  valueBytes: '{n} 字节数据（保留）',
  valueThumb: '{n} 字节内嵌缩略图（保留）',
  valueMany: '…（共 {n} 个值）',

  whereExif: 'EXIF',
  whereXmp: 'XMP',
  whereC2pa: 'C2PA',
  whereComment: '注释',
  reasonExifSoftware: 'EXIF Software 标识了 AI 软件（“{kw}”）',
  reasonExifText: 'EXIF {tag} 提到 AI（“{kw}”）',
  reasonComment: 'JPEG 注释提到 AI（“{kw}”）',
  reasonXmpSource: 'IPTC DigitalSourceType 标记为 AI 生成（trainedAlgorithmicMedia）',
  reasonXmpTool: 'XMP {tag} 标识了 AI 软件（“{kw}”）',
  reasonXmpText: 'XMP {tag} 提到 AI（“{kw}”）',
  reasonC2paAi: '存在 C2PA 内容凭证清单，生成器提到 AI（“{kw}”）',
  reasonC2pa: '存在 C2PA 内容凭证清单（来源证明数据，导出时移除）',
  c2paValue: '{n} 字节清单',

  warnJpegUnparsed: 'JPEG 结构解析失败 — 导出时将重新编码图像。',
  warnPngUnparsed: 'PNG 结构解析失败 — 导出时将重新编码图像。',

  jpegQuality: 'JPEG 画质',
  pngLossless: 'PNG（无损）',
  aiRemovedNote: ' · 将移除 AI 标记',
  exportBtn: '导出照片',
  exportBusy: '冲洗中…',
  exportFailed: '导出失败。',
  savedNote: '已保存 {name}（{n} 字节）',
  noteLossless: '未应用滤镜 — 原始图像数据逐位保留。',
  noteExifTooLarge: 'EXIF 块超出 JPEG 段上限，已从导出中省略。',
  noteNoExif: '未找到可解析的 EXIF 元数据。',
  noteExifAiRemoved: '已移除 {n} 个 AI 相关 EXIF 标签。',
  noteC2paRemoved: '已移除 C2PA 内容凭证清单。',
  noteXmpCleaned: '已清除 XMP 数据包中的 AI 相关条目。',

  errUnsupported: '不支持的格式 — 请选择 JPEG 或 PNG 照片。',
  errDecode: '浏览器无法解码该图像。',
  errGeneric: '文件无法加载。',
}

export type MsgKey = keyof typeof en
export const dict: Record<Lang, typeof en> = { en, zh }

export function translate(lang: Lang, key: MsgKey, params?: Record<string, string | number>): string {
  let s: string = dict[lang][key] ?? dict.en[key] ?? key
  if (params) {
    for (const [k, v] of Object.entries(params)) s = s.replaceAll(`{${k}}`, String(v))
  }
  return s
}

export const LangContext = createContext<Lang>('en')

export function useLang(): Lang {
  return useContext(LangContext)
}

export function useT() {
  const lang = useContext(LangContext)
  return useCallback((key: MsgKey, params?: Record<string, string | number>) => translate(lang, key, params), [lang])
}

export function detectLang(): Lang {
  try {
    const saved = localStorage.getItem('mistdark.lang')
    if (saved === 'en' || saved === 'zh') return saved
  } catch {
    /* storage unavailable */
  }
  return typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('zh') ? 'zh' : 'en'
}

export function saveLang(lang: Lang): void {
  try {
    localStorage.setItem('mistdark.lang', lang)
  } catch {
    /* storage unavailable */
  }
}
