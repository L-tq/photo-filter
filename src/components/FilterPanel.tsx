import { useEffect, useState, type CSSProperties } from 'react'
import { useT } from '../i18n'
import { DEFAULT_PARAMS, type FilterKind, type FilterParams } from '../lib/filters'

interface Props {
  kind: FilterKind
  params: FilterParams
  /** Number of photos in the queue — the apply-to-all button shows above 1. */
  queueSize: number
  onKind: (kind: FilterKind) => void
  onParams: (params: FilterParams) => void
  onApplyAll: () => void
}

export default function FilterPanel({ kind, params, queueSize, onKind, onParams, onApplyAll }: Props) {
  const t = useT()
  const [applied, setApplied] = useState(false)

  useEffect(() => {
    if (!applied) return
    const id = setTimeout(() => setApplied(false), 2500)
    return () => clearTimeout(id)
  }, [applied])

  const cards: { kind: FilterKind; swatch: string; name: string; desc: string }[] = [
    { kind: 'none', swatch: 'none', name: t('filterNone'), desc: t('filterNoneDesc') },
    { kind: 'blackMist', swatch: 'black', name: t('filterBlack'), desc: t('filterBlackDesc') },
    { kind: 'whiteMist', swatch: 'white', name: t('filterWhite'), desc: t('filterWhiteDesc') },
  ]

  const sliders: { key: keyof FilterParams; label: string; hint: string }[] = [
    { key: 'strength', label: t('paramStrength'), hint: t('paramStrengthHint') },
    { key: 'diffusion', label: t('paramDiffusion'), hint: t('paramDiffusionHint') },
    { key: 'bloom', label: t('paramBloom'), hint: t('paramBloomHint') },
  ]

  const off = kind === 'none'

  return (
    <div>
      <h2>{t('filterTitle')}</h2>
      <p className="sub">{t('filterSub')}</p>

      <div className="filter-cards" role="radiogroup" aria-label={t('filterTitle')}>
        {cards.map((c) => (
          <button
            key={c.kind}
            role="radio"
            aria-checked={kind === c.kind}
            className={`fcard${kind === c.kind ? ' active' : ''}`}
            onClick={() => onKind(c.kind)}
          >
            <span className={`swatch ${c.swatch}`} aria-hidden />
            <span className="fname">{c.name}</span>
            <span className="fdesc">{c.desc}</span>
          </button>
        ))}
      </div>

      {sliders.map((s) => (
        <div className="param" key={s.key} title={s.hint}>
          <label htmlFor={`p-${s.key}`}>{s.label}</label>
          <input
            id={`p-${s.key}`}
            type="range"
            min={0}
            max={100}
            value={Math.round(params[s.key] * 100)}
            disabled={off}
            style={{ '--fill': `${Math.round(params[s.key] * 100)}%` } as CSSProperties}
            onChange={(e) => onParams({ ...params, [s.key]: Number(e.target.value) / 100 })}
          />
          <span className="val">{Math.round(params[s.key] * 100)}</span>
        </div>
      ))}

      <div style={{ marginTop: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        {queueSize > 1 ? (
          <button
            className="link-btn"
            onClick={() => {
              onApplyAll()
              setApplied(true)
            }}
            disabled={off}
          >
            {applied ? t('appliedAll', { n: queueSize }) : t('applyAll')}
          </button>
        ) : (
          <span />
        )}
        <button className="link-btn" onClick={() => onParams(DEFAULT_PARAMS)} disabled={off}>
          {t('resetParams')}
        </button>
      </div>
    </div>
  )
}
