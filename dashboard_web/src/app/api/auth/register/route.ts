import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: Request) {
  try {
    const { name, email, password, plan = 'free' } = await request.json()

    if (!name || !email || !password) {
      return NextResponse.json(
        { error: 'Name, email, and password are required' },
        { status: 400 }
      )
    }

    const supabase = await createClient()

    // Créer le compte via Supabase Auth
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email,
      password,
    })

    if (authError) {
      return NextResponse.json(
        { error: authError.message },
        { status: 400 }
      )
    }

    if (!authData.user) {
      return NextResponse.json(
        { error: 'Failed to create user' },
        { status: 500 }
      )
    }

    // Créer l'entrée dans la table users
    const { error: userError } = await supabase.from('users').insert({
      id: authData.user.id,
      name,
      email,
      role: 'main',
      subscription_plan: plan,
    })

    if (userError) {
      // Note: En production, vous devriez utiliser la service role key pour supprimer l'utilisateur
      // Pour l'instant, on laisse l'utilisateur auth créé (il pourra être nettoyé manuellement)
      return NextResponse.json(
        { error: userError.message },
        { status: 500 }
      )
    }

    // Créer l'entrée dans la table subscriptions
    const { error: subError } = await supabase.from('subscriptions').insert({
      user_id: authData.user.id,
      plan,
      status: 'active',
    })

    if (subError) {
      return NextResponse.json(
        { error: subError.message },
        { status: 500 }
      )
    }

    // Récupérer les données utilisateur complètes
    const { data: userData, error: fetchError } = await supabase
      .from('users')
      .select('*')
      .eq('id', authData.user.id)
      .single()

    if (fetchError) {
      return NextResponse.json(
        { error: 'Failed to fetch user data' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      user: userData,
      session: authData.session,
    })
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}

