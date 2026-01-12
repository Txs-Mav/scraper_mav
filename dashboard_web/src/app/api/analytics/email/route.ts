import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/supabase/helpers'

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    const { email } = await request.json()

    if (!email) {
      return NextResponse.json(
        { error: 'Email is required' },
        { status: 400 }
      )
    }

    // TODO: Intégrer Resend pour envoyer l'email avec le PDF
    // Pour l'instant, on simule
    console.log(`Sending analytics PDF to ${email} for user ${user.id}`)

    // TODO: Générer le PDF des analytics
    // TODO: Envoyer via Resend
    // TODO: Logger l'action (user_id, période, destinataire)

    return NextResponse.json({
      success: true,
      message: 'Analytics envoyés par email avec succès',
    })
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}

