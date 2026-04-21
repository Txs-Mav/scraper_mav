import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/supabase/helpers'

/**
 * GET /api/news/unseen
 * Renvoie la dernière nouvelle avec show_in_modal=true non dismissed par l'utilisateur.
 * Utilisé par le modal d'annonce au login.
 */
export async function GET() {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })
    }

    const supabase = await createClient()

    const { data: candidates, error } = await supabase
      .from('news')
      .select('id, slug, title, summary, body_md, show_in_modal, published_at, created_at')
      .eq('is_published', true)
      .eq('show_in_modal', true)
      .order('published_at', { ascending: false })
      .limit(10)

    if (error) {
      if ((error as any).code === 'PGRST205' || (error as any).code === '42P01') {
        return NextResponse.json({ news: null })
      }
      console.error('[News unseen GET] Error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    if (!candidates || candidates.length === 0) {
      return NextResponse.json({ news: null })
    }

    const ids = candidates.map(n => n.id)
    const { data: reads } = await supabase
      .from('user_news_reads')
      .select('news_id')
      .eq('user_id', user.id)
      .in('news_id', ids)

    const dismissed = new Set((reads || []).map(r => r.news_id))
    const unseen = candidates.find(n => !dismissed.has(n.id))

    return NextResponse.json({ news: unseen || null })
  } catch (error: any) {
    console.error('[News unseen GET] Unexpected error:', error)
    return NextResponse.json({ error: error.message || 'Erreur serveur' }, { status: 500 })
  }
}
