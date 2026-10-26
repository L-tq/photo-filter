/**
 * XMP packet inspection and AI-node removal.
 *
 * The packet is parsed as XML; attributes and elements that mark the image as
 * AI-generated or AI-edited are reported and can be removed. When nothing
 * matches, the original packet is kept verbatim (filteredXml === null) so
 * untouched XMP is preserved byte-for-byte.
 */

import { DOMParser, XMLSerializer, type Element } from '@xmldom/xmldom'
import { aiMatch, type AiFinding } from './aiDetect'

/** Attribute local names that name the creating software → strict keyword tier. */
const TOOL_NAMES = new Set(['creatortool', 'software', 'processingsoftware'])
/** Free-text element local names → conservative keyword tier. */
const TEXT_ELEMENTS = new Set(['description', 'title', 'rights', 'caption', 'abstract', 'subject', 'keywords'])
const RDF_NS = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#'

export interface XmpAnalysis {
  findings: AiFinding[]
  /** Serialized packet with AI attributes/elements removed; null when unchanged. */
  filteredXml: string | null
  removed: string[]
}

function qualifiedName(el: Element): string {
  const local = el.localName ?? ''
  return el.prefix ? `${el.prefix}:${local}` : local
}

function isRdfContainer(el: Element): boolean {
  return el.prefix === 'rdf' || (el.namespaceURI ?? '') === RDF_NS
}

export function analyzeXmp(xml: string): XmpAnalysis {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  if (!doc.documentElement || doc.getElementsByTagName('parsererror').length > 0) {
    return { findings: [], filteredXml: null, removed: [] }
  }

  const findings: AiFinding[] = []
  const removed: string[] = []
  let changed = false

  const visit = (el: Element, parentRemoved: boolean): void => {
    const local = (el.localName ?? '').toLowerCase()
    const qname = qualifiedName(el)
    let removedHere = parentRemoved

    if (!parentRemoved) {
      // attributes (the common shorthand: <rdf:Description xmp:CreatorTool="…">)
      const attrsToRemove: string[] = []
      for (const attr of Array.from(el.attributes)) {
        const aLocal = (attr.localName ?? attr.name).toLowerCase()
        const value = attr.value ?? ''
        if (!value) continue
        if (aLocal === 'digitalsourcetype') {
          if (/trainedalgorithmicmedia|algorithmicmedia/i.test(value)) {
            findings.push({
              where: 'xmp',
              tagName: attr.name,
              value,
              key: 'reasonXmpSource',
              severity: 'ai',
            })
            removed.push(attr.name)
            attrsToRemove.push(attr.name)
          }
        } else if (TOOL_NAMES.has(aLocal)) {
          const kw = aiMatch(value, 'tool')
          if (kw) {
            findings.push({
              where: 'xmp',
              tagName: attr.name,
              value,
              key: 'reasonXmpTool',
              keyword: kw,
              severity: 'ai',
            })
            removed.push(attr.name)
            attrsToRemove.push(attr.name)
          }
        }
      }
      if (attrsToRemove.length) {
        for (const name of attrsToRemove) el.removeAttribute(name)
        changed = true
      }

      // elements with direct or nested text (rdf:Description itself is just a
      // container, never treated as dc:description)
      const text = (el.textContent ?? '').trim()
      if (text && !isRdfContainer(el)) {
        if (local === 'digitalsourcetype') {
          if (/trainedalgorithmicmedia|algorithmicmedia/i.test(text)) {
            findings.push({
              where: 'xmp',
              tagName: qname,
              value: text,
              key: 'reasonXmpSource',
              severity: 'ai',
            })
            removed.push(qname)
            removedHere = true
          }
        } else if (TOOL_NAMES.has(local)) {
          const kw = aiMatch(text, 'tool')
          if (kw) {
            findings.push({
              where: 'xmp',
              tagName: qname,
              value: text,
              key: 'reasonXmpTool',
              keyword: kw,
              severity: 'ai',
            })
            removed.push(qname)
            removedHere = true
          }
        } else if (TEXT_ELEMENTS.has(local)) {
          const kw = aiMatch(text, 'text')
          if (kw) {
            findings.push({
              where: 'xmp',
              tagName: qname,
              value: text.length > 120 ? text.slice(0, 117) + '…' : text,
              key: 'reasonXmpText',
              keyword: kw,
              severity: 'ai',
            })
            removed.push(qname)
            removedHere = true
          }
        }
      }
    }

    for (const child of Array.from(el.childNodes)) {
      if (child.nodeType === 1) visit(child as Element, removedHere)
    }

    if (removedHere && !parentRemoved && el.parentNode) {
      el.parentNode.removeChild(el)
      changed = true
    }
  }

  visit(doc.documentElement, false)

  if (!changed) return { findings, filteredXml: null, removed: [] }
  return { findings, filteredXml: new XMLSerializer().serializeToString(doc), removed: [] }
}

// ---------------------------------------------------------------- display

export interface XmpField {
  name: string
  value: string
}

/** Flat name/value list of elements that carry direct text (for display). */
export function summarizeXmp(xml: string): XmpField[] {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  if (!doc.documentElement || doc.getElementsByTagName('parsererror').length > 0) return []
  const out: XmpField[] = []
  const visit = (el: Element): void => {
    let direct = ''
    for (const n of Array.from(el.childNodes)) {
      if (n.nodeType === 3 || n.nodeType === 4) direct += n.nodeValue ?? ''
    }
    direct = direct.trim()
    if (direct && out.length < 200) {
      out.push({
        name: qualifiedName(el),
        value: direct.length > 160 ? direct.slice(0, 157) + '…' : direct,
      })
    }
    for (const n of Array.from(el.childNodes)) if (n.nodeType === 1) visit(n as Element)
  }
  visit(doc.documentElement)
  return out
}
