import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { spawn } from 'child_process'
import path from 'path'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const PROJECT_ROOT = process.cwd()
const SCRAPPER_DIR = path.join(PROJECT_ROOT, 'python-scrapper')
const RUNNER_PY = path.join(SCRAPPER_DIR, 'run_pipeline.py')

// In-memory state for live execution monitoring
let isRunning = false
let currentLog = ''
let lastRunStartedAt: string | null = null

function getPythonBin(): string {
  if (process.env.PYTHON_BIN) return process.env.PYTHON_BIN
  return process.platform === 'win32' ? 'python' : 'python3'
}

function startScraperProcess(upsert = false): void {
  if (isRunning) return
  isRunning = true
  currentLog = `[${new Date().toISOString()}] Starting scraper pipeline...\n`
  lastRunStartedAt = new Date().toISOString()

  const db = getDb()
  const now = new Date().toISOString()
  db.prepare('UPDATE app_settings SET value = ?, updated_at = ? WHERE key = ?').run('running', now, 'scraper_last_status')
  db.prepare('UPDATE app_settings SET value = ?, updated_at = ? WHERE key = ?').run(lastRunStartedAt, now, 'scraper_last_run')

  const pyBin = getPythonBin()
  const args = [RUNNER_PY, '--url', 'http://localhost:3000']
  if (upsert) args.push('--upsert')

  const proc = spawn(pyBin, args, {
    cwd: SCRAPPER_DIR,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1' },
    shell: false,
    windowsHide: true,
  })

  proc.stdout.on('data', (data) => {
    const text = data.toString()
    currentLog += text
    if (currentLog.length > 20000) {
      currentLog = currentLog.slice(-15000)
    }
  })

  proc.stderr.on('data', (data) => {
    const text = data.toString()
    currentLog += `[ERR] ${text}`
    if (currentLog.length > 20000) {
      currentLog = currentLog.slice(-15000)
    }
  })

  proc.on('close', (code) => {
    isRunning = false
    const finishTime = new Date().toISOString()
    const status = code === 0 ? 'success' : 'failed'
    currentLog += `\n[${finishTime}] Pipeline finished with exit code ${code} (${status}).\n`

    try {
      const dbFinish = getDb()
      dbFinish.prepare('UPDATE app_settings SET value = ?, updated_at = ? WHERE key = ?').run(status, finishTime, 'scraper_last_status')
      dbFinish.prepare('UPDATE app_settings SET value = ?, updated_at = ? WHERE key = ?').run(currentLog.slice(-3000), finishTime, 'scraper_last_log')
    } catch (err) {
      console.error('Failed to update app_settings after scraper run:', err)
    }
  })

  proc.on('error', (err) => {
    isRunning = false
    const finishTime = new Date().toISOString()
    currentLog += `\n[${finishTime}] Failed to spawn scraper: ${err.message}\n`
    try {
      const dbErr = getDb()
      dbErr.prepare('UPDATE app_settings SET value = ?, updated_at = ? WHERE key = ?').run('failed', finishTime, 'scraper_last_status')
      dbErr.prepare('UPDATE app_settings SET value = ?, updated_at = ? WHERE key = ?').run(currentLog.slice(-3000), finishTime, 'scraper_last_log')
    } catch {}
  })
}

// Background periodic checker
let timerStarted = false
function initBackgroundScheduler() {
  if (timerStarted) return
  timerStarted = true

  // Check every 5 minutes
  setInterval(() => {
    try {
      const db = getDb()
      const rows = db.prepare("SELECT key, value FROM app_settings WHERE key IN ('scraper_enabled', 'scraper_interval_hours', 'scraper_last_run')").all() as Array<{ key: string; value: string }>
      const map: Record<string, string> = {}
      for (const r of rows) map[r.key] = r.value

      const enabled = map.scraper_enabled === 'true'
      const intervalHours = parseFloat(map.scraper_interval_hours || '24')
      const lastRun = map.scraper_last_run ? new Date(map.scraper_last_run).getTime() : 0

      if (enabled && !isRunning && intervalHours > 0) {
        const elapsedHours = (Date.now() - lastRun) / (1000 * 60 * 60)
        if (elapsedHours >= intervalHours) {
          console.log(`[Scheduler] Interval triggered: ${elapsedHours.toFixed(1)}h elapsed >= ${intervalHours}h. Running scraper...`)
          startScraperProcess(false)
        }
      }
    } catch (err) {
      console.error('[Scheduler] Error in check:', err)
    }
  }, 5 * 60 * 1000)
}

initBackgroundScheduler()

export async function GET(): Promise<NextResponse> {
  try {
    const db = getDb()
    const rows = db.prepare('SELECT key, value, updated_at FROM app_settings').all() as Array<{ key: string; value: string; updated_at: string }>
    const settings: Record<string, string> = {}
    for (const r of rows) settings[r.key] = r.value

    return NextResponse.json({
      settings,
      isRunning,
      currentLog: currentLog || settings.scraper_last_log || '',
      lastRunStartedAt,
    })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = await req.json()
    const db = getDb()
    const now = new Date().toISOString()

    if (body.action === 'run') {
      if (isRunning) {
        return NextResponse.json({ error: 'Scraper is already running' }, { status: 409 })
      }
      startScraperProcess(Boolean(body.upsert))
      return NextResponse.json({ success: true, message: 'Scraper run initiated' })
    }

    if (body.action === 'save_settings') {
      const updateSetting = db.prepare('INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)')
      if (typeof body.enabled === 'boolean') {
        updateSetting.run('scraper_enabled', String(body.enabled), now)
      }
      if (body.intervalHours !== undefined) {
        const hours = Math.max(1, Number(body.intervalHours) || 24)
        updateSetting.run('scraper_interval_hours', String(hours), now)
      }
      return NextResponse.json({ success: true, message: 'Settings saved' })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
