import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { ContentItem, NoticesListResponse } from '@/lib/schema'

// GET /api/notices?page=1&limit=20
export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(req.url)
  const page  = Math.max(1, parseInt(searchParams.get('page')  || '1',  10))
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '20', 10)))
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

  const response: NoticesListResponse = {
    notices,
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit),
  }

  return NextResponse.json(response)
}
