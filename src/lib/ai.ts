import { spawn } from 'child_process'
import path from 'path'

export interface AttachmentItem {
  name: string
  url: string
  source_title?: string
}

export interface RagSource {
  label: string
  preview?: string
  source?: string
  item_id?: string
  title?: string
  source_url?: string
  attachments?: AttachmentItem[]
}

export interface RagResponse {
  answer: string
  sources: RagSource[]
  attachments?: AttachmentItem[]
  timing_ms?: number
}

const PROJECT_ROOT = process.cwd()
const TU_RAG_DIR = path.join(PROJECT_ROOT, 'tu_rag')
const RAG_PY = path.join(TU_RAG_DIR, 'rag.py')
const SERVER_PY = path.join(TU_RAG_DIR, 'server.py')
const AI_SERVER_URL = process.env.AI_SERVER_URL || 'http://127.0.0.1:8001'

let isServerStarting = false

export function getPythonBin(): string {
  if (process.env.PYTHON_BIN) return process.env.PYTHON_BIN
  return process.platform === 'win32' ? 'python' : 'python3'
}

/**
 * Ensures the persistent Python server is running in the background.
 * Spawns it as a detached background process if not already running.
 */
export async function ensureAiServerStarted(): Promise<void> {
  try {
    const res = await fetch(`${AI_SERVER_URL}/health`, { signal: AbortSignal.timeout(1000) })
    if (res.ok) return
  } catch {}

  if (isServerStarting) return
  isServerStarting = true

  const pyBin = getPythonBin()
  console.log(`[ai] Starting persistent BIC AI background server on ${AI_SERVER_URL}...`)

  try {
    const child = spawn(pyBin, [SERVER_PY], {
      cwd: TU_RAG_DIR,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1' },
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    })
    child.unref()
  } catch (spawnErr) {
    console.error('[ai] Failed to launch background server:', spawnErr)
  }

  setTimeout(() => {
    isServerStarting = false
  }, 4000)
}

/**
 * Fallback CLI execution if server is offline or starting up.
 */
function runRagCli(question: string, department?: string): Promise<RagResponse> {
  return new Promise((resolve, reject) => {
    const pyBin = getPythonBin()
    const env = {
      ...process.env,
      PYTHONIOENCODING: 'utf-8',
      PYTHONUNBUFFERED: '1',
    }
    const args = [RAG_PY, '--json', 'ask', question]
    if (department && department.trim()) {
      args.push('--department', department.trim())
    }

    let stdout = ''
    let stderr = ''
    let done = false
    const timeoutMs = 120_000

    const child = spawn(pyBin, args, {
      env,
      cwd: TU_RAG_DIR,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })

    const timer = setTimeout(() => {
      if (!done) {
        done = true
        try { child.kill('SIGTERM') } catch {}
        reject(new Error(`AI request timed out after ${timeoutMs / 1000}s`))
      }
    }, timeoutMs)

    child.stdout.on('data', (buf) => { stdout += buf.toString() })
    child.stderr.on('data', (buf) => { stderr += buf.toString() })

    child.on('error', (err) => {
      if (done) return
      done = true
      clearTimeout(timer)
      reject(new Error(`Failed to start Python (${pyBin}): ${err.message}`))
    })

    child.on('close', (code) => {
      if (done) return
      done = true
      clearTimeout(timer)

      const jsonText = stdout.trim()

      if (code !== 0) {
        const msg = stderr.trim() || `Python exited with code ${code}`
        reject(new Error(msg.slice(-800)))
        return
      }

      if (!jsonText) {
        reject(new Error('Empty JSON output from RAG'))
        return
      }

      try {
        const parsed = JSON.parse(jsonText) as Partial<RagResponse>
        if (typeof parsed.answer !== 'string' || !Array.isArray(parsed.sources)) {
          throw new Error('Malformed JSON shape from RAG')
        }
        resolve({
          answer: parsed.answer,
          sources: parsed.sources as RagSource[],
          attachments: parsed.attachments || [],
          timing_ms: parsed.timing_ms,
        })
      } catch (parseErr) {
        reject(new Error(
          `Failed to parse RAG JSON: ${(parseErr as Error).message}\nGot: ${jsonText.slice(-600)}`
        ))
      }
    })
  })
}

/**
 * Main RAG function:
 * First attempts the fast, persistent in-memory HTTP server (~2s).
 * If the server is not ready, transparently falls back to the CLI bridge and starts the server.
 */
export async function runRagJson(question: string, department?: string): Promise<RagResponse> {
  const t0 = Date.now()

  // 1. Try persistent HTTP server
  try {
    const res = await fetch(`${AI_SERVER_URL}/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, department }),
      signal: AbortSignal.timeout(25000),
    })

    if (res.ok) {
      const data = await res.json()
      const totalElapsed = Date.now() - t0
      console.log(
        `[ai/chat] ✅ In-memory response in ${totalElapsed}ms ` +
        `(server: ${data.server_latency_ms}ms, sources: ${data.sources?.length || 0}, attachments: ${data.attachments?.length || 0})`
      )
      return {
        answer: data.answer,
        sources: data.sources || [],
        attachments: data.attachments || [],
        timing_ms: totalElapsed,
      }
    }
  } catch {
    // Server is either offline or starting up
    console.log('[ai/chat] Persistent server not reached; launching server in background & using CLI bridge for this query...')
    ensureAiServerStarted().catch(() => {})
  }

  // 2. Fallback to CLI bridge
  console.log('[ai/chat] Running via CLI bridge...')
  const result = await runRagCli(question, department)
  const totalElapsed = Date.now() - t0
  console.log(`[ai/chat] CLI bridge finished in ${totalElapsed}ms`)
  return {
    ...result,
    timing_ms: totalElapsed,
  }
}
