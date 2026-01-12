import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/supabase/helpers'

type UserNode = {
  id: string
  name: string | null
  email: string
  role: string
  avatar_url: string | null
  scraper_count: number
  cache_count: number
  quota_used: number | null
  quota_limit: number | null
  children: UserNode[]
}

export async function GET() {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    const supabase = await createClient()

    // Trouver une organisation où l'utilisateur est membre
    const { data: memberships, error: memError } = await supabase
      .from('organization_members')
      .select('org_id, role')
      .eq('user_id', user.id)
      .limit(1)

    if (memError) {
      return NextResponse.json({ error: memError.message }, { status: 500 })
    }

    if (!memberships || memberships.length === 0) {
      return NextResponse.json({ org: null, tree: [], stats: { total_users: 0, total_scrapers: 0 } })
    }

    const orgId = memberships[0].org_id

    const { data: orgData, error: orgError } = await supabase
      .from('organizations')
      .select('id,name,owner_id')
      .eq('id', orgId)
      .single()

    if (orgError || !orgData) {
      return NextResponse.json({ error: orgError?.message || 'Organization not found' }, { status: 500 })
    }

    const { data: members, error: membersError } = await supabase
      .from('organization_members')
      .select('role, users(id,name,email,avatar_url)')
      .eq('org_id', orgId)

    if (membersError || !members) {
      return NextResponse.json({ error: membersError?.message || 'Failed to load members' }, { status: 500 })
    }

    // users peut être un objet ou un tableau selon Supabase, on gère les deux cas
    const memberIds = members
      .map(m => {
        const user = Array.isArray(m.users) ? m.users[0] : m.users
        return user?.id
      })
      .filter(Boolean) as string[]
    let cacheCounts: Record<string, number> = {}
    if (memberIds.length > 0) {
      const { data: caches, error: cacheError } = await supabase
        .from('scraper_cache')
        .select('user_id')
        .in('user_id', memberIds)
      if (cacheError) {
        return NextResponse.json({ error: cacheError.message || 'Failed to load scrapers' }, { status: 500 })
      }
      cacheCounts = (caches || []).reduce<Record<string, number>>((acc, row) => {
        acc[row.user_id] = (acc[row.user_id] || 0) + 1
        return acc
      }, {})
    }

    const nodes: UserNode[] = members.map(m => {
      const user = Array.isArray(m.users) ? m.users[0] : m.users
      return {
        id: user?.id || '',
        name: user?.name || null,
        email: user?.email || '',
        role: m.role,
        avatar_url: user?.avatar_url || null,
        scraper_count: cacheCounts[user?.id || ''] || 0,
        cache_count: cacheCounts[user?.id || ''] || 0,
        quota_used: null,
        quota_limit: null,
        children: [],
      }
    })

    const ownerNode = nodes.find(n => n.id === orgData.owner_id)
    const childNodes = nodes.filter(n => n.id !== orgData.owner_id)
    const tree: UserNode[] = ownerNode
      ? [{ ...ownerNode, children: childNodes }]
      : childNodes

    return NextResponse.json({
      org: orgData,
      tree,
      stats: {
        total_users: nodes.length,
        total_scrapers: Object.values(cacheCounts).reduce((a, b) => a + b, 0),
      },
    })
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}


