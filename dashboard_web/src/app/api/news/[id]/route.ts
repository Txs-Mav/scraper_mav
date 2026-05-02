import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/supabase/helpers'
import { isDevAdminUser } from '@/lib/auth/admin'

/**
 * GET /api/news/[id] - récupérer une nouvelle par ID (ou slug).
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })
    }

    const { id } = await params
    const supabase = await createClient()

    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
    const column = isUuid ? 'id' : 'slug'

    const { data, error } = await supabase
      .from('news')
      .select('*')
      .eq(column, id)
      .maybeSingle()

    if (error) {
      console.error('[News id GET] Error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    if (!data) {
      return NextResponse.json({ error: 'Introuvable' }, { status: 404 })
    }
    if (!data.is_published && !isDevAdminUser(user)) {
      return NextResponse.json({ error: 'Introuvable' }, { status: 404 })
    }

    return NextResponse.json({ news: data })
  } catch (error: any) {
    console.error('[News id GET] Unexpected error:', error)
    return NextResponse.json({ error: error.message || 'Erreur serveur' }, { status: 500 })
  }
}

/**
 * PUT /api/news/[id]  (admin role=main)
 * Met à jour une nouvelle.
 */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })
    }
    if (!isDevAdminUser(user)) {
      return NextResponse.json({ error: 'Réservé au compte dev admin' }, { status: 403 })
    }

    const { id } = await params
    const body = await request.json().catch(() => ({}))

    const updates: Record<string, any> = {}
    if (body.title !== undefined) {
      const v = String(body.title).trim()
      if (!v) return NextResponse.json({ error: 'Titre requis' }, { status: 400 })
      updates.title = v
    }
    if (body.slug !== undefined) updates.slug = String(body.slug).trim()
    if (body.summary !== undefined) updates.summary = body.summary ? String(body.summary).trim() : null
    if (body.body_md !== undefined) {
      const v = String(body.body_md).trim()
      if (!v) return NextResponse.json({ error: 'Contenu requis' }, { status: 400 })
      updates.body_md = v
    }
    if (body.show_in_modal !== undefined) updates.show_in_modal = !!body.show_in_modal
    if (body.is_published !== undefined) {
      const pub = !!body.is_published
      updates.is_published = pub
      if (pub && !body.published_at) {
        updates.published_at = new Date().toISOString()
      }
    }
    if (body.published_at !== undefined && body.published_at !== null) {
      updates.published_at = body.published_at
    }

    // Si la nouvelle est republiée avec show_in_modal, on réinitialise les lectures
    // pour que tout le monde la revoie.
    const resetReads = body.reset_reads === true

    if (Object.keys(updates).length === 0 && !resetReads) {
      return NextResponse.json({ error: 'Aucun champ à mettre à jour' }, { status: 400 })
    }

    const supabase = await createClient()

    if (Object.keys(updates).length > 0) {
      const { error } = await supabase
        .from('news')
        .update(updates)
        .eq('id', id)
      if (error) {
        if ((error as any).code === '23505') {
          return NextResponse.json({ error: 'Slug déjà utilisé' }, { status: 409 })
        }
        console.error('[News PUT] Error:', error)
        return NextResponse.json({ error: error.message }, { status: 500 })
      }
    }

    if (resetReads) {
      const { error: delErr } = await supabase
        .from('user_news_reads')
        .delete()
        .eq('news_id', id)
      if (delErr) {
        console.error('[News PUT reset_reads] Error:', delErr)
      }
    }

    const { data } = await supabase.from('news').select('*').eq('id', id).single()
    return NextResponse.json({ news: data })
  } catch (error: any) {
    console.error('[News PUT] Unexpected error:', error)
    return NextResponse.json({ error: error.message || 'Erreur serveur' }, { status: 500 })
  }
}

/**
 * DELETE /api/news/[id]  (admin role=main)
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })
    }
    if (!isDevAdminUser(user)) {
      return NextResponse.json({ error: 'Réservé au compte dev admin' }, { status: 403 })
    }

    const { id } = await params
    const supabase = await createClient()
    const { error } = await supabase.from('news').delete().eq('id', id)
    if (error) {
      console.error('[News DELETE] Error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('[News DELETE] Unexpected error:', error)
    return NextResponse.json({ error: error.message || 'Erreur serveur' }, { status: 500 })
  }
}
