import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { IngestBatch, IngestResponse, IngestResult, ContentItem } from '@/lib/schema'
import { nanoid } from 'nanoid'

// ─── Auth ─────────────────────────────────────────────────────────────────────
function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.INGEST_SECRET
  if (!secret) return true
  return req.headers.get('x-ingest-secret') === secret
}

// ─── Language detection ───────────────────────────────────────────────────────
function detectLanguage(text: string): ContentItem['language'] {
  const koreanChars = (text.match(/[\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]/g) || []).length
  const totalChars  = text.replace(/\s/g, '').length || 1
  const ratio = koreanChars / totalChars
  if (ratio > 0.4) return 'ko'
  if (ratio > 0.05) return 'mixed'
  return 'en'
}

// ─── POST /api/ingest/notices ─────────────────────────────────────────────────
export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: IngestBatch
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!Array.isArray(body.notices) || body.notices.length === 0) {
    return NextResponse.json(
      { error: '`notices` array is required and must not be empty' },
      { status: 400 }
    )
  }

  const upsert = body.upsert === true
  const db = getDb()

  // INSERT OR IGNORE  — new records only (default, idempotent)
  // INSERT OR REPLACE — update every field if source_url already exists (upsert mode)
  const conflictAction = upsert ? 'REPLACE' : 'IGNORE'

  const stmt = db.prepare(`
    INSERT OR ${conflictAction} INTO content_items
      (id, source, is_gated, department, title, raw_text, language, images,
       source_url, published_at, scraped_at, extra)
    VALUES
      (@id, @source, @is_gated, @department, @title, @raw_text, @language, @images,
       @source_url, @published_at, @scraped_at, @extra)
  `)

  const results: IngestResult[] = []
  let inserted  = 0
  let duplicates = 0

  const run = db.transaction(() => {
    for (const notice of body.notices) {
      // Parse comma-separated images (scraper format) → JSON array
      const imageArr = notice.images
        ? notice.images.split(',').map(s => s.trim()).filter(Boolean)
        : []

      // Parse attachments — scraper sends them as a JSON string already
      let attachmentsArr: Array<{ name: string; url: string }> = []
      if (notice.attachments) {
        try {
          attachmentsArr = JSON.parse(notice.attachments)
        } catch { /* ignore malformed */ }
      }

      const row = {
        id:           nanoid(),
        source:       'bic_notices',
        is_gated:     0,
        department:   null,
        title:        notice.title,
        raw_text:     notice.content || '',
        language:     detectLanguage(notice.content || ''),
        images:       JSON.stringify(imageArr),
        source_url:   notice.url,
        published_at: notice.date,
        scraped_at:   new Date().toISOString(),
        extra: JSON.stringify({
          notice_number: notice.notice_number,
          views:         notice.views,
          attachments:   attachmentsArr,
        }),
      }

      const result = stmt.run(row)

      // In REPLACE mode, changes=1 on both insert AND replace, so we
      // check last_insert_rowid delta — or just track via upsert flag.
      if (result.changes > 0) {
        inserted++
        results.push({ url: notice.url, status: 'created' })
      } else {
        duplicates++
        results.push({ url: notice.url, status: 'duplicate' })
      }
    }
  })

  run()

  const response: IngestResponse = { total: body.notices.length, inserted, duplicates, results }
  return NextResponse.json(response, { status: 200 })
}
