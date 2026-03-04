import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

export async function GET(request: Request) {
  const requestUrl = new URL(request.url)
  const { searchParams } = requestUrl
  const code = searchParams.get('code')
  const type = searchParams.get('type')

  const baseUrl = `${requestUrl.protocol}//${requestUrl.host}`

  if (!code) {
    if (type === 'recovery') {
      return NextResponse.redirect(`${baseUrl}/reset-password?type=recovery`)
    }
    if (type === 'signup') {
      return NextResponse.redirect(`${baseUrl}/auth/email-confirmed`)
    }
    return NextResponse.redirect(`${baseUrl}/login?message=missing_code`)
  }

  const supabase = await createClient()
  const { data, error } = await supabase.auth.exchangeCodeForSession(code)

  if (error) {
    if (type === 'recovery') {
      return NextResponse.redirect(`${baseUrl}/reset-password?error=invalid_link`)
    }
    return NextResponse.redirect(`${baseUrl}/login?message=auth_error`)
  }

  const isRecovery = type === 'recovery' ||
    (data?.session?.user?.app_metadata?.action === 'recovery') ||
    requestUrl.searchParams.has('type') && requestUrl.searchParams.get('type') === 'recovery'

  if (isRecovery) {
    return NextResponse.redirect(`${baseUrl}/reset-password?type=recovery`)
  }

  const user = data?.session?.user
  if (user) {
    const promoCodeFromMeta = user.user_metadata?.promo_code
    const pendingPlan = user.user_metadata?.pending_plan

    // Si un code promo est présent dans les métadonnées, l'appliquer automatiquement
    if (promoCodeFromMeta) {
      try {
        await applyPromoCodeOnCallback(user.id, promoCodeFromMeta)
      } catch (e) {
        console.error('[Auth Callback] Error applying promo code:', e)
      }
    } else if (pendingPlan) {
      await supabase
        .from('users')
        .update({ pending_plan: pendingPlan })
        .eq('id', user.id)
    }
  }

  return NextResponse.redirect(`${baseUrl}/dashboard`)
}

async function applyPromoCodeOnCallback(userId: string, promoCode: string) {
  const serviceSupabase = createServiceClient()

  const { data: promo, error: promoError } = await serviceSupabase
    .from('promo_codes')
    .select('*')
    .eq('code', promoCode.toUpperCase().trim())
    .single()

  if (promoError || !promo) {
    console.error('[Auth Callback] Promo code not found:', promoCode)
    return
  }

  if (!promo.is_active) {
    console.warn('[Auth Callback] Promo code is deactivated:', promoCode)
    return
  }

  if (promo.max_uses !== null && promo.current_uses >= promo.max_uses) {
    console.warn('[Auth Callback] Promo code exhausted:', promoCode)
    return
  }

  const { data: existingUser } = await serviceSupabase
    .from('users')
    .select('promo_code_id')
    .eq('id', userId)
    .single()

  if (existingUser?.promo_code_id) {
    console.log('[Auth Callback] User already has a promo code applied')
    return
  }

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
    console.error('[Auth Callback] Error updating user with promo:', updateErr)
    return
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

  // Nettoyer les métadonnées auth (promo_code et pending_plan)
  const supabase = await createClient()
  try {
    await supabase.auth.updateUser({
      data: { promo_code: null, pending_plan: null }
    })
  } catch (e) {
    console.warn('[Auth Callback] Could not clear auth metadata')
  }

  console.log('[Auth Callback] Promo code applied successfully for user:', userId)
}
