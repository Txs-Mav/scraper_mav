import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/supabase/helpers'
import {
  BUSINESS_TYPES,
  parseBusinessTypes,
  serializeBusinessTypes,
  type BusinessType,
} from '@/lib/account-navigation'

export async function PUT(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    const body = await request.json()
    const { name, email, avatar_url, business_type, business_types } = body

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

    // business_type (mono) ou business_types (array) — on accepte les deux.
    // Stocké en DB sous forme de string comma-separated dans `business_type`.
    const btInput =
      business_types !== undefined
        ? business_types
        : business_type !== undefined
          ? business_type
          : undefined

    if (btInput !== undefined) {
      const parsed = parseBusinessTypes(btInput)
      // Une demande explicite avec des valeurs entièrement invalides est une
      // erreur — sinon (array vide intentionnellement) on accepte le reset.
      if (
        parsed.length === 0 &&
        (Array.isArray(btInput) ? btInput.length > 0 : String(btInput).trim() !== '')
      ) {
        return NextResponse.json(
          { error: `business_type invalide. Valeurs acceptées : ${BUSINESS_TYPES.join(', ')}` },
          { status: 400 }
        )
      }
      updates.business_type = serializeBusinessTypes(parsed as BusinessType[])
    }

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

