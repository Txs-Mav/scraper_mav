import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/supabase/helpers'
import { createClient } from '@/lib/supabase/server'
import { canAccessAnalytics } from '@/lib/plan-restrictions'
import {
  calculatePricePositioning,
  calculateProductAnalysis,
  calculateStats,
  type Product,
  type ScrapeMetadata
} from '@/lib/analytics-calculations'
import { sendEmail } from '@/lib/resend'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://go-data-dashboard.vercel.app'

function buildAnalyticsHtml(
  positionnement: { message: string; ecartPourcentage: number },
  produitsCount: number,
  stats: { prixMoyen: number; nombreScrapes: number }
): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Rapport Analytics Go-Data</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 24px;">
  <div style="margin-bottom: 24px;">
    <h1 style="color: #2563eb; margin: 0;">Go-Data</h1>
    <p style="color: #6b7280; margin: 4px 0 0;">Rapport Analytics</p>
  </div>
  <div style="background: #f8fafc; border-radius: 8px; padding: 20px; margin-bottom: 24px;">
    <h2 style="margin: 0 0 16px; font-size: 18px;">Résumé</h2>
    <p style="margin: 0 0 8px;"><strong>Positionnement :</strong> ${positionnement.message}</p>
    <p style="margin: 0 0 8px;"><strong>Produits analysés :</strong> ${produitsCount}</p>
    <p style="margin: 0 0 8px;"><strong>Prix moyen :</strong> ${stats.prixMoyen.toFixed(2)} $</p>
    <p style="margin: 0;"><strong>Scrapings :</strong> ${stats.nombreScrapes}</p>
  </div>
  <p>
    <a href="${APP_URL}/dashboard/analytics" style="display: inline-block; background: #2563eb; color: white; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-weight: 500;">
      Voir le dashboard complet
    </a>
  </p>
  <p style="color: #6b7280; font-size: 14px; margin-top: 32px;">
    Cet email a été envoyé par Go-Data. Pour ne plus recevoir ces rapports, modifiez vos paramètres de notification dans le dashboard.
  </p>
</body>
</html>
  `.trim()
}

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    const effectiveSource = user.subscription_source || (user.promo_code_id ? 'promo' as const : null)
    if (!canAccessAnalytics(user.subscription_plan ?? 'standard', effectiveSource)) {
      return NextResponse.json(
        { error: 'Accès réservé aux plans Pro et Ultime' },
        { status: 403 }
      )
    }

    const { email } = await request.json()
    const recipientEmail = email || user.email

    if (!recipientEmail) {
      return NextResponse.json(
        { error: 'Email is required' },
        { status: 400 }
      )
    }

    // Charger les données analytics
    let products: Product[] = []
    let metadata: ScrapeMetadata = {}
    const supabase = await createClient()
    const { data: scrapings } = await supabase
      .from('scrapings')
      .select('products, metadata, reference_url')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(1)

    const { count: scrapesCount } = await supabase
      .from('scrapings')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)

    if (scrapings?.[0]) {
      products = scrapings[0].products || []
      metadata = {
        ...(scrapings[0].metadata || {}),
        reference_url: scrapings[0].reference_url || scrapings[0].metadata?.reference_url,
      }
    }

    let referenceDomain = 'unknown'
    try {
      const refUrl = metadata.reference_url || products[0]?.sourceSite
      if (refUrl) {
        referenceDomain = refUrl.startsWith('http') ? new URL(refUrl).hostname : refUrl
      }
    } catch {
      referenceDomain = 'unknown'
    }

    const positionnement = calculatePricePositioning(products, referenceDomain)
    const produits = calculateProductAnalysis(products, referenceDomain)
    const stats = calculateStats(products, [], scrapesCount ?? 0)

    const html = buildAnalyticsHtml(
      { message: positionnement.message, ecartPourcentage: positionnement.ecartPourcentage },
      produits.length,
      stats
    )

    await sendEmail({
      to: recipientEmail,
      subject: 'Rapport Analytics Go-Data',
      html,
    })

    return NextResponse.json({
      success: true,
      message: 'Analytics envoyés par email avec succès',
    })
  } catch (error: unknown) {
    console.error('[Analytics Email] Error:', error)
    const message = error instanceof Error ? error.message : 'Internal server error'
    return NextResponse.json(
      { error: message },
      { status: 500 }
    )
  }
}

