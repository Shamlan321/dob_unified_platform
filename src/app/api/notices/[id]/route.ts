import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { ContentItem } from '@/lib/schema'

// GET /api/notices/[id]
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await params
  const db = getDb()

  const notice = db.prepare(
    `SELECT * FROM content_items WHERE id = ? AND source = 'bic_notices'`
  ).get(id) as ContentItem | undefined

  if (!notice) {
    return NextResponse.json({ error: 'Notice not found' }, { status: 404 })
  }

  return NextResponse.json(notice)
}
