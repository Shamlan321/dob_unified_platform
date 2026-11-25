import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { nanoid } from 'nanoid'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function sanitizeSlug(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const db = getDb()
    const host = req.headers.get('host') || 'localhost:3000'
    const protocol = req.headers.get('x-forwarded-proto') || 'http'
    const baseUrl = `${protocol}://${host}`

    const rows = db.prepare(`
      SELECT d.id, d.slug, d.name, d.created_at,
             (SELECT COUNT(*) FROM content_items WHERE source = 'kakao_announcement' AND department = d.slug) as count
      FROM departments d
      ORDER BY d.name ASC
    `).all() as Array<{ id: string; slug: string; name: string; created_at: string; count: number }>

    const departments = rows.map(r => ({
      ...r,
      webhook_url: `${baseUrl}/api/ingest/kakao/${r.slug}`,
    }))

    return NextResponse.json({ departments })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = await req.json()
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    let slug = typeof body.slug === 'string' ? sanitizeSlug(body.slug) : ''

    if (!name) {
      return NextResponse.json({ error: 'Department name is required' }, { status: 400 })
    }

    if (!slug) {
      slug = sanitizeSlug(name)
    }

    if (!slug) {
      return NextResponse.json({ error: 'Could not generate a valid slug from name' }, { status: 400 })
    }

    const db = getDb()
    const existing = db.prepare('SELECT id FROM departments WHERE slug = ?').get(slug)
    if (existing) {
      return NextResponse.json({ error: `Department with slug "${slug}" already exists` }, { status: 409 })
    }

    const id = `dept_${nanoid(8)}`
    const now = new Date().toISOString()
    db.prepare('INSERT INTO departments (id, slug, name, created_at) VALUES (?, ?, ?, ?)').run(id, slug, name, now)

    const host = req.headers.get('host') || 'localhost:3000'
    const protocol = req.headers.get('x-forwarded-proto') || 'http'
    const baseUrl = `${protocol}://${host}`

    return NextResponse.json({
      success: true,
      department: {
        id,
        slug,
        name,
        created_at: now,
        count: 0,
        webhook_url: `${baseUrl}/api/ingest/kakao/${slug}`,
      }
    }, { status: 201 })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
