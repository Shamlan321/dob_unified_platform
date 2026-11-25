import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { ContentItem } from '@/lib/schema'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const url = new URL(req.url)
    const source = url.searchParams.get('source') || ''
    const department = url.searchParams.get('department') || ''
    const query = url.searchParams.get('q') || ''
    const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10))
    const limit = Math.max(1, Math.min(100, parseInt(url.searchParams.get('limit') || '20', 10)))
    const offset = (page - 1) * limit

    const db = getDb()

    const conditions: string[] = []
    const params: unknown[] = []

    if (source) {
      conditions.push('source = ?')
      params.push(source)
    }

    if (department) {
      conditions.push('department = ?')
      params.push(department)
    }

    if (query) {
      conditions.push('(title LIKE ? OR raw_text LIKE ?)')
      params.push(`%${query}%`, `%${query}%`)
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    const countRow = db.prepare(`SELECT COUNT(*) as count FROM content_items ${whereClause}`).get(...params) as { count: number }
    const total = countRow.count
    const totalPages = Math.ceil(total / limit)

    const items = db.prepare(`
      SELECT id, source, is_gated, department, title, raw_text, language, source_url, published_at, scraped_at, extra
      FROM content_items
      ${whereClause}
      ORDER BY published_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset) as ContentItem[]

    return NextResponse.json({
      items,
      total,
      page,
      limit,
      totalPages,
    })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest): Promise<NextResponse> {
  try {
    const url = new URL(req.url)
    let id = url.searchParams.get('id')

    if (!id) {
      try {
        const body = await req.json()
        id = body.id
      } catch {}
    }

    if (!id) {
      return NextResponse.json({ error: 'Content item "id" is required' }, { status: 400 })
    }

    const db = getDb()
    const item = db.prepare('SELECT id, title, source FROM content_items WHERE id = ?').get(id) as { id: string; title: string; source: string } | undefined

    if (!item) {
      return NextResponse.json({ error: `Content item "${id}" not found` }, { status: 404 })
    }

    db.prepare('DELETE FROM content_items WHERE id = ?').run(id)

    return NextResponse.json({
      success: true,
      deletedId: id,
      deletedTitle: item.title,
      source: item.source,
      message: 'Item deleted successfully',
    })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
