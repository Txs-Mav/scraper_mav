import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/supabase/helpers'

const SCHEMA_MISSING_CODE = 'NEWS_SCHEMA_MISSING'

function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

/**
 * GET /api/news
 * Liste des nouvelles publiées (feed).
 * Query params : limit (default 20, max 100), includeDrafts (admin only).
 */
export async function GET(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })
    }

    const url = new URL(request.url)
    const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') || '20', 10)))
    const includeDrafts = url.searchParams.get('includeDrafts') === 'true' && user.role === 'main'

    const supabase = await createClient()

    let query = supabase
      .from('news')
      .select('id, slug, title, summary, body_md, show_in_modal, is_published, published_at, created_at, updated_at')
      .order('published_at', { ascending: false })
      .limit(limit)

    if (!includeDrafts) {
      query = query.eq('is_published', true)
    }

    const { data, error } = await query

    if (error) {
      if ((error as any).code === 'PGRST205' || (error as any).code === '42P01') {
        return NextResponse.json(
          {
            error: 'Table news introuvable.',
            code: SCHEMA_MISSING_CODE,
            details: "Exécutez migration_news.sql dans Supabase.",
          },
          { status: 503 }
        )
      }
      console.error('[News GET] Error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Récupérer les IDs des nouvelles déjà lues/dismissed par l'utilisateur
    const newsIds = (data || []).map(n => n.id)
    let readIds = new Set<string>()
    if (newsIds.length) {
      const { data: reads } = await supabase
        .from('user_news_reads')
        .select('news_id')
        .eq('user_id', user.id)
        .in('news_id', newsIds)
      readIds = new Set((reads || []).map(r => r.news_id))
    }

    const items = (data || []).map(n => ({
      ...n,
      is_read: readIds.has(n.id),
    }))

    return NextResponse.json({ items, unread_count: items.filter(i => !i.is_read && i.is_published).length })
  } catch (error: any) {
    console.error('[News GET] Unexpected error:', error)
    return NextResponse.json({ error: error.message || 'Erreur serveur' }, { status: 500 })
  }
}

/**
 * POST /api/news  (admin role=main)
 * Crée une nouvelle annonce.
 */
export async function POST(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })
    }
    if (user.role !== 'main') {
      return NextResponse.json({ error: 'Réservé aux comptes administrateurs' }, { status: 403 })
    }

    const body = await request.json().catch(() => ({}))
    const title = (body.title || '').trim()
    const bodyMd = (body.body_md || '').trim()

    if (!title) return NextResponse.json({ error: 'Titre requis' }, { status: 400 })
    if (!bodyMd) return NextResponse.json({ error: 'Contenu requis' }, { status: 400 })

    const slug = (body.slug || slugify(title)).trim() || slugify(title)
    const summary = typeof body.summary === 'string' ? body.summary.trim() : null
    const showInModal = body.show_in_modal === true
    const isPublished = body.is_published !== false

    const supabase = await createClient()
    const { data, error } = await supabase
      .from('news')
      .insert({
        slug,
        title,
        summary,
        body_md: bodyMd,
        show_in_modal: showInModal,
        is_published: isPublished,
        published_at: isPublished ? new Date().toISOString() : null,
        created_by: user.id,
      })
      .select('*')
      .single()

    if (error) {
      if ((error as any).code === '23505') {
        return NextResponse.json({ error: 'Slug déjà utilisé' }, { status: 409 })
      }
      console.error('[News POST] Error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ news: data })
  } catch (error: any) {
    console.error('[News POST] Unexpected error:', error)
    return NextResponse.json({ error: error.message || 'Erreur serveur' }, { status: 500 })
  }
}
