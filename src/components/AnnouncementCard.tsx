'use client'

import { useState } from 'react'
import { ContentItem } from '@/lib/schema'

interface Extra {
  chat_id?: number
  row_id?: number
  sender_user_id?: number
  original_ts?: string
}

interface Props {
  announcement: ContentItem
}

export function AnnouncementCard({ announcement }: Props) {
  const [expanded, setExpanded] = useState(false)

  const extra: Extra = (() => {
    try { return JSON.parse(announcement.extra) } catch { return {} }
  })()

  const langClass = `badge badge-lang-${announcement.language}`

  const deptUpper = (announcement.department || '').toUpperCase()

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
          <span className="tag tag-announce">{deptUpper}</span>
          <span className="badge badge-source">Kakao · {announcement.department}</span>
          {extra.chat_id != null && (
            <span className="notice-number">chat {extra.chat_id}</span>
          )}
          {extra.row_id != null && (
            <span className="notice-number">#{extra.row_id}</span>
          )}
          <span className={langClass}>{announcement.language.toUpperCase()}</span>
        </div>
        <div style={{ fontWeight: 600, fontSize: '14px', marginTop: '7px' }}>{announcement.title}</div>
        <div style={{ fontSize: '11px', color: 'var(--ink-soft)', marginTop: '4px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span>{announcement.published_at.slice(0, 19).replace('T', ' ')}</span>
          <span style={{ fontSize: '11px', color: 'var(--ink-soft)' }}>{expanded ? '▲' : '▼'}</span>
        </div>
      </div>

      {expanded && (
        <div className="notice-body">
          {announcement.raw_text
            ? <p style={{ whiteSpace: 'pre-wrap' }}>{announcement.raw_text}</p>
            : <p style={{ color: '#666', fontStyle: 'italic' }}>Empty message.</p>
          }

          <div className="notice-body-footer">
            <div className="meta-inline">
              {extra.sender_user_id != null && (
                <span>sender: {extra.sender_user_id}</span>
              )}
              <span>ingested: {announcement.scraped_at.slice(0, 19).replace('T', ' ')}</span>
              <span>source_url: <code>{announcement.source_url}</code></span>
            </div>
          </div>
        </div>
      )}
    </article>
  )
}
