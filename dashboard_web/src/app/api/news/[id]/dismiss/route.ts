import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/supabase/helpers'

/**
 * POST /api/news/[id]/dismiss
 * Marque une nouvelle comme "lue / comprise" par l'utilisateur courant.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })
    }

    const { id } = await params
    if (!id) {
      return NextResponse.json({ error: 'ID manquant' }, { status: 400 })
    }

    const supabase = await createClient()
    const { error } = await supabase
      .from('user_news_reads')
      .upsert(
        { user_id: user.id, news_id: id, dismissed_at: new Date().toISOString() },
        { onConflict: 'user_id,news_id' }
      )

    if (error) {
      console.error('[News dismiss POST] Error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('[News dismiss POST] Unexpected error:', error)
    return NextResponse.json({ error: error.message || 'Erreur serveur' }, { status: 500 })
  }
}
