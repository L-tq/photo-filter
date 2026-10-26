import { useRef } from 'react'
import { useT } from '../i18n'

export interface FilmItem {
  id: string
  thumb: string
  fileName: string
  aiCount: number
  editCount: number
  exported: boolean
}

interface Props {
  items: FilmItem[]
  activeId: string
  /** True while new files are still decoding — the add tile shows progress. */
  adding: boolean
  onSelect: (id: string) => void
  onRemove: (id: string) => void
  onAdd: (files: File[]) => void
}

export default function Filmstrip({ items, activeId, adding, onSelect, onRemove, onAdd }: Props) {
  const t = useT()
  const inputRef = useRef<HTMLInputElement>(null)

  const pick = (files: FileList | null) => {
    if (files && files.length > 0) onAdd(Array.from(files))
  }

  return (
    <div className="filmstrip" role="listbox" aria-label={t('addPhotos')}>
      {items.map((item) => (
        <div key={item.id} className={`film-item${item.id === activeId ? ' active' : ''}`}>
          <button
            role="option"
            aria-selected={item.id === activeId}
            aria-label={item.fileName}
            title={item.fileName}
            className="film-thumb"
            onClick={() => onSelect(item.id)}
          >
            <img src={item.thumb} alt="" loading="lazy" />
            {item.exported ? (
              <span className="film-check" title={t('exportedNote')}>
                ✓
              </span>
            ) : null}
            <span className="film-name">{item.fileName}</span>
          </button>
          <span className="film-badges">
            {item.aiCount > 0 && (
              <span className="count alert" title={t('aiBannerTitle', { n: item.aiCount })}>
                {t('aiCount', { n: item.aiCount })}
              </span>
            )}
            {item.editCount > 0 && (
              <span className="count" title={t('editCount', { n: item.editCount })}>
                ✎
              </span>
            )}
          </span>
          <button
            className="film-remove"
            aria-label={`${t('removePhoto')}: ${item.fileName}`}
            title={t('removePhoto')}
            onClick={() => onRemove(item.id)}
          >
            ×
          </button>
        </div>
      ))}

      <button
        className={`film-add${adding ? ' busy' : ''}`}
        aria-label={t('addPhotos')}
        title={t('addPhotos')}
        disabled={adding}
        onClick={() => inputRef.current?.click()}
      >
        {adding ? <span className="spinner" aria-hidden /> : <span aria-hidden>+</span>}
      </button>

      <input
        ref={inputRef}
        type="file"
        accept=".jpg,.jpeg,.png,image/jpeg,image/png"
        multiple
        hidden
        onChange={(e) => {
          pick(e.target.files)
          e.target.value = ''
        }}
      />
    </div>
  )
}
