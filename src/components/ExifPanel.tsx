import { useMemo, useState } from 'react'
import {
  buildExifRows,
  buildXmpRows,
  type EditMap,
  type ExifRow,
  type LoadedPhoto,
  type XmpRow,
} from '../lib/imageFile'
import type { AiFinding } from '../lib/aiDetect'
import { useLang, useT, type MsgKey } from '../i18n'

interface Props {
  photo: LoadedPhoto
  edits: EditMap
  onEdits: (edits: EditMap) => void
}

const GROUP_KEYS: Record<string, MsgKey> = {
  photo: 'groupPhoto',
  gps: 'groupGps',
  thumbnail: 'groupThumb',
  xmp: 'groupXmp',
}

const WHERE_KEYS: Record<AiFinding['where'], MsgKey> = {
  exif: 'whereExif',
  xmp: 'whereXmp',
  c2pa: 'whereC2pa',
  comment: 'whereComment',
}

function findingText(t: ReturnType<typeof useT>, f: AiFinding): string {
  const kw = f.keyword ? { kw: f.keyword } : undefined
  const params = f.key === 'reasonExifText' || f.key === 'reasonXmpTool' || f.key === 'reasonXmpText'
    ? { ...kw, tag: f.tagName }
    : kw
  return t(f.key, params)
}

function AiTag({ finding }: { finding: AiFinding }) {
  const t = useT()
  return (
    <span className="ai-tag" title={findingText(t, finding)}>
      ✦ AI
    </span>
  )
}

function ExifRowView({
  row,
  edit,
  onEdit,
}: {
  row: ExifRow
  edit: EditMap[string] | undefined
  onEdit: (op: { op: 'set'; text: string } | { op: 'delete' } | null) => void
}) {
  const t = useT()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  const deleted = edit?.op === 'delete'
  const edited = edit?.op === 'set'
  const display = edited ? edit.text : row.display

  const startEdit = () => {
    setDraft(edited ? edit.text : row.display.replace(/°[NSEW]?$/, ''))
    setEditing(true)
  }

  const commit = () => {
    setEditing(false)
    if (draft !== row.display || edited) onEdit({ op: 'set', text: draft })
  }

  return (
    <div
      className={`exif-row${row.ai ? ' ai-row' : ''}${deleted ? ' deleted' : ''}${edited ? ' edited' : ''}`}
    >
      <span className="k">
        {row.name}
        {row.ai && <AiTag finding={row.ai} />}
      </span>
      {editing ? (
        <span className="v">
          <input
            className="edit-input"
            value={draft}
            inputMode={row.editKind === 'number' || row.editKind === 'gps-lat' || row.editKind === 'gps-lon' ? 'decimal' : undefined}
            autoFocus
            onFocus={(e) => e.target.select()}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit()
              if (e.key === 'Escape') setEditing(false)
            }}
          />
        </span>
      ) : (
        <span
          className="v"
          title={
            deleted ? t('rowDeleted')
            : edited ? t('rowEdited')
            : row.display
          }
        >
          {display}
          {row.ai && !deleted && <span style={{ color: 'var(--text-faint)', fontSize: 11 }}>{t('removedOnExport')}</span>}
        </span>
      )}
      <span className="row-actions">
        {edit && !editing && (
          <button className="icon-btn" title={t('rowUndo')} onClick={() => onEdit(null)}>↺</button>
        )}
        {!editing && !deleted && !row.ai && (row.editKind || edited) && (
          <>
            <button className="icon-btn" title={t('rowEdit')} onClick={startEdit}>✎</button>
            {row.editKind && (
              <button className="icon-btn danger" title={t('rowDelete')} onClick={() => onEdit({ op: 'delete' })}>✕</button>
            )}
          </>
        )}
      </span>
    </div>
  )
}

