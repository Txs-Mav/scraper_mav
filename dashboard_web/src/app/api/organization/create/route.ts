import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/supabase/helpers'

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    const { name } = await request.json()
    if (!name || !name.trim()) {
      return NextResponse.json({ error: 'Organization name is required' }, { status: 400 })
    }

    const supabase = await createClient()

    // Vérifier si l'utilisateur a déjà une organisation
    const { data: existingOrg, error: existingError } = await supabase
      .from('organization_members')
      .select('org_id')
      .eq('user_id', user.id)
      .limit(1)

    if (existingError) {
      return NextResponse.json({ error: existingError.message }, { status: 500 })
    }
    if (existingOrg && existingOrg.length > 0) {
      return NextResponse.json({ error: 'Vous avez déjà une organisation' }, { status: 400 })
    }

    // Créer l'organisation
    const { data: org, error: orgError } = await supabase
      .from('organizations')
      .insert({
        name: name.trim(),
        owner_id: user.id,
      })
      .select()
      .single()

    if (orgError || !org) {
      return NextResponse.json({ error: orgError?.message || 'Failed to create organization' }, { status: 500 })
    }

    // Passer l'utilisateur en owner
    await supabase
      .from('users')
      .update({ role: 'owner' })
      .eq('id', user.id)

    // Ajouter l'owner comme membre owner
    const { error: memberError } = await supabase
      .from('organization_members')
      .insert({
        org_id: org.id,
        user_id: user.id,
        role: 'owner',
      })

    if (memberError) {
      return NextResponse.json({ error: memberError.message }, { status: 500 })
    }

    return NextResponse.json({ org })
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}


