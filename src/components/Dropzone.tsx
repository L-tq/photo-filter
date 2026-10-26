import { useRef, useState } from 'react'
import { useT } from '../i18n'

interface Props {
  onFiles: (files: File[]) => void
  loading: boolean
}

export default function Dropzone({ onFiles, loading }: Props) {
  const t = useT()
  const [drag, setDrag] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const pick = (files: FileList | null) => {
    if (files && files.length > 0) onFiles(Array.from(files))
  }

  return (
    <div
      className={`dropzone${drag ? ' drag' : ''}`}
      role="button"
      tabIndex={0}
      aria-label={t('dropTitleA')}
      onClick={() => inputRef.current?.click()}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && inputRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault()
        setDrag(true)
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDrag(false)
        pick(e.dataTransfer.files)
      }}
    >
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
      <svg className="aperture" width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden>
        <circle cx="12" cy="12" r="10" />
        <path d="m14.31 8 5.74 9.94" />
        <path d="M9.69 8h11.48" />
        <path d="m7.38 12 5.74-9.94" />
        <path d="M9.69 16 3.95 6.06" />
        <path d="M14.31 16H2.83" />
        <path d="m16.62 12-5.74 9.94" />
      </svg>
      <h1>
        {loading ? t('developing') : (
          <>
            {t('dropTitleA')} <em>{t('dropTitleB')}</em>
          </>
        )}
      </h1>
      <p>{t('dropSub')}</p>
      <span className="hint">{t('dropHint')}</span>
    </div>
  )
}
