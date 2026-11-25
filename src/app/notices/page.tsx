import { getDb } from '@/lib/db'
import { ContentItem } from '@/lib/schema'
import { NoticeCard } from '@/components/NoticeCard'
import Link from 'next/link'

// Force dynamic rendering so the DB is read on every request (no stale cache)
export const dynamic = 'force-dynamic'

const PAGE_SIZE = 20

interface Props {
  searchParams: Promise<{ page?: string }>
}

export default async function NoticesPage({ searchParams }: Props) {
  const { page: pageParam } = await searchParams
  const page   = Math.max(1, parseInt(pageParam || '1', 10))
  const limit  = PAGE_SIZE
  const offset = (page - 1) * limit

  const db = getDb()

  const total = (db.prepare(
    `SELECT COUNT(*) as count FROM content_items WHERE source = 'bic_notices'`
  ).get() as { count: number }).count

  const notices = db.prepare(`
    SELECT * FROM content_items
    WHERE source = 'bic_notices'
    ORDER BY published_at DESC
    LIMIT ? OFFSET ?
  `).all(limit, offset) as ContentItem[]

  const totalPages = Math.ceil(total / limit)

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Notices</h1>
        <p className="page-subtitle">
          {total > 0
            ? `${total} notices from the BIC official notice board`
            : 'No notices yet — run the Python scraper to populate'}
        </p>
      </div>

      {notices.length === 0 ? (
        <div className="empty-state">
          <h2>No notices in the database</h2>
          <p>Run the push script to import scraped notices:</p>
          <code>python push_to_api.py</code>
        </div>
      ) : (
        <>
          <div className="notices-list">
            {notices.map(notice => (
              <NoticeCard key={notice.id} notice={notice} />
            ))}
          </div>

          {totalPages > 1 && (
            <nav className="pagination" aria-label="Pagination">
              {page > 1 && (
                <Link href={`/notices?page=${page - 1}`}>← Prev</Link>
              )}
              <span className="current">{page} / {totalPages}</span>
              {page < totalPages && (
                <Link href={`/notices?page=${page + 1}`}>Next →</Link>
              )}
            </nav>
          )}
        </>
      )}
    </div>
  )
}
