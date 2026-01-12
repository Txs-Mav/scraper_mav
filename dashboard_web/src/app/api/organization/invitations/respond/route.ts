import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/supabase/helpers'

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    const { invitation_id, decision } = await request.json()
    if (!invitation_id || !['accepted', 'declined'].includes(decision)) {
      return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
    }

    const supabase = await createClient()

    // Récupérer l'invitation
    const { data: invite, error: inviteError } = await supabase
      .from('org_invitations')
      .select('id, org_id, email, status')
      .eq('id', invitation_id)
      .single()

    if (inviteError || !invite) {
      return NextResponse.json({ error: inviteError?.message || 'Invitation not found' }, { status: 404 })
    }

    // Vérifier que l'email correspond
    if (invite.email !== user.email) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Mettre à jour l'invitation
    const { error: updateError } = await supabase
      .from('org_invitations')
      .update({ status: decision, accepted_by: decision === 'accepted' ? user.id : null })
      .eq('id', invitation_id)

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 })
    }

    // Si acceptée, ajouter le membre
    if (decision === 'accepted') {
      await supabase
        .from('organization_members')
        .upsert({
          org_id: invite.org_id,
          user_id: user.id,
          role: 'member',
        })

      // Mettre à jour le rôle user -> member
      await supabase
        .from('users')
        .update({ role: 'member' })
        .eq('id', user.id)
    }

    return NextResponse.json({ success: true })
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}


