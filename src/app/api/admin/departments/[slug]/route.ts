import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ slug: string }>
}

export async function DELETE(req: NextRequest, { params }: Props): Promise<NextResponse> {
  try {
    const { slug } = await params
    const db = getDb()

    const existing = db.prepare('SELECT id, name FROM departments WHERE slug = ?').get(slug)
    if (!existing) {
      return NextResponse.json({ error: `Department "${slug}" not found` }, { status: 404 })
    }

    // Delete the department entry
    db.prepare('DELETE FROM departments WHERE slug = ?').run(slug)

    // Check if delete_announcements flag is set
    const url = new URL(req.url)
    const cascade = url.searchParams.get('cascade') === 'true'
    let deletedAnnouncements = 0

    if (cascade) {
      const result = db.prepare("DELETE FROM content_items WHERE source = 'kakao_announcement' AND department = ?").run(slug)
      deletedAnnouncements = result.changes
    }

    return NextResponse.json({
      success: true,
      message: `Department "${slug}" deleted`,
      deletedAnnouncements,
    })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
