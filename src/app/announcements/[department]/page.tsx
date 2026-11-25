import { getDb } from '@/lib/db'
import { ContentItem } from '@/lib/schema'
import { AnnouncementCard } from '@/components/AnnouncementCard'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 20

interface Props {
  params: Promise<{ department: string }>
  searchParams: Promise<{ page?: string }>
}

export default async function AnnouncementsDeptPage({ params, searchParams }: Props) {
  const { department } = await params
  const { page: pageParam } = await searchParams
  const page   = Math.max(1, parseInt(pageParam || '1', 10))
  const limit  = PAGE_SIZE
  const offset = (page - 1) * limit

  const db = getDb()

  const total = (db.prepare(
    `SELECT COUNT(*) as count FROM content_items
     WHERE source = 'kakao_announcement' AND department = ?`
  ).get(department) as { count: number }).count

  const announcements = db.prepare(`
    SELECT * FROM content_items
    WHERE source = 'kakao_announcement' AND department = ?
    ORDER BY published_at DESC
    LIMIT ? OFFSET ?
  `).all(department, limit, offset) as ContentItem[]

  const totalPages = Math.ceil(total / limit)

  return (
    <div className="page">
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Link href="/announcements" className="back-link">← All depts</Link>
        </div>
        <h1 className="page-title">Announcements · {department}</h1>
        <p className="page-subtitle">
          {total > 0
            ? `${total} message${total === 1 ? '' : 's'} in department channel "${department}"`
            : `No messages yet for "${department}" — send some via the KakaoDump Android app webhook.`}
        </p>
      </div>

      {announcements.length === 0 ? (
        <div className="empty-state">
          <h2>No messages in this channel</h2>
          <p>
            Configure the KakaoDump app with webhook URL:
          </p>
          <code>
            {'<your-server>'}/api/ingest/kakao/{department}
          </code>
        </div>
      ) : (
        <>
          <div className="notices-list">
            {announcements.map(a => (
              <AnnouncementCard key={a.id} announcement={a} />
            ))}
          </div>

          {totalPages > 1 && (
            <nav className="pagination" aria-label="Pagination">
              {page > 1 && (
                <Link href={`/announcements/${encodeURIComponent(department)}?page=${page - 1}`}>← Prev</Link>
              )}
              <span className="current">{page} / {totalPages}</span>
              {page < totalPages && (
                <Link href={`/announcements/${encodeURIComponent(department)}?page=${page + 1}`}>Next →</Link>
              )}
            </nav>
          )}
        </>
      )}
    </div>
  )
}
