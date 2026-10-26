import { useEffect, useMemo, useState } from 'react'
import Dropzone from './components/Dropzone'
import CompareSlider from './components/CompareSlider'
import FilterPanel from './components/FilterPanel'
import ExifPanel from './components/ExifPanel'
import ExportBar, { type ExportJob } from './components/ExportBar'
import Filmstrip from './components/Filmstrip'
import { loadPhoto, type EditMap, type LoadedPhoto } from './lib/imageFile'
import { DEFAULT_PARAMS, renderMist, type FilterKind, type FilterParams } from './lib/filters'
import { formatBytes } from './lib/download'
import { LangContext, detectLang, saveLang, translate, type Lang } from './i18n'

const PREVIEW_CAP = 2000

interface QueueItem {
  id: string
  photo: LoadedPhoto
  kind: FilterKind
  params: FilterParams
  edits: EditMap
  thumb: string
  exported: boolean
}

const uid = () =>
  typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `p${Math.random().toString(36).slice(2)}`

function makeThumb(photo: LoadedPhoto): string {
  const h = 128
  const w = Math.max(1, Math.round((photo.width / photo.height) * h))
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  c.getContext('2d')!.drawImage(photo.bitmap, 0, 0, w, h)
  return c.toDataURL('image/jpeg', 0.72)
}

