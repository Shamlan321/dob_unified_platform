import { NextResponse } from 'next/server'
import path from 'path'
import fs from 'fs'
import { spawn } from 'child_process'
import { getPythonBin } from '@/lib/ai'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const PROJECT_ROOT = process.cwd()
const TU_RAG_DIR = path.join(PROJECT_ROOT, 'tu_rag')
const STORAGE_DIR = path.join(TU_RAG_DIR, 'storage')
const MANIFEST_PATH = path.join(STORAGE_DIR, 'kb_manifest.json')
const RAG_PY = path.join(TU_RAG_DIR, 'rag.py')

let isBuilding = false
let buildLog = ''

export async function GET(): Promise<NextResponse> {
  try {
    const storageExists = fs.existsSync(STORAGE_DIR)
    const docstoreExists = fs.existsSync(path.join(STORAGE_DIR, 'docstore.json'))
    let docCount = 0
    let schemaVersion = 0
    let lastModified: string | null = null

    if (fs.existsSync(MANIFEST_PATH)) {
      try {
        const manifestRaw = fs.readFileSync(MANIFEST_PATH, 'utf-8')
        const manifest = JSON.parse(manifestRaw)
        schemaVersion = manifest.schema_version || 0
        docCount = manifest.docs ? Object.keys(manifest.docs).length : 0
        const stat = fs.statSync(MANIFEST_PATH)
        lastModified = stat.mtime.toISOString()
      } catch {}
    }

    return NextResponse.json({
      storageExists,
      docstoreExists,
      docCount,
      schemaVersion,
      lastModified,
      isBuilding,
      buildLog,
    })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}

export async function POST(): Promise<NextResponse> {
  if (isBuilding) {
    return NextResponse.json({ error: 'AI index build is already in progress' }, { status: 409 })
  }

  isBuilding = true
  buildLog = `[${new Date().toISOString()}] Starting AI vector index build...\n`

  const pyBin = getPythonBin()
  const proc = spawn(pyBin, [RAG_PY, '--json', 'build'], {
    cwd: TU_RAG_DIR,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1' },
    shell: false,
    windowsHide: true,
  })

  proc.stdout.on('data', (d) => {
    buildLog += d.toString()
  })

  proc.stderr.on('data', (d) => {
    buildLog += `[ERR] ${d.toString()}`
  })

  proc.on('close', (code) => {
    isBuilding = false
    buildLog += `\n[${new Date().toISOString()}] Index build finished with code ${code}.\n`
  })

  proc.on('error', (err) => {
    isBuilding = false
    buildLog += `\n[${new Date().toISOString()}] Process error: ${err.message}\n`
  })

  return NextResponse.json({ success: true, message: 'AI index build initiated' })
}
