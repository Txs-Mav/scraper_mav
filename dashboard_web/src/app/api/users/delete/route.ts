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

    let password: string | undefined
    try {
      const body = await request.json()
      password = body?.password
    } catch {
      return NextResponse.json(
        { error: 'Invalid request body - JSON expected with password field' },
        { status: 400 }
      )
    }

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

    // Supprimer les données applicatives dans l'ordre (FK constraints)
    // 0. alert_changes référence scraper_alerts, scraper_alerts référence scraper_cache
    try {
      await serviceSupabase.from('alert_changes').delete().eq('user_id', user.id)
      await serviceSupabase.from('scraper_alerts').delete().eq('user_id', user.id)
    } catch { /* tables peuvent ne pas exister */ }

    // 1. Tables qui référencent scraper_cache ET users
    await serviceSupabase
      .from('scraper_shares')
      .delete()
      .or(`owner_user_id.eq.${user.id},target_user_id.eq.${user.id}`)
    await serviceSupabase
      .from('scraping_results')
      .delete()
      .eq('user_id', user.id)

    // 2. scraper_cache (référence users)
    await serviceSupabase.from('scraper_cache').delete().eq('user_id', user.id)

    // 3. scraper_config si la table existe
    try {
      await serviceSupabase.from('scraper_config').delete().eq('user_id', user.id)
    } catch {
      /* table peut ne pas exister */
    }

    // 4. Organizations : retirer l'utilisateur des orgs, puis supprimer les orgs dont il est owner
    await serviceSupabase.from('organization_members').delete().eq('user_id', user.id)
    await serviceSupabase.from('org_invitations').delete().eq('accepted_by', user.id)
    const { data: ownedOrgs } = await serviceSupabase
      .from('organizations')
      .select('id')
      .eq('owner_id', user.id)
    if (ownedOrgs?.length) {
      for (const org of ownedOrgs) {
        await serviceSupabase.from('organization_members').delete().eq('org_id', org.id)
        await serviceSupabase.from('org_invitations').delete().eq('org_id', org.id)
      }
      await serviceSupabase.from('organizations').delete().eq('owner_id', user.id)
    }

    // 5. employees, user_roles
    await serviceSupabase.from('employees').delete().or(`main_account_id.eq.${user.id},employee_id.eq.${user.id}`)
    await serviceSupabase.from('user_roles').delete().eq('user_id', user.id)

    // 6. Tables principales
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
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error'
    console.error('[DELETE /api/users/delete]', error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

