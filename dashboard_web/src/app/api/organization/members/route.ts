import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/supabase/helpers'

// Ajouter un membre existant à l'organisation (owner seulement, plan premium)
export async function POST(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    const { employee_id } = await request.json()
    if (!employee_id) {
      return NextResponse.json({ error: 'employee_id is required' }, { status: 400 })
    }

    // Only premium can inviter/ajouter
    if (user.subscription_plan !== 'premium') {
      return NextResponse.json({ error: 'Premium requis pour ajouter des membres' }, { status: 403 })
    }

    const supabase = await createClient()

    // Vérifier que l'utilisateur est owner d'une org
    const { data: ownerOrg, error: orgError } = await supabase
      .from('organizations')
      .select('id')
      .eq('owner_id', user.id)
      .limit(1)

    if (orgError) {
      return NextResponse.json({ error: orgError.message }, { status: 500 })
    }
    if (!ownerOrg || ownerOrg.length === 0) {
      return NextResponse.json({ error: 'Créez d’abord votre organisation' }, { status: 400 })
    }

    // Ajouter le membre
    const { error: insertError } = await supabase
      .from('organization_members')
      .upsert({
        org_id: ownerOrg[0].id,
        user_id: employee_id,
        role: 'member',
      })

    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 500 })
    }

    // Mettre à jour le rôle du membre (member)
    await supabase
      .from('users')
      .update({ role: 'member' })
      .eq('id', employee_id)

    return NextResponse.json({ success: true })
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}

// Retirer un membre
export async function DELETE(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const memberId = searchParams.get('member_id')
    if (!memberId) {
      return NextResponse.json({ error: 'member_id is required' }, { status: 400 })
    }

    if (user.subscription_plan !== 'premium') {
      return NextResponse.json({ error: 'Premium requis pour gérer les membres' }, { status: 403 })
    }

    const supabase = await createClient()

    const { data: ownerOrg, error: orgError } = await supabase
      .from('organizations')
      .select('id')
      .eq('owner_id', user.id)
      .limit(1)

    if (orgError) {
      return NextResponse.json({ error: orgError.message }, { status: 500 })
    }
    if (!ownerOrg || ownerOrg.length === 0) {
      return NextResponse.json({ error: 'Aucune organisation' }, { status: 400 })
    }

    const { error: deleteError } = await supabase
      .from('organization_members')
      .delete()
      .eq('org_id', ownerOrg[0].id)
      .eq('user_id', memberId)

    if (deleteError) {
      return NextResponse.json({ error: deleteError.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}

