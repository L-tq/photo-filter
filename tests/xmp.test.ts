import { describe, expect, it } from 'vitest'
import { analyzeXmp, summarizeXmp } from '../src/lib/xmp'

const PACKET = `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:Iptc4xmpCore="http://iptc.org/std/Iptc4xmpCore/1.0/xmlns/" xmlns:xmp="http://ns.adobe.com/xap/1.0/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    Iptc4xmpCore:digitalSourceType="urn:iptc:std:digitalSourceType:2018:trainedAlgorithmicMedia"
    xmp:CreatorTool="Adobe Firefly 2024">
   <dc:title><rdf:Alt><rdf:li xml:lang="x-default">Sunset over the bay</rdf:li></rdf:Alt></dc:title>
   <dc:creator><rdf:Seq><rdf:li>Jane Photographer</rdf:li></rdf:Seq></dc:creator>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`

describe('analyzeXmp', () => {
  it('detects trainedAlgorithmicMedia and AI creator tools', () => {
    const res = analyzeXmp(PACKET)
    const names = res.findings.map((f) => f.tagName).sort()
    expect(names).toContain('Iptc4xmpCore:digitalSourceType')
    expect(names).toContain('xmp:CreatorTool')
    expect(res.findings.every((f) => f.severity === 'ai')).toBe(true)
  })

  it('removes AI attributes while keeping the rest of the packet', () => {
    const res = analyzeXmp(PACKET)
    expect(res.filteredXml).not.toBeNull()
    expect(res.filteredXml).not.toContain('trainedAlgorithmicMedia')
    expect(res.filteredXml).not.toContain('Firefly')
    expect(res.filteredXml).toContain('Sunset over the bay')
    expect(res.filteredXml).toContain('Jane Photographer')
  })

  it('leaves a clean packet untouched', () => {
    const clean = PACKET.replace('trainedAlgorithmicMedia', 'digitalCamera').replace('Adobe Firefly 2024', 'Adobe Lightroom 2024')
    const res = analyzeXmp(clean)
    expect(res.findings).toHaveLength(0)
    expect(res.filteredXml).toBeNull()
  })

  it('ignores benign text mentioning fireflies', () => {
    const text = PACKET.replace('Sunset over the bay', 'Fireflies at night in the forest').replace('trainedAlgorithmicMedia', 'digitalCamera').replace('Adobe Firefly 2024', 'Adobe Lightroom 2024')
    const res = analyzeXmp(text)
    expect(res.findings).toHaveLength(0)
  })

  it('flags AI mentions in free-text fields', () => {
    const text = PACKET.replace('Sunset over the bay', 'AI-generated photo of a sunset').replace('trainedAlgorithmicMedia', 'digitalCamera').replace('Adobe Firefly 2024', 'Adobe Lightroom 2024')
    const res = analyzeXmp(text)
    expect(res.findings.map((f) => f.tagName)).toContain('dc:title')
  })
})

describe('summarizeXmp', () => {
  it('lists direct-text fields', () => {
    const fields = summarizeXmp(PACKET)
    const names = fields.map((f) => f.name)
    expect(names).toContain('rdf:li')
    expect(fields.find((f) => f.value === 'Sunset over the bay')).toBeDefined()
    expect(fields.find((f) => f.value === 'Jane Photographer')).toBeDefined()
  })
})
