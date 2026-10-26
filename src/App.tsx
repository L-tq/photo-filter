import { useEffect, useMemo, useState } from 'react'
import Dropzone from './components/Dropzone'
import CompareSlider from './components/CompareSlider'
import FilterPanel from './components/FilterPanel'
import ExifPanel from './components/ExifPanel'
import ExportBar from './components/ExportBar'
import { loadPhoto, type EditMap, type LoadedPhoto } from './lib/imageFile'
import { DEFAULT_PARAMS, renderMist, type FilterKind, type FilterParams } from './lib/filters'
import { formatBytes } from './lib/download'
import { LangContext, detectLang, saveLang, translate, type Lang } from './i18n'

const PREVIEW_CAP = 2000

export default function App() {
  const [lang, setLang] = useState<Lang>(detectLang)
  const [photo, setPhoto] = useState<LoadedPhoto | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [kind, setKind] = useState<FilterKind>('blackMist')
  const [params, setParams] = useState<FilterParams>(DEFAULT_PARAMS)
  const [edits, setEdits] = useState<EditMap>({})
  const [tab, setTab] = useState<'filters' | 'metadata'>('filters')
  const [hold, setHold] = useState(false)

  useEffect(() => {
    saveLang(lang)
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en'
  }, [lang])

  const t = (key: Parameters<typeof translate>[1], params?: Record<string, string | number>) =>
    translate(lang, key, params)

  const handleFile = async (file: File) => {
    setLoading(true)
    setError(null)
    try {
      const loaded = await loadPhoto(file)
      setPhoto(loaded)
      setEdits({})
      setParams(DEFAULT_PARAMS)
      setTab(loaded.aiFindings.length > 0 ? 'metadata' : 'filters')
    } catch (e) {
      const code = (e as { code?: string }).code
      setError(code === 'errUnsupported' || code === 'errDecode' ? t(code) : t('errGeneric'))
    } finally {
      setLoading(false)
    }
  }

  // Preview-sized source, built once per photo.
  const preview = useMemo(() => {
    if (!photo) return null
    const scale = Math.min(1, PREVIEW_CAP / Math.max(photo.width, photo.height))
    const w = Math.max(1, Math.round(photo.width * scale))
    const h = Math.max(1, Math.round(photo.height * scale))
    const src = document.createElement('canvas')
    src.width = w
    src.height = h
    src.getContext('2d')!.drawImage(photo.bitmap, 0, 0, w, h)
    return { src, w, h }
  }, [photo])

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
    if (!preview || !canvases) return
    let cancelled = false
    const raf = requestAnimationFrame(() => {
      if (cancelled) return
      const out = renderMist(preview.src, preview.w, preview.h, kind, params)
      const ctx = canvases.filt.getContext('2d')!
      ctx.clearRect(0, 0, preview.w, preview.h)
      ctx.drawImage(out, 0, 0)
    })
    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
    }
  }, [preview, canvases, kind, params])

  const editCount = Object.keys(edits).length
  const aiCount = photo?.aiFindings.length ?? 0
  const filterLabelKey =
    kind === 'none' ? 'filterNone' : kind === 'blackMist' ? 'filterBlack' : 'filterWhite'
  const filterLabel = lang === 'en' ? t(filterLabelKey).toUpperCase() : t(filterLabelKey)

  return (
    <LangContext.Provider value={lang}>
      <header className="app-header">
        <div className="wordmark">
          Mist<span className="star">✳</span>dark
          <small>{t('tagline')}</small>
        </div>
        <div className="header-actions">
          {photo && (
            <span className="file-chip" title={photo.fileName}>
              <span className="name">{photo.fileName}</span>
              <span>
                {photo.width}×{photo.height}
              </span>
              <span>{formatBytes(photo.bytes.byteLength)}</span>
              <span className="fmt">{photo.kind === 'jpeg' ? 'JPEG' : 'PNG'}</span>
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
          {photo && (
            <button className="hold-btn" onClick={() => setPhoto(null)}>
              {t('newPhoto')}
            </button>
          )}
        </div>
      </header>

      <main className={`app-main${photo ? '' : ' empty'}`}>
        <div className="stage-col">
          {photo && canvases && preview ? (
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
                  {kind !== 'none' && (
                    <>
                      {' · '}
                      <b>
                        {t('paramStrength').slice(0, 1)} {Math.round(params.strength * 100)}
                      </b>
                      {' · '}
                      <b>
                        {t('paramDiffusion').slice(0, 1)} {Math.round(params.diffusion * 100)}
                      </b>
                      {' · '}
                      <b>
                        {t('paramBloom').slice(0, 1)} {Math.round(params.bloom * 100)}
                      </b>
                    </>
                  )}
                  {` · ${t('exportsAt', { w: photo.width, h: photo.height })}`}
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
            <Dropzone onFile={handleFile} loading={loading} />
          )}
        </div>

        {photo && (
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
                <FilterPanel kind={kind} params={params} onKind={setKind} onParams={setParams} />
              ) : (
                <ExifPanel photo={photo} edits={edits} onEdits={setEdits} />
              )}
            </div>

            <ExportBar photo={photo} kind={kind} params={params} edits={edits} />
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
