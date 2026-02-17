import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/supabase/helpers'
import { createClient } from '@/lib/supabase/server'
import Stripe from 'stripe'

export async function POST(request: Request) {
  try {
    // Vérifier que Stripe est configuré
    if (!process.env.STRIPE_SECRET_KEY) {
      return NextResponse.json(
        { error: 'Stripe is not configured. Please set STRIPE_SECRET_KEY in your environment variables.' },
        { status: 500 }
      )
    }

    // Initialiser Stripe seulement si la clé est présente
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: '2025-12-15.clover',
    })

    const { plan, email: providedEmail, promo_code: providedPromoCode, cancel_url, success_url } = await request.json()

    // Si un email est fourni (création de compte), on peut créer une session sans authentification
    // Sinon, l'utilisateur doit être authentifié
    let user = await getCurrentUser()
    let userEmail = user?.email
    let userId = user?.id

    // Si pas d'utilisateur mais email fourni (création de compte)
    if (!user && providedEmail) {
      userEmail = providedEmail
      // On va créer un customer Stripe avec cet email
      // Le user_id sera mis à jour après la confirmation du compte
    } else if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    if (!plan) {
      return NextResponse.json(
        { error: 'Plan is required' },
        { status: 400 }
      )
    }

    // Plan gratuit - pas de paiement Stripe nécessaire
    if (plan === 'standard') {
      return NextResponse.json(
        { error: 'Standard plan is free and does not require payment' },
        { status: 400 }
      )
    }

    // Mapping des plans aux price IDs Stripe
    const planPriceIds: Record<string, string> = {
      pro: process.env.STRIPE_PRICE_ID_PRO || '',
      ultime: process.env.STRIPE_PRICE_ID_ULTIME || '',
    }

    const priceId = planPriceIds[plan]

    if (!priceId) {
      return NextResponse.json(
        { error: `Price ID not configured for plan: ${plan}` },
        { status: 400 }
      )
    }

    const supabase = await createClient()

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
    const finalSuccessUrl = success_url || `${baseUrl}/dashboard?payment=success`
    const finalCancelUrl = cancel_url || `${baseUrl}/create-account?payment=canceled`

    // Vérifier si l'utilisateur a un code promo (DB ou fourni dans la requête)
    const promoCodeToCheck = providedPromoCode || (user?.promo_code_id ? 'from_db' : null)

    if (user && promoCodeToCheck) {
      let promoCode: { id: string; is_active: boolean; code: string; max_uses: number | null; current_uses: number } | null = null

      if (providedPromoCode && typeof providedPromoCode === 'string') {
        const { data: pc } = await supabase
          .from('promo_codes')
          .select('id, is_active, code, max_uses, current_uses')
          .eq('code', providedPromoCode.toUpperCase().trim())
          .single()
        promoCode = pc
      } else if (user.promo_code_id) {
        const { data: pc } = await supabase
          .from('promo_codes')
          .select('id, is_active, code, max_uses, current_uses')
          .eq('id', user.promo_code_id)
          .single()
        promoCode = pc
      }

      if (promoCode && promoCode.is_active) {
        if (promoCode.max_uses !== null && promoCode.current_uses >= promoCode.max_uses) {
          // Code épuisé, continuer vers Stripe
        } else if (!user.promo_code_id && providedPromoCode) {
          // Appliquer le code promo (100% rabais)
          await supabase
            .from('users')
            .update({
              subscription_plan: plan,
              promo_code_id: promoCode.id,
              subscription_source: 'promo',
            })
            .eq('id', user.id)

          await supabase
            .from('promo_codes')
            .update({ current_uses: promoCode.current_uses + 1 })
            .eq('id', promoCode.id)

          await supabase
            .from('subscriptions')
            .upsert({
              user_id: user.id,
              plan: plan,
              status: 'active',
              started_at: new Date().toISOString(),
            }, { onConflict: 'user_id' })

          return NextResponse.json({
            url: `${finalSuccessUrl}${finalSuccessUrl.includes('?') ? '&' : '?'}promo=true`,
            promo_applied: true,
          })
        } else if (user.promo_code_id) {
          // Code déjà appliqué en DB
          await supabase
            .from('users')
            .update({ subscription_plan: plan, subscription_source: 'promo' })
            .eq('id', user.id)

          await supabase
            .from('subscriptions')
            .upsert({
              user_id: user.id,
              plan: plan,
              status: 'active',
              started_at: new Date().toISOString(),
            }, { onConflict: 'user_id' })

          return NextResponse.json({
            url: `${finalSuccessUrl}${finalSuccessUrl.includes('?') ? '&' : '?'}promo=true`,
            promo_applied: true,
          })
        }
      } else if (user.promo_code_id && (!promoCode || !promoCode.is_active)) {
        // Le code promo a été désactivé, retirer le code promo de l'utilisateur
        await supabase
          .from('users')
          .update({
            promo_code_id: null,
            subscription_plan: 'standard',
            subscription_source: null,
          })
          .eq('id', user.id)

        await supabase
          .from('subscriptions')
          .update({ plan: 'standard' })
          .eq('user_id', user.id)
      }
    }

    // Récupérer ou créer le customer Stripe
    let customerId: string | undefined

    if (user) {
      customerId = user.stripe_customer_id ?? undefined
    }

    if (!customerId) {
      // Créer un nouveau customer Stripe
      const customer = await stripe.customers.create({
        email: userEmail!,
        metadata: {
          user_id: userId || 'pending',
          email: userEmail!,
        },
      })

      customerId = customer.id

      // Sauvegarder le customer ID dans la DB si l'utilisateur existe
      if (user && userId) {
        await supabase
          .from('users')
          .update({ stripe_customer_id: customerId })
          .eq('id', userId)
      }
    }

    // Vérifier si l'utilisateur a déjà un abonnement actif
    const subscriptions = await stripe.subscriptions.list({
      customer: customerId,
      status: 'active',
      limit: 1,
    })

    const activeSubscription = subscriptions.data[0]

    // Configuration de la session Checkout
    const sessionConfig: Stripe.Checkout.SessionCreateParams = {
      customer: customerId,
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      metadata: {
        plan: plan,
        user_id: userId || 'pending',
        email: userEmail!,
      },
      success_url: finalSuccessUrl,
      cancel_url: finalCancelUrl,
    }

    // Si l'utilisateur a déjà un abonnement actif, configurer la mise à jour
    if (activeSubscription) {
      // Utiliser subscription_data pour mettre à jour l'abonnement existant
      sessionConfig.subscription_data = {
        metadata: {
          plan: plan,
          user_id: userId || 'pending',
          email: userEmail!,
        },
      }
      // Stripe gérera automatiquement la mise à jour de l'abonnement
      // en remplaçant l'ancien plan par le nouveau
    }

    // Créer une session Checkout
    const session = await stripe.checkout.sessions.create(sessionConfig)

    return NextResponse.json({ url: session.url })
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}

