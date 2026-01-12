import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/supabase/helpers'

export async function GET() {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    const supabase = await createClient()

    // Récupérer les facteurs MFA de l'utilisateur
    const { data, error } = await supabase.auth.mfa.listFactors()

    if (error) {
      // Si MFA n'est pas activé, retourner enabled: false
      return NextResponse.json({
        enabled: false,
        factors: [],
      })
    }

    const totpFactors = data?.totp || []
    const enabled = totpFactors.length > 0 && totpFactors.some((f: any) => f.status === 'verified')

    return NextResponse.json({
      enabled,
      factors: totpFactors,
    })
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}

