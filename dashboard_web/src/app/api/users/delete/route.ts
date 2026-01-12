import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

export async function DELETE(request: Request) {
  try {
    // Récupérer le token d'accès fourni par le client (Authorization: Bearer <token>)
    const authHeader = request.headers.get('authorization') || ''
    const token = authHeader.toLowerCase().startsWith('bearer ')
      ? authHeader.slice(7)
      : null

    const { password } = await request.json()

    if (!password) {
      return NextResponse.json(
        { error: 'Password is required' },
        { status: 400 }
      )
    }

    const supabase = await createClient()
    const serviceSupabase = createServiceClient()

    // Identifier l'utilisateur à partir du token fourni
    if (!token) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    const { data: userData, error: userFromTokenError } = await serviceSupabase.auth.getUser(token)
    if (userFromTokenError || !userData?.user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    const user = userData.user

    // Vérifier le mot de passe
    const { error: verifyError } = await supabase.auth.signInWithPassword({
      email: user.email!,
      password,
    })

    if (verifyError) {
      return NextResponse.json(
        { error: 'Password is incorrect' },
        { status: 401 }
      )
    }

    // TODO: Annuler les abonnements Stripe actifs si applicable

    // Supprimer les données applicatives (service role, RLS bypass)
    const deletes = await Promise.allSettled([
      serviceSupabase.from('scrapings').delete().eq('user_id', user.id),
      serviceSupabase.from('user_settings').delete().eq('user_id', user.id),
      serviceSupabase.from('webhooks').delete().eq('user_id', user.id),
      serviceSupabase.from('subscriptions').delete().eq('user_id', user.id),
    ])

    // Supprimer la ligne dans users
    const { error: userDeleteError } = await serviceSupabase
      .from('users')
      .delete()
      .eq('id', user.id)

    if (userDeleteError) {
      return NextResponse.json(
        { error: userDeleteError.message },
        { status: 500 }
      )
    }

    // Supprimer l'utilisateur Auth
    const { error: authDeleteError } = await serviceSupabase.auth.admin.deleteUser(user.id)
    if (authDeleteError) {
      return NextResponse.json(
        { error: authDeleteError.message || 'Failed to delete auth user' },
        { status: 500 }
      )
    }

    // Déconnexion côté session courante
    await supabase.auth.signOut()

    return NextResponse.json({ success: true, deletes })
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}

