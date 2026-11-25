// ─── Unified Content Schema ──────────────────────────────────────────────────
// This schema serves all three data sources:
//   - bic_notices       (public, scraped from tu.ac.kr)
//   - kakao_announcement (gated, by department — future)
//   - university_info    (public; indexed into the unified RAG knowledge base)

export type Source = 'bic_notices' | 'kakao_announcement' | 'university_info'
export type Language = 'en' | 'ko' | 'mixed'

export interface ContentItem {
  /** nanoid — stable primary key */
  id: string
  /** Which data source this came from */
  source: Source
  /** Department identifier — only populated for kakao_announcement */
  department: string | null
  /** Headline / notice title */
  title: string
  /** Full plain-text body extracted from the source page */
  raw_text: string
  /** Detected or declared language of the content */
  language: Language
  /** Canonical URL of the original source page — used as dedup key */
  source_url: string
  /** ISO 8601 date string from the source (e.g. "2026-08-18") */
  published_at: string
  /** ISO 8601 datetime of when this record was ingested */
  scraped_at: string
  /** JSON-encoded string[] of absolute image URLs found in the content */
  images: string
  /** 0 = public, 1 = department-gated (Kakao announcements) */
  is_gated: 0 | 1
  /**
   * JSON-encoded object for source-specific extras that don't belong
   * in the core schema.
   * BIC Notices extras: { notice_number: string, views: number }
   */
  extra: string
}

// ─── Ingest payload types (what the Python script sends) ────────────────────

export interface IngestNoticePayload {
  notice_number: string
  title: string
  date: string
  views: number
  content: string
  images: string       // comma-separated image URLs
  attachments: string  // JSON string: [{name: string, url: string}[]]
  url: string
}

export interface IngestBatch {
  notices: IngestNoticePayload[]
  /** If true, existing records are updated (INSERT OR REPLACE) instead of skipped */
  upsert?: boolean
}

// ─── Kakao ingest payload types (what the Android app sends) ───────────────

export interface IngestKakaoMessage {
  /** KakaoTalk DB row _id — used for dedup together with chat_id */
  row_id: number
  /** KakaoTalk chat_id (the group/chat identifier) */
  chat_id: number
  /** Sender's user_id from the DB row */
  sender_user_id: number
  /** Decrypted plaintext message body */
  text: string
  /** ISO-like timestamp string from the app (yyyy-MM-dd HH:mm:ss) */
  timestamp: string
}

export interface IngestKakaoBatch {
  messages: IngestKakaoMessage[]
  /** If true, existing records are updated instead of skipped */
  upsert?: boolean
}

// ─── API response types ──────────────────────────────────────────────────────

export interface IngestResult {
  url: string
  status: 'created' | 'duplicate'
}

export interface IngestResponse {
  total: number
  inserted: number
  duplicates: number
  results: IngestResult[]
}

export interface NoticesListResponse {
  notices: ContentItem[]
  page: number
  limit: number
  total: number
  totalPages: number
}

export interface AnnouncementsListResponse {
  announcements: ContentItem[]
  department: string
  page: number
  limit: number
  total: number
  totalPages: number
}

// ─── Admin & Configuration types ─────────────────────────────────────────────

export interface Department {
  id: string
  slug: string
  name: string
  created_at: string
  count?: number
  webhook_url?: string
}

export interface AppSetting {
  key: string
  value: string
  updated_at: string
}
