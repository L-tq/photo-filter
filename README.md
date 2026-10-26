# Mistdark — photo filters & EXIF darkroom

A client-side web app that applies **Black Mist / White Mist** diffusion filters to
photos and reads, edits, and scrubs their **EXIF/XMP metadata** — with automatic
detection and removal of AI-generation markers. Everything runs in the browser;
no photo ever leaves the device.

## Run it

```bash
npm install
npm run dev        # → http://localhost:5173
```

Production build (static files, works offline once served):

```bash
npm run build      # → dist/
npm run preview    # serve the build locally
```

## Features

- **Upload & before/after** — drag-and-drop (JPEG/PNG), draggable compare slider
  with a hold-to-view-original button.
- **Zoom & pan** — wheel zoom anchored at the cursor, +/−/fit controls,
  drag-to-pan when zoomed (dragging the handle moves the compare divider;
  double-click toggles fit ↔ 2×). Arrow keys pan when zoomed.
- **Black Mist / White Mist** — Pro-Mist-style optical looks (GPU blur + screen
  bloom). Parameters: *Strength*, *Diffusion* (blur radius), *Bloom* (veil
  everywhere → highlights only). Preview is capped for responsiveness; export
  always renders at the **original resolution**.
- **EXIF editor** — every tag is read straight from the file (including GPS,
  maker notes, unknown tags, IFD1 thumbnails). ASCII/numeric fields are
  editable in place; GPS coordinates edit as decimal degrees.
- **中文 / English** — full UI localization (EN / 简体中文) with an in-app
  toggle; the language is remembered and defaults from the browser locale.
- **AI marker detection** — flagged in a red banner with badges on the rows:
  - IPTC/XMP `DigitalSourceType` = `trainedAlgorithmicMedia`
  - AI tools named in EXIF `Software` / `UserComment` / comments and XMP
    `CreatorTool` / `Software` (Stable Diffusion, Midjourney, DALL·E, Firefly,
    Flux, Imagen, ComfyUI, …)
  - C2PA Content Credentials manifests (JPEG APP11 / PNG `c2pa` chunk)
- **Clean export** — AI-related EXIF tags and XMP entries are removed, C2PA
  manifests dropped, and the remaining metadata is preserved bit-for-bit:
  the EXIF/TIFF block is rebuilt in place, keeping unknown tags, maker notes
  (copied opaquely) and embedded thumbnails. When no filter is applied the
  original compressed bytes are reused — an untouched export is
  **byte-identical** to the input.

## How the metadata surgery works

`src/lib/` contains small, dependency-light format editors:

| module      | role                                                              |
| ----------- | ----------------------------------------------------------------- |
| `jpeg.ts`   | marker-segment scanner/rebuilder (lossless passthrough of scan)   |
| `png.ts`    | chunk scanner/rebuilder with CRC (eXIf, iTXt/XMP, c2pa)           |
| `tiff.ts`   | preservation-focused EXIF/TIFF parser + IFD rebuilder             |
| `xmp.ts`    | XMP inspection and AI-node removal (`@xmldom/xmldom`)             |
| `aiDetect.ts` | two-tier keyword rules (strict for tool fields, conservative for free text) |
| `filters.ts`| Black/White Mist render pipeline                                  |

## Development

```bash
npm test           # unit tests (TIFF round-trips, segment surgery, XMP, AI rules)
npm run fixtures   # generate sample photos in samples/ (needs Python + Pillow)
node scripts/verify-export.mjs <original> <exported> \
  [--expect key=value,…] [--expect-missing key,…] [--expect-byte-identical]
```

## Notes & limits

- JPEG and PNG are fully supported; other formats are rejected with a message.
- Filtered PNG exports are re-encoded by the browser canvas, which always
  writes RGBA — pixels are identical, but the color type differs from an RGB
  source. Filtered JPEGs re-encode at the chosen quality (default 95).
- AI detection is keyword/structure-based: it catches the standard
  provenance markers and common generator names, but cannot prove a photo is
  (or isn't) AI-made — only that the metadata says so.
