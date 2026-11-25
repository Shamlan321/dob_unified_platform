'use client'

import { useState } from 'react'
import { ContentItem } from '@/lib/schema'

interface Attachment {
  name: string
  url: string
}

interface Extra {
  notice_number?: string
  views?: number
  attachments?: Attachment[]
}

interface NoticeCardProps {
  notice: ContentItem
}

export function NoticeCard({ notice }: NoticeCardProps) {
  const [expanded, setExpanded] = useState(false)

  const extra: Extra = (() => {
    try { return JSON.parse(notice.extra) } catch { return {} }
  })()

  const images: string[] = (() => {
    try { return JSON.parse(notice.images) } catch { return [] }
  })()

  const attachments: Attachment[] = extra.attachments || []
  const langClass = `badge badge-lang-${notice.language}`

  return (
    <article className="card notice-card">
      <div
        onClick={() => setExpanded(v => !v)}
        role="button"
        aria-expanded={expanded}
        tabIndex={0}
        onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && setExpanded(v => !v)}
        style={{ cursor: 'pointer' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <span className="tag tag-notice">NOTICE</span>
          <span className="badge badge-source">BIC Notice</span>
          {extra.notice_number && (
            <span className="notice-number">#{extra.notice_number}</span>
          )}
          {extra.views != null && (
            <span className="notice-views">{extra.views.toLocaleString()} views</span>
          )}
          <span className={langClass}>{notice.language.toUpperCase()}</span>
          {attachments.length > 0 && (
            <span className="badge badge-attach">📎 {attachments.length}</span>
          )}
        </div>
        <div style={{ fontWeight: 600, fontSize: '14px', marginTop: '7px' }}>{notice.title}</div>
        <div style={{ fontSize: '11px', color: 'var(--ink-soft)', marginTop: '4px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span>{notice.published_at}</span>
          <span style={{ fontSize: '11px', color: 'var(--ink-soft)' }}>{expanded ? '▲' : '▼'}</span>
        </div>
      </div>

      {/* ── Expanded body ── */}
      {expanded && (
        <div className="notice-body">

          {/* Images (if any) */}
          {images.length > 0 && (
            <div className="notice-images">
              {images.map((src, i) => (
                <img key={i} src={src} alt={`Notice image ${i + 1}`} />
              ))}
            </div>
          )}

          {/* Body text */}
          {notice.raw_text
            ? <p style={{ whiteSpace: 'pre-wrap' }}>{notice.raw_text}</p>
            : <p style={{ color: '#666', fontStyle: 'italic' }}>No body text was captured for this notice.</p>
          }

          {/* Attachments */}
          {attachments.length > 0 && (
            <div className="notice-attachments">
              <p className="attachments-label">Attachments</p>
              {attachments.map((att, i) => (
                <a
                  key={i}
                  href={att.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="attachment-link"
                  download
                >
                  <span className="attachment-icon">⬇</span>
                  <span className="attachment-name">{att.name}</span>
                </a>
              ))}
            </div>
          )}

          {/* Footer */}
          <div className="notice-body-footer">
            <a href={notice.source_url} target="_blank" rel="noopener noreferrer">
              See Original Post →
            </a>
          </div>
        </div>
      )}
    </article>
  )
}
