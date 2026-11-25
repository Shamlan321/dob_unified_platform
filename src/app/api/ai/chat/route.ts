import { NextRequest, NextResponse } from 'next/server'
import { runRagJson } from '@/lib/ai'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface ChatBody {
  question?: unknown
  department?: unknown
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    let body: ChatBody = {}
    try {
      body = (await req.json()) as ChatBody
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const question = typeof body.question === 'string' ? body.question.trim() : ''
    if (!question) {
      return NextResponse.json({ error: 'Missing or empty "question"' }, { status: 400 })
    }

    const department = typeof body.department === 'string' ? body.department : undefined

    try {
      const result = await runRagJson(question, department)
      return NextResponse.json({
        answer: result.answer,
        sources: result.sources,
        attachments: result.attachments || [],
        timing_ms: result.timing_ms,
      }, { status: 200 })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown AI backend error'
      console.error('[ai/chat] RAG failed:', message)
      return NextResponse.json(
        {
          error: 'The AI service is temporarily unavailable. Please try again in a moment.',
          detail: process.env.NODE_ENV === 'development' ? message : undefined,
        },
        { status: 200 },
      )
    }
  } catch (topErr) {
    const message = topErr instanceof Error ? topErr.message : 'Unexpected error'
    console.error('[ai/chat] top-level error:', message)
    return NextResponse.json(
      { error: 'Something went wrong while processing your question.' },
      { status: 500 },
    )
  }
}
