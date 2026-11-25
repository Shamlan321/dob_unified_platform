import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { IngestKakaoBatch, IngestResponse, IngestResult, ContentItem } from '@/lib/schema'
import { nanoid } from 'nanoid'

// ─── Auth ─────────────────────────────────────────────────────────────────────
function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.INGEST_SECRET
  if (!secret) return true
  return req.headers.get('x-ingest-secret') === secret
}

// ─── Language detection (reused from notices ingest) ──────────────────────────
function detectLanguage(text: string): ContentItem['language'] {
  const koreanChars = (text.match(/[\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]/g) || []).length
  const totalChars  = text.replace(/\s/g, '').length || 1
  const ratio = koreanChars / totalChars
  if (ratio > 0.4) return 'ko'
  if (ratio > 0.05) return 'mixed'
  return 'en'
}

/**
 * Turn yyyy-MM-dd HH:mm:ss → ISO-8601 (yyyy-MM-dd is the minimum
 * published_at needs; we keep the whole string if parseable).
 */
function normalizeTs(ts: string): string {
  try {
    const d = new Date(ts.replace(' ', 'T'))
    if (!isNaN(d.getTime())) return d.toISOString()
  } catch {}
  // Fallback — keep as-is if it already looks datestamp-ish, otherwise now
  return ts || new Date().toISOString()
}

// ─── POST /api/ingest/kakao/[department] ─────────────────────────────────────

interface Params {
  params: Promise<{ department: string }>
}

export async function POST(req: NextRequest, { params }: Params): Promise<NextResponse> {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { department } = await params
  if (!department || department.trim().length === 0) {
    return NextResponse.json(
      { error: 'Department slug is required in the URL path.' },
      { status: 400 }
    )
  }

  let body: IngestKakaoBatch
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return NextResponse.json(
      { error: '`messages` array is required and must not be empty' },
      { status: 400 }
    )
  }

  const upsert = body.upsert === true
  const db = getDb()
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
  let inserted   = 0
  let duplicates = 0

  const run = db.transaction(() => {
    for (const msg of body.messages) {
      // Dedup key: kakao://<chat_id>/<row_id> — stable, unique per message
      const sourceUrl = `kakao://${msg.chat_id}/${msg.row_id}`

      // Title fallback: first ~60 chars of the message (Kakao messages
      // don't have a separate subject/title line).
      const trimmed = (msg.text || '').trim()
      const title   = trimmed.length === 0
        ? `[empty message ${msg.row_id}]`
        : trimmed.length > 80
          ? trimmed.slice(0, 80) + '…'
          : trimmed

      const publishedAt = normalizeTs(msg.timestamp)
      const scrapedAt   = new Date().toISOString()

      const row = {
        id:           nanoid(),
        source:       'kakao_announcement',
        is_gated:     1,
        department:   department.trim(),
        title,
        raw_text:     trimmed,
        language:     detectLanguage(trimmed),
        images:       '[]',
        source_url:   sourceUrl,
        published_at: publishedAt,
        scraped_at:   scrapedAt,
        extra: JSON.stringify({
          chat_id:        msg.chat_id,
          row_id:         msg.row_id,
          sender_user_id: msg.sender_user_id,
          original_ts:    msg.timestamp,
        }),
      }

      const result = stmt.run(row)
      if (result.changes > 0) {
        inserted++
        results.push({ url: sourceUrl, status: 'created' })
      } else {
        duplicates++
        results.push({ url: sourceUrl, status: 'duplicate' })
      }
    }
  })

  run()

  const response: IngestResponse = {
    total: body.messages.length,
    inserted,
    duplicates,
    results,
  }
  return NextResponse.json(response, { status: 200 })
}
