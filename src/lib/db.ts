import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'

// ─── DB path: project-root/data/bic_pulse.db ────────────────────────────────
const DATA_DIR = path.join(process.cwd(), 'data')
const DB_PATH  = path.join(DATA_DIR, 'bic_pulse.db')

// Ensure the data directory exists at module load time
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true })
}

// ─── Singleton instance ──────────────────────────────────────────────────────
let _db: Database.Database | null = null

export function getDb(): Database.Database {
  if (_db) return _db

  _db = new Database(DB_PATH)

  // Enable WAL mode for better concurrent read performance
  _db.pragma('journal_mode = WAL')
  _db.pragma('foreign_keys = ON')

  initSchema(_db)
  return _db
}

// ─── Schema bootstrap ────────────────────────────────────────────────────────
function initSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS content_items (
      -- Core identity
      id           TEXT PRIMARY KEY,
      source       TEXT NOT NULL CHECK(source IN ('bic_notices','kakao_announcement','university_info')),

      -- Access control (for future Kakao gating)
      is_gated     INTEGER NOT NULL DEFAULT 0 CHECK(is_gated IN (0,1)),
      department   TEXT,

      -- Content
      title        TEXT NOT NULL,
      raw_text     TEXT NOT NULL DEFAULT '',
      language     TEXT NOT NULL DEFAULT 'mixed' CHECK(language IN ('en','ko','mixed')),
      images       TEXT NOT NULL DEFAULT '[]',

      -- Provenance
      source_url   TEXT NOT NULL UNIQUE,
      published_at TEXT NOT NULL,
      scraped_at   TEXT NOT NULL,

      -- Source-specific extras (JSON blob)
      extra        TEXT NOT NULL DEFAULT '{}'
    );

    -- Index for the notices list page (most common query)
    CREATE INDEX IF NOT EXISTS idx_content_source_date
      ON content_items(source, published_at DESC);

    -- Index for future FTS5 keyword search prep
    CREATE INDEX IF NOT EXISTS idx_content_gated
      ON content_items(is_gated, source);

    -- Departments table for Kakao relays and student signup
    CREATE TABLE IF NOT EXISTS departments (
      id         TEXT PRIMARY KEY,
      slug       TEXT UNIQUE NOT NULL,
      name       TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    -- Application configuration settings (scraper schedule, etc.)
    CREATE TABLE IF NOT EXISTS app_settings (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `)

  seedDefaults(db)
}

function seedDefaults(db: Database.Database): void {
  // Seed default departments if table is empty
  const deptCount = (db.prepare('SELECT COUNT(*) as count FROM departments').get() as { count: number }).count
  if (deptCount === 0) {
    const insertDept = db.prepare('INSERT OR IGNORE INTO departments (id, slug, name, created_at) VALUES (?, ?, ?, ?)')
    const now = new Date().toISOString()
    const initialDepts = [
      { id: 'dept_ce', slug: 'computer_engineering', name: 'Computer Engineering' },
      { id: 'dept_ba', slug: 'business_admin', name: 'Business Administration' },
      { id: 'dept_me', slug: 'mechanical_eng', name: 'Mechanical Engineering' },
      { id: 'dept_ns', slug: 'nursing', name: 'Nursing' },
      { id: 'dept_demo', slug: 'demo_dep', name: 'Demo Department' },
    ]
    for (const d of initialDepts) {
      insertDept.run(d.id, d.slug, d.name, now)
    }
  }

  // Seed default app settings if not present
  const insertSetting = db.prepare('INSERT OR IGNORE INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)')
  const now = new Date().toISOString()
  const defaultSettings = [
    { key: 'scraper_enabled', value: 'true' },
    { key: 'scraper_interval_hours', value: '24' },
    { key: 'scraper_last_run', value: '' },
    { key: 'scraper_last_status', value: 'idle' },
    { key: 'scraper_last_log', value: '' },
  ]
  for (const s of defaultSettings) {
    insertSetting.run(s.key, s.value, now)
  }
}
