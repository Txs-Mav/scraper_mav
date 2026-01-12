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

    // Vérifier org ownership
    const { data: org, error: orgError } = await supabase
      .from('organizations')
      .select('id')
      .eq('owner_id', user.id)
      .limit(1)

    if (orgError) {
      return NextResponse.json({ error: orgError.message }, { status: 500 })
    }
    if (!org || org.length === 0) {
      return NextResponse.json({ error: "Aucune organisation trouvée" }, { status: 400 })
    }

    const orgId = org[0].id

    // Supprimer l'organisation (cascade sur members/invitations via FK)
    const { error: delError } = await supabase
      .from('organizations')
      .delete()
      .eq('id', orgId)

    if (delError) {
      return NextResponse.json({ error: delError.message }, { status: 500 })
    }

    // Revenir au rôle user
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


