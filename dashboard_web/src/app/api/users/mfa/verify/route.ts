import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/supabase/helpers'

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    const { factorId, code } = await request.json()

    if (!factorId || !code) {
      return NextResponse.json(
        { error: 'Factor ID and code are required' },
        { status: 400 }
      )
    }

    const supabase = await createClient()

    // Vérifier le code TOTP
    const { data, error } = await supabase.auth.mfa.verify({
      factorId,
      code,
    })

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 400 }
      )
    }

    return NextResponse.json({ success: true, verified: data })
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}

