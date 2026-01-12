import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import Stripe from 'stripe'
import { headers } from 'next/headers'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2024-11-20.acacia',
})

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!

export async function POST(request: Request) {
  try {
    const body = await request.text()
    const headersList = await headers()
    const signature = headersList.get('stripe-signature')

    if (!signature) {
      return NextResponse.json(
        { error: 'No signature' },
        { status: 400 }
      )
    }

    let event: Stripe.Event

    try {
      event = stripe.webhooks.constructEvent(body, signature, webhookSecret)
    } catch (err: any) {
      return NextResponse.json(
        { error: `Webhook signature verification failed: ${err.message}` },
        { status: 400 }
      )
    }

    const supabase = await createClient()

    // Gérer les différents types d'événements
    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription
        const customerId = subscription.customer as string

        // Trouver l'utilisateur par stripe_customer_id
        const { data: user } = await supabase
          .from('users')
          .select('id')
          .eq('stripe_customer_id', customerId)
          .single()

        if (user) {
          // Déterminer le plan depuis le prix
          const priceId = subscription.items.data[0]?.price.id
          let plan = 'free'
          // TODO: Mapper les price IDs Stripe aux plans
          if (priceId?.includes('standard')) plan = 'standard'
          if (priceId?.includes('premium')) plan = 'premium'

          // Mettre à jour l'abonnement
          await supabase
            .from('users')
            .update({ subscription_plan: plan })
            .eq('id', user.id)

          await supabase
            .from('subscriptions')
            .upsert({
              user_id: user.id,
              plan,
              status: subscription.status === 'active' ? 'active' : 'cancelled',
              started_at: new Date(subscription.current_period_start * 1000).toISOString(),
              expires_at: subscription.current_period_end
                ? new Date(subscription.current_period_end * 1000).toISOString()
                : null,
            }, {
              onConflict: 'user_id',
            })
        }
        break
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription
        const customerId = subscription.customer as string

        const { data: user } = await supabase
          .from('users')
          .select('id')
          .eq('stripe_customer_id', customerId)
          .single()

        if (user) {
          await supabase
            .from('users')
            .update({ subscription_plan: 'free' })
            .eq('id', user.id)

          await supabase
            .from('subscriptions')
            .update({ status: 'cancelled' })
            .eq('user_id', user.id)
        }
        break
      }

      case 'invoice.paid':
      case 'invoice.payment_failed': {
        // Logique pour gérer les paiements
        // TODO: Mettre à jour le statut de l'abonnement si nécessaire
        break
      }
    }

    return NextResponse.json({ received: true })
  } catch (error: any) {
    console.error('Webhook error:', error)
    return NextResponse.json(
      { error: error.message || 'Webhook handler failed' },
      { status: 500 }
    )
  }
}

