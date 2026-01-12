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

    // Membres de l'organisation (owner + employés liés)
    const { data: members, error: membersError } = await supabase
      .from('users')
      .select('id,name,email,role,main_account_id,avatar_url')

    if (membersError || !members) {
      return NextResponse.json(
        { error: membersError?.message || 'Failed to load members' },
        { status: 500 }
      )
    }

    // Scrapers visibles par l'utilisateur courant (ses scrapers)
    const { data: scrapers, error: scrapersError } = await supabase
      .from('scraper_cache')
      .select('id,site_url,cache_key,updated_at')
      .eq('user_id', user.id)

    if (scrapersError) {
      return NextResponse.json(
        { error: scrapersError.message || 'Failed to load scrapers' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      members,
      scrapers: scrapers || [],
    })
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}