export default function ExifPanel({ photo, edits, onEdits }: Props) {
  const t = useT()
  const lang = useLang()
  const [query, setQuery] = useState('')
  const rows = useMemo(() => buildExifRows(photo, lang), [photo, lang])
  const xmpRows = useMemo(() => buildXmpRows(photo), [photo])

  const q = query.trim().toLowerCase()
  const match = (name: string, value: string) => !q || name.toLowerCase().includes(q) || value.toLowerCase().includes(q)

  const groups = (['photo', 'gps', 'thumbnail'] as const)
    .map((g) => ({ key: g, rows: rows.filter((r) => r.group === g && match(r.name, r.display)) }))
    .filter((g) => g.rows.length > 0)
  const xmpVisible = xmpRows.filter((r: XmpRow) => match(r.name, r.value))
  const findings = photo.aiFindings
  const editCount = Object.keys(edits).length

  const setEdit = (id: string) => (op: { op: 'set'; text: string } | { op: 'delete' } | null) => {
    const next = { ...edits }
    if (op === null) delete next[id]
    else next[id] = op
    onEdits(next)
  }

  return (
    <div>
      <h2>{t('metaTitle')}</h2>
      <p className="sub">{t('metaSub')}</p>

      {findings.length > 0 && (
        <div className="ai-banner" role="alert">
          <div className="head">
            <span className="pulse" />
            {t('aiBannerTitle', { n: findings.length })}
          </div>
          <p className="note">{t('aiBannerNote')}</p>
          <ul className="ai-list">
            {findings.map((f, i) => (
              <li key={i}>
                <span className="where">{t(WHERE_KEYS[f.where])}</span>
                <span className="why">
                  <b>{f.tagName}</b> — {findingText(t, f)}
                  {f.value && f.where !== 'c2pa' && <span style={{ color: 'var(--text-faint)' }}> · “{f.value}”</span>}
                  {f.where === 'c2pa' && <span style={{ color: 'var(--text-faint)' }}> · {t('c2paValue', { n: Number(f.value).toLocaleString() })}</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {photo.warnings.map((w, i) => (
        <div className="notice warn" key={i}>{t(w)}</div>
      ))}

      <div className="search-box">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <circle cx="11" cy="11" r="7" />
          <path d="m21 21-4.3-4.3" />
        </svg>
        <input
          placeholder={t('searchPlaceholder')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label={t('searchLabel')}
        />
        {editCount > 0 && (
          <button className="link-btn" onClick={() => onEdits({})}>
            {t('resetEdits', { n: editCount })}
          </button>
        )}
      </div>

      {rows.length === 0 && xmpRows.length === 0 && (
        <p className="empty-meta">{t('emptyMeta')}</p>
      )}

      {groups.map((g) => (
        <section key={g.key}>
          <div className="group-head">
            <span>{t(GROUP_KEYS[g.key])}</span>
            <span>{g.rows.length}</span>
          </div>
          {g.rows.map((row) => (
            <ExifRowView key={row.id} row={row} edit={edits[row.id]} onEdit={setEdit(row.id)} />
          ))}
        </section>
      ))}

      {xmpVisible.length > 0 && (
        <section>
          <div className="group-head">
            <span>{t('groupXmp')}</span>
            <span>{photo.xmpFiltered !== null ? t('xmpCleaned') : t('xmpReadOnly')}</span>
          </div>
          {xmpVisible.map((r, i) => (
            <div key={i} className={`exif-row${r.ai ? ' ai-row' : ''}`}>
              <span className="k">
                {r.name}
                {r.ai && <AiTag finding={r.ai} />}
              </span>
              <span className="v">
                {r.value}
                {r.ai && <span style={{ color: 'var(--text-faint)', fontSize: 11 }}>{t('removedOnExport')}</span>}
              </span>
              <span />
            </div>
          ))}
        </section>
      )}

      {rows.length > 0 && (
        <p className="empty-meta" style={{ paddingTop: 14 }}>
          {t('preserveNote')}
        </p>
      )}
    </div>
  )
}
