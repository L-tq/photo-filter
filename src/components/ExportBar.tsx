import { useState, type CSSProperties } from 'react'
import { exportPhoto, type EditMap, type ExportNote, type LoadedPhoto } from '../lib/imageFile'
import type { FilterKind, FilterParams } from '../lib/filters'
import { triggerDownload } from '../lib/download'
import { useT, type MsgKey } from '../i18n'

interface Props {
  photo: LoadedPhoto
  kind: FilterKind
  params: FilterParams
  edits: EditMap
}

export default function ExportBar({ photo, kind, params, edits }: Props) {
  const t = useT()
  const [quality, setQuality] = useState(95)
  const [busy, setBusy] = useState(false)
  const [notes, setNotes] = useState<string[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const run = async () => {
    setBusy(true)
    setError(null)
    setNotes(null)
    try {
      const result = await exportPhoto(photo, { kind, params, edits, jpegQuality: quality / 100 })
      triggerDownload(result.blob, result.fileName)
      const rendered = result.notes.map((n: ExportNote) =>
        t(n.key as MsgKey, n.n !== undefined ? { n: n.n } : undefined),
      )
      setNotes([t('savedNote', { name: result.fileName, n: result.blob.size.toLocaleString() }), ...rendered])
    } catch (e) {
      setError(t('exportFailed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="export-bar">
      <div className="row">
        <span>
          {photo.kind === 'jpeg' ? t('jpegQuality') : t('pngLossless')}
          {photo.aiFindings.length > 0 && t('aiRemovedNote')}
        </span>
        {photo.kind === 'jpeg' && (
          <>
            <input
              type="range"
              min={70}
              max={100}
              value={quality}
              aria-label={t('jpegQuality')}
              style={{ width: 130, '--fill': `${((quality - 70) / 30) * 100}%` } as CSSProperties}
              onChange={(e) => setQuality(Number(e.target.value))}
            />
            <span style={{ fontFamily: 'var(--mono)', color: 'var(--amber-hi)' }}>{quality}</span>
          </>
        )}
      </div>
      <button className="export-btn" onClick={run} disabled={busy}>
        {busy ? t('exportBusy') : (
          <>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" aria-hidden>
              <path d="M12 3v12m0 0-4-4m4 4 4-4" />
              <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
            </svg>
            {t('exportBtn')}
          </>
        )}
      </button>
      {notes && (
        <ul className="export-notes">
          {notes.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      )}
      {error && (
        <div className="notice warn" role="alert">{error}</div>
      )}
    </div>
  )
}
