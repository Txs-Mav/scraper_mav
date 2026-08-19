import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { DEMO_GATE_CODES } from '@/lib/campaign-demo'

/**
 * POST /api/campaigns/signup
 *
 * Inscription « accès instantané » pour les campagnes flyers/QR (/c/[code]) :
 * crée le compte déjà confirmé (aucun aller-retour email) avec le plan Ultime
 * activé par le code magique. Le client enchaîne avec signInWithPassword et
 * arrive directement au dashboard.
 *
 * L'email n'est PAS vérifié dans ce flux — choix assumé pour une démo en
 * conférence. Pour revenir au flux avec confirmation, repasser par
 * /create-account?code=XXX qui garde le parcours standard.
 */
export async function POST(request: Request) {
  try {
    const { code, name, email, password } = await request.json()

    if (!code || !name?.trim() || !email?.trim() || !password) {
      return NextResponse.json(
        { error: 'Nom, email, mot de passe et code requis' },
        { status: 400 }
      )
    }
    if (password.length < 6) {
      return NextResponse.json(
        { error: 'Le mot de passe doit contenir au moins 6 caractères.' },
        { status: 400 }
      )
    }

    // Les codes de pages démo (FALARDEAU, SMSPORT…) gardent leur page mais
    // n'autorisent PAS la création d'un compte Ultime : l'accès complet est
    // envoyé manuellement au concessionnaire.
    if (DEMO_GATE_CODES.has(String(code).toUpperCase().trim())) {
      return NextResponse.json(
        { error: "Ce code n'autorise pas la création de compte." },
        { status: 403 }
      )
    }

    const serviceSupabase = createServiceClient()

    // Le code magique doit être valide — c'est lui qui autorise ce flux.
    const { data: promo, error: promoError } = await serviceSupabase
      .from('promo_codes')
      .select('*')
      .eq('code', String(code).toUpperCase().trim())
      .single()

    if (promoError || !promo || !promo.is_active) {
      return NextResponse.json(
        { error: 'Code de campagne invalide ou désactivé', code: 'INVALID_CODE' },
        { status: 400 }
      )
    }
    if (promo.max_uses !== null && promo.current_uses >= promo.max_uses) {
      return NextResponse.json(
        { error: 'Cette campagne a atteint sa limite d\'inscriptions', code: 'INVALID_CODE' },
        { status: 400 }
      )
    }

    // Compte confirmé d'office ; le trigger handle_new_user crée les lignes
    // users + subscriptions à partir des métadonnées.
    const { data: created, error: createError } = await serviceSupabase.auth.admin.createUser({
      email: email.trim().toLowerCase(),
      password,
      email_confirm: true,
      user_metadata: {
        name: name.trim(),
        subscription_plan: 'ultime',
        business_type: 'recreational_vehicles',
      },
    })

    if (createError || !created?.user) {
      const msg = createError?.message || ''
      if (msg.includes('already been registered') || msg.includes('already registered') || createError?.status === 422) {
        return NextResponse.json(
          { error: 'Un compte existe déjà avec cet email.', code: 'ACCOUNT_EXISTS' },
          { status: 409 }
        )
      }
      console.error('[Campaign Signup] createUser failed:', createError)
      return NextResponse.json(
        { error: msg || 'Erreur lors de la création du compte' },
        { status: 500 }
      )
    }

    const userId = created.user.id

    // Rattacher le code magique (même logique que le callback de confirmation).
    const { error: updateErr } = await serviceSupabase
      .from('users')
      .update({
        subscription_plan: 'ultime',
        subscription_source: 'promo',
        promo_code_id: promo.id,
        pending_plan: null,
      })
      .eq('id', userId)

    if (updateErr) {
      console.error('[Campaign Signup] Error linking promo to user:', updateErr)
    }

    await serviceSupabase
      .from('subscriptions')
      .upsert({
        user_id: userId,
        plan: 'ultime',
        status: 'active',
        started_at: new Date().toISOString(),
      }, { onConflict: 'user_id' })

    await serviceSupabase
      .from('promo_codes')
      .update({ current_uses: promo.current_uses + 1 })
      .eq('id', promo.id)

    // NB : pas besoin de marquer les « Nouveautés » comme lues ici —
    // /api/news filtre désormais les annonces publiées avant la création
    // du compte (règle globale pour tous les nouveaux inscrits).

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('[Campaign Signup] Unexpected error:', error)
    return NextResponse.json(
      { error: error.message || 'Erreur inattendue' },
      { status: 500 }
    )
  }
}
