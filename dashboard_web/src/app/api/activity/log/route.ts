import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/supabase/helpers'
import { createServiceClient } from '@/lib/supabase/service'

const VALID_EVENTS = new Set([
  'session_start',
  'session_end',
  'page_view',
  'heartbeat',
  'scrape_start',
  'scrape_complete',
])

const HEARTBEAT_DEDUP_MS = 2 * 60_000

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ ok: false }, { status: 401 })
    }

    const body = await request.json()
    const { event_type, page, session_id, duration_seconds, metadata } = body

    if (!event_type || !VALID_EVENTS.has(event_type)) {
      return NextResponse.json(
        { ok: false, error: 'Invalid event_type' },
        { status: 400 }
      )
    }

    const serviceSupabase = createServiceClient()

    if (event_type === 'heartbeat' && session_id) {
      const { data: recent } = await serviceSupabase
        .from('user_activity')
        .select('id')
        .eq('user_id', user.id)
        .eq('event_type', 'heartbeat')
        .eq('session_id', session_id)
        .gte('created_at', new Date(Date.now() - HEARTBEAT_DEDUP_MS).toISOString())
        .limit(1)

      if (recent && recent.length > 0) {
        return NextResponse.json({ ok: true, deduped: true })
      }
    }

    const { error } = await serviceSupabase
      .from('user_activity')
      .insert({
        user_id: user.id,
        event_type,
        page: page || null,
        session_id: session_id || null,
        duration_seconds: typeof duration_seconds === 'number' ? duration_seconds : null,
        metadata: metadata || {},
      })

    if (error) {
      console.error('[Activity] Insert error:', error.message)
      return NextResponse.json({ ok: false }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (err: any) {
    console.error('[Activity] Error:', err.message)
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}
