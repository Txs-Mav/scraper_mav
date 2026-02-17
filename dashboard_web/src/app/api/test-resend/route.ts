/**
 * Route de test pour vérifier que Resend fonctionne.
 * À appeler uniquement en développement.
 */
import { NextResponse } from 'next/server'
import { sendEmail } from '@/lib/resend'

export async function POST(request: Request) {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Route désactivée en production' }, { status: 403 })
  }

  try {
    const { email } = await request.json()
    if (!email || typeof email !== 'string') {
      return NextResponse.json(
        { error: 'Envoie un JSON avec { "email": "ton@email.com" }' },
        { status: 400 }
      )
    }

    await sendEmail({
      to: email,
      subject: 'Test Resend – Go-Data',
      html: '<p>Si tu reçois cet email, Resend fonctionne correctement.</p>',
    })

    return NextResponse.json({
      success: true,
      message: `Email de test envoyé à ${email}. Vérifie ta boîte (et les spams).`,
    })
  } catch (error: any) {
    console.error('[Test Resend] Error:', error)
    return NextResponse.json(
      { error: error.message || 'Erreur lors de l\'envoi' },
      { status: 500 }
    )
  }
}
