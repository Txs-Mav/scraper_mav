import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/supabase/helpers'

export async function PUT(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    const { name, email, avatar_url } = await request.json()

    const supabase = await createClient()

    // Mettre à jour dans auth.users si email change
    if (email && email !== user.email) {
      const { error: updateError } = await supabase.auth.updateUser({ email })
      if (updateError) {
        return NextResponse.json(
          { error: updateError.message },
          { status: 400 }
        )
      }
    }

    // Mettre à jour dans la table users
    const updates: any = {}
    if (name) updates.name = name
    if (email) updates.email = email
    if (avatar_url !== undefined) updates.avatar_url = avatar_url

    if (Object.keys(updates).length > 0) {
      const { error: userError } = await supabase
        .from('users')
        .update(updates)
        .eq('id', user.id)

      if (userError) {
        return NextResponse.json(
          { error: userError.message },
          { status: 500 }
        )
      }
    }

    // Récupérer l'utilisateur mis à jour
    const { data: updatedUser, error: fetchError } = await supabase
      .from('users')
      .select('*')
      .eq('id', user.id)
      .single()

    if (fetchError) {
      return NextResponse.json(
        { error: 'Failed to fetch updated user' },
        { status: 500 }
      )
    }

    return NextResponse.json({ user: updatedUser })
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}