export default function App() {
  const [lang, setLang] = useState<Lang>(detectLang)
  const [queue, setQueue] = useState<QueueItem[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [stageDrag, setStageDrag] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<'filters' | 'metadata'>('filters')
  const [hold, setHold] = useState(false)

  const active = queue.find((item) => item.id === activeId) ?? null

  useEffect(() => {
    saveLang(lang)
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en'
  }, [lang])

  const t = (key: Parameters<typeof translate>[1], params?: Record<string, string | number>) =>
    translate(lang, key, params)

  const handleFiles = async (files: File[]) => {
    const usable = files.filter((f) => f.size > 0)
    if (usable.length === 0) return
    const wasEmpty = queue.length === 0
    setLoading(true)
    setError(null)
    let first: QueueItem | null = null
    let failed = 0
    for (const file of usable) {
      try {
        const photo = await loadPhoto(file)
        const item: QueueItem = {
          id: uid(),
          photo,
          kind: 'blackMist',
          params: DEFAULT_PARAMS,
          edits: {},
          thumb: makeThumb(photo),
          exported: false,
        }
        if (!first) first = item
        setQueue((q) => [...q, item])
      } catch {
        failed++
      }
    }
    if (first) {
      // Only steer the view when a fresh session starts; adding to an
      // existing queue keeps the current selection and panel.
      if (wasEmpty) {
        setActiveId(first.id)
        setTab(first.photo.aiFindings.length > 0 ? 'metadata' : 'filters')
      }
    }
    if (failed > 0) setError(t('loadFailedCount', { n: failed }))
    setLoading(false)
  }

  const patchActive = (patch: Partial<Pick<QueueItem, 'kind' | 'params' | 'edits'>>) => {
    if (!activeId) return
    setQueue((q) => q.map((item) => (item.id === activeId ? { ...item, ...patch, exported: false } : item)))
  }

  const applyAll = () => {
    if (!active) return
    setQueue((q) =>
      q.map((item) => (item.id === active.id ? item : { ...item, kind: active.kind, params: active.params, exported: false })),
    )
  }

  const removeItem = (id: string) => {
    const idx = queue.findIndex((item) => item.id === id)
    const next = queue.filter((item) => item.id !== id)
    setQueue(next)
    if (id === activeId) setActiveId(next[Math.min(idx, next.length - 1)]?.id ?? null)
  }

  const markExported = (ids: string[]) => {
    setQueue((q) => q.map((item) => (ids.includes(item.id) ? { ...item, exported: true } : item)))
  }

  const clearAll = () => {
    setQueue([])
    setActiveId(null)
    setTab('filters')
  }

  // Preview-sized source, built once per active photo.
  const preview = useMemo(() => {
    if (!active) return null
    const photo = active.photo
    const scale = Math.min(1, PREVIEW_CAP / Math.max(photo.width, photo.height))
    const w = Math.max(1, Math.round(photo.width * scale))
    const h = Math.max(1, Math.round(photo.height * scale))
    const src = document.createElement('canvas')
    src.width = w
    src.height = h
    src.getContext('2d')!.drawImage(photo.bitmap, 0, 0, w, h)
    return { src, w, h }
  }, [active])

  const [canvases, setCanvases] = useState<{ orig: HTMLCanvasElement; filt: HTMLCanvasElement } | null>(null)

  useEffect(() => {
    if (!preview) {
      setCanvases(null)
      return
    }
    const make = () => {
      const c = document.createElement('canvas')
      c.width = preview.w
      c.height = preview.h
      return c
    }
    const orig = make()
    orig.getContext('2d')!.drawImage(preview.src, 0, 0)
    const filt = make()
    setCanvases({ orig, filt })
  }, [preview])

  // Repaint the filtered layer on any change (rAF-coalesced).
  useEffect(() => {
    if (!preview || !canvases || !active) return
    let cancelled = false
    const raf = requestAnimationFrame(() => {
      if (cancelled) return
      const out = renderMist(preview.src, preview.w, preview.h, active.kind, active.params)
      const ctx = canvases.filt.getContext('2d')!
      ctx.clearRect(0, 0, preview.w, preview.h)
      ctx.drawImage(out, 0, 0)
    })
    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
    }
  }, [preview, canvases, active])

  const editCount = active ? Object.keys(active.edits).length : 0
  const aiCount = active?.photo.aiFindings.length ?? 0
  const filterLabelKey =
    active && (active.kind === 'none' ? 'filterNone' : active.kind === 'blackMist' ? 'filterBlack' : 'filterWhite')
  const filterLabel =
    active && filterLabelKey ? (lang === 'en' ? t(filterLabelKey).toUpperCase() : t(filterLabelKey)) : ''

  const jobs: ExportJob[] = queue.map(({ id, photo, kind, params, edits }) => ({ id, photo, kind, params, edits }))

  return (
    <LangContext.Provider value={lang}>
      <header className="app-header">
        <div className="wordmark">
          Mist<span className="star">✳</span>dark
          <small>{t('tagline')}</small>
        </div>
        <div className="header-actions">
          {active && (
            <span className="file-chip" title={active.photo.fileName}>
              <span className="name">{active.photo.fileName}</span>
              <span>
                {active.photo.width}×{active.photo.height}
              </span>
              <span>{formatBytes(active.photo.bytes.byteLength)}</span>
              <span className="fmt">{active.photo.kind === 'jpeg' ? 'JPEG' : 'PNG'}</span>
            </span>
          )}
          <div className="lang-switch" role="group" aria-label="Language">
            <button className={lang === 'en' ? 'active' : ''} onClick={() => setLang('en')}>
              EN
            </button>
            <button className={lang === 'zh' ? 'active' : ''} onClick={() => setLang('zh')}>
              中文
            </button>
          </div>
          {queue.length > 0 && (
            <button className="hold-btn" onClick={clearAll}>
              {t('clearAll')}
            </button>
          )}
        </div>
      </header>

      <main className={`app-main${active ? '' : ' empty'}`}>
        <div
          className={`stage-col${stageDrag ? ' drag-over' : ''}`}
          onDragOver={(e) => {
            if (!active) return
            e.preventDefault()
            setStageDrag(true)
          }}
          onDragLeave={() => setStageDrag(false)}
          onDrop={(e) => {
            setStageDrag(false)
            if (!active) return
            e.preventDefault()
            void handleFiles(Array.from(e.dataTransfer.files))
          }}
        >
          {active && canvases && preview ? (
            <>
              <div className="stage">
                <CompareSlider
                  original={canvases.orig}
                  filtered={canvases.filt}
                  naturalW={preview.w}
                  naturalH={preview.h}
                  filterLabel={filterLabel}
                  hold={hold}
                />
              </div>
              <div className="stage-caption">
                <span className="params">
                  {filterLabel}
                  {active.kind !== 'none' && (
                    <>
                      {' · '}
                      <b>
                        {t('paramStrength').slice(0, 1)} {Math.round(active.params.strength * 100)}
                      </b>
                      {' · '}
                      <b>
                        {t('paramDiffusion').slice(0, 1)} {Math.round(active.params.diffusion * 100)}
                      </b>
                      {' · '}
                      <b>
                        {t('paramBloom').slice(0, 1)} {Math.round(active.params.bloom * 100)}
                      </b>
                    </>
                  )}
                  {` · ${t('exportsAt', { w: active.photo.width, h: active.photo.height })}`}
                </span>
                <button
                  className={`hold-btn${hold ? ' active' : ''}`}
                  onPointerDown={() => setHold(true)}
                  onPointerUp={() => setHold(false)}
                  onPointerLeave={() => setHold(false)}
                  onKeyDown={(e) => e.key === 'Enter' && setHold((h) => !h)}
                  onKeyUp={(e) => e.key === 'Enter' && setHold(false)}
                  aria-pressed={hold}
                >
                  {t('holdOriginal')}
                </button>
              </div>
            </>
          ) : (
            <Dropzone onFiles={handleFiles} loading={loading} />
          )}

          {queue.length > 0 && (
            <Filmstrip
              items={queue.map((item) => ({
                id: item.id,
                thumb: item.thumb,
                fileName: item.photo.fileName,
                aiCount: item.photo.aiFindings.length,
                editCount: Object.keys(item.edits).length,
                exported: item.exported,
              }))}
              activeId={activeId ?? ''}
              adding={loading}
              onSelect={setActiveId}
              onRemove={removeItem}
              onAdd={handleFiles}
            />
          )}
        </div>

        {active && (
          <aside className="sidebar">
            <div className="tabs" role="tablist">
              <button
                role="tab"
                aria-selected={tab === 'filters'}
                className={`tab${tab === 'filters' ? ' active' : ''}`}
                onClick={() => setTab('filters')}
              >
                {t('tabFilters')}
              </button>
              <button
                role="tab"
                aria-selected={tab === 'metadata'}
                className={`tab${tab === 'metadata' ? ' active' : ''}`}
                onClick={() => setTab('metadata')}
              >
                {t('tabMetadata')}
                {aiCount > 0 ? (
                  <span className="count alert" title={t('aiBannerTitle', { n: aiCount })}>
                    {t('aiCount', { n: aiCount })}
                  </span>
                ) : editCount > 0 ? (
                  <span className="count" title={`${editCount}`}>
                    {t('editCount', { n: editCount })}
                  </span>
                ) : null}
              </button>
            </div>

            <div className="panel">
              {tab === 'filters' ? (
                <FilterPanel
                  kind={active.kind}
                  params={active.params}
                  queueSize={queue.length}
                  onKind={(kind) => patchActive({ kind })}
                  onParams={(params) => patchActive({ params })}
                  onApplyAll={applyAll}
                />
              ) : (
                <ExifPanel photo={active.photo} edits={active.edits} onEdits={(edits) => patchActive({ edits })} />
              )}
            </div>

            <ExportBar activeId={active.id} jobs={jobs} onExported={markExported} />
          </aside>
        )}
      </main>

      {error && (
        <div className="toast" role="alert" onClick={() => setError(null)}>
          {error}
        </div>
      )}
    </LangContext.Provider>
  )
}
