import { useState, type CSSProperties } from 'react'
import { exportPhoto, type EditMap, type ExportNote, type LoadedPhoto } from '../lib/imageFile'
import type { FilterKind, FilterParams } from '../lib/filters'
import { createZip } from '../lib/zip'
import { triggerDownload } from '../lib/download'
import { useT, type MsgKey } from '../i18n'

export interface ExportJob {
  id: string
  photo: LoadedPhoto
  kind: FilterKind
  params: FilterParams
  edits: EditMap
}

interface Props {
  activeId: string
  /** One entry per queued photo, in filmstrip order. */
  jobs: ExportJob[]
  onExported: (ids: string[]) => void
}

const ZIP_NAME = 'mistdark-exports.zip'

/** Disambiguate duplicate stems ("photo-clean.jpg" → "photo-2-clean.jpg"). */
function uniqueNames(names: string[]): string[] {
  const used = new Set<string>()
  return names.map((name) => {
    let candidate = name
    let i = 2
    while (used.has(candidate)) {
      candidate = name.replace(/(\.\w+)$/, `-${i}$1`)
      i++
    }
    used.add(candidate)
    return candidate
  })
}

export default function ExportBar({ activeId, jobs, onExported }: Props) {
  const t = useT()
  const active = jobs.find((j) => j.id === activeId) ?? jobs[0]
  const [quality, setQuality] = useState(95)
  const [busy, setBusy] = useState(false)
  const [allProgress, setAllProgress] = useState<{ done: number; total: number } | null>(null)
  const [notes, setNotes] = useState<string[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const renderNotes = (result: ExportNote[]) =>
    result
      .map((n) => t(n.key as MsgKey, n.n !== undefined ? { n: n.n } : undefined))
      .filter(Boolean)

  const runOne = async () => {
    if (!active) return
    setBusy(true)
    setError(null)
    setNotes(null)
    try {
      const result = await exportPhoto(active.photo, {
        kind: active.kind,
        params: active.params,
        edits: active.edits,
        jpegQuality: quality / 100,
      })
      triggerDownload(result.blob, result.fileName)
      onExported([active.id])
      setNotes([
        t('savedNote', { name: result.fileName, n: result.blob.size.toLocaleString() }),
        ...renderNotes(result.notes),
      ])
    } catch {
      setError(t('exportFailed'))
    } finally {
      setBusy(false)
    }
  }

  const runAll = async () => {
    setBusy(true)
    setError(null)
    setNotes(null)
    setAllProgress({ done: 0, total: jobs.length })
    const exportedIds: string[] = []
    const blobs: { fileName: string; blob: Blob; notes: ExportNote[] }[] = []
    let failed = 0
    try {
      for (let i = 0; i < jobs.length; i++) {
        const job = jobs[i]
        try {
          const result = await exportPhoto(job.photo, {
            kind: job.kind,
            params: job.params,
            edits: job.edits,
            jpegQuality: quality / 100,
          })
          blobs.push(result)
          exportedIds.push(job.id)
        } catch {
          failed++
        }
        setAllProgress({ done: i + 1, total: jobs.length })
      }
      if (blobs.length === 0) {
        setError(t('exportFailed'))
        return
      }
      const names = uniqueNames(blobs.map((b) => b.fileName))
      const bytes = await Promise.all(blobs.map((b) => b.blob.arrayBuffer()))
      const zip = createZip(bytes.map((data, i) => ({ name: names[i], data: new Uint8Array(data) })))
      triggerDownload(new Blob([zip], { type: 'application/zip' }), ZIP_NAME)
      onExported(exportedIds)
      const aiRemoved = blobs.filter((b) => b.notes.some((n) => n.key === 'noteExifAiRemoved')).length
      const summary = [
        t('savedNote', { name: ZIP_NAME, n: zip.byteLength.toLocaleString() }),
        t('batchDone', { n: blobs.length }),
      ]
      if (aiRemoved > 0) summary.push(t('batchAiRemoved', { n: aiRemoved }))
      if (failed > 0) summary.push(t('loadFailedCount', { n: failed }))
      setNotes(summary)
    } catch {
      setError(t('exportFailed'))
    } finally {
      setBusy(false)
      setAllProgress(null)
    }
  }

  const busyLabel = allProgress
    ? t('exportAllBusy', { done: allProgress.done, n: allProgress.total })
    : t('exportBusy')

  return (
    <div className="export-bar">
      <div className="row">
        <span>
          {active?.photo.kind === 'png' ? t('pngLossless') : t('jpegQuality')}
          {active && active.photo.aiFindings.length > 0 && t('aiRemovedNote')}
        </span>
        {(!active || active.photo.kind === 'jpeg') && (
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
      <div className="export-actions">
        <button className="export-btn" onClick={runOne} disabled={busy || !active}>
          {busy && !allProgress ? busyLabel : (
            <>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" aria-hidden>
                <path d="M12 3v12m0 0-4-4m4 4 4-4" />
                <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
              </svg>
              {t('exportBtn')}
            </>
          )}
        </button>
        {jobs.length > 1 && (
          <button className="export-btn secondary" onClick={runAll} disabled={busy}>
            {allProgress ? busyLabel : t('exportAllBtn', { n: jobs.length })}
          </button>
        )}
      </div>
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
