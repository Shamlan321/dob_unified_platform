import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { ContentItem, AnnouncementsListResponse } from '@/lib/schema'

interface Params {
  params: Promise<{ department: string }>
}

// GET /api/announcements/[department]?page=1&limit=20
export async function GET(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const { department } = await params
  const { searchParams } = new URL(req.url)
  const page  = Math.max(1, parseInt(searchParams.get('page')  || '1',  10))
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '20', 10)))
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

  const response: AnnouncementsListResponse = {
    announcements,
    department,
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit),
  }

  return NextResponse.json(response)
}
