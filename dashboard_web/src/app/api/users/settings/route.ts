import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/supabase/helpers'

export async function GET() {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    const supabase = await createClient()

    // Récupérer les settings depuis user_settings (table à créer si nécessaire)
    // Pour l'instant, on retourne des valeurs par défaut
    const { data, error } = await supabase
      .from('user_settings')
      .select('*')
      .eq('user_id', user.id)
      .single()

    if (error && error.code !== 'PGRST116') {
      // Si la table n'existe pas, retourner des valeurs par défaut
      return NextResponse.json({
        language: 'fr',
        timezone: 'Europe/Paris',
        export_format: 'csv',
        notifications: { email: true, webhook: false },
        rate_limit: 10,
      })
    }

    return NextResponse.json(data || {
      language: 'fr',
      timezone: 'Europe/Paris',
      export_format: 'csv',
      notifications: { email: true, webhook: false },
      rate_limit: 10,
    })
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function PUT(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    const settings = await request.json()
    const supabase = await createClient()

    // Vérifier si user_settings existe, sinon créer
    const { data: existing } = await supabase
      .from('user_settings')
      .select('*')
      .eq('user_id', user.id)
      .single()

    if (existing) {
      const { error } = await supabase
        .from('user_settings')
        .update({
          ...settings,
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', user.id)

      if (error) {
        return NextResponse.json(
          { error: error.message },
          { status: 500 }
        )
      }
    } else {
      const { error } = await supabase
        .from('user_settings')
        .insert({
          user_id: user.id,
          ...settings,
        })

      if (error) {
        return NextResponse.json(
          { error: error.message },
          { status: 500 }
        )
      }
    }

    return NextResponse.json({ success: true })
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}

