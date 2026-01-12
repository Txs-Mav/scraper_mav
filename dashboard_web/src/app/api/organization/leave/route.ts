import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/supabase/helpers'

export async function POST() {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    const supabase = await createClient()

    // Trouver l'org où il est membre
    const { data: memberships, error: memError } = await supabase
      .from('organization_members')
      .select('org_id, role')
      .eq('user_id', user.id)
      .limit(1)

    if (memError) {
      return NextResponse.json({ error: memError.message }, { status: 500 })
    }

    if (!memberships || memberships.length === 0) {
      return NextResponse.json({ success: true }) // Pas d'org à quitter
    }

    // Si owner unique : empêcher la sortie sans transfert de propriété (simple check)
    const { data: ownerOrg } = await supabase
      .from('organizations')
      .select('id')
      .eq('owner_id', user.id)
      .eq('id', memberships[0].org_id)
      .limit(1)

    if (ownerOrg && ownerOrg.length > 0) {
      return NextResponse.json(
        { error: "Le propriétaire ne peut pas quitter sans transférer l'organisation" },
        { status: 400 }
      )
    }

    // Supprimer le membership
    const { error: delError } = await supabase
      .from('organization_members')
      .delete()
      .eq('org_id', memberships[0].org_id)
      .eq('user_id', user.id)

    if (delError) {
      return NextResponse.json({ error: delError.message }, { status: 500 })
    }

    // Revenir au rôle "user"
    await supabase
      .from('users')
      .update({ role: 'user' })
      .eq('id', user.id)

    return NextResponse.json({ success: true })
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}


