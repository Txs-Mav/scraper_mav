import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { getCurrentUser } from '@/lib/supabase/helpers'

export async function PATCH(request: Request) {
    try {
        const body = await request.json()
        const { user_id, cache_key, product_urls } = body

        // Vérifier l'authentification
        // Si user_id est fourni (appel depuis Python), l'utiliser directement
        // Sinon, vérifier via getCurrentUser() (appel depuis le frontend)
        let userId: string | null = null
        let isPythonCall = false

        if (user_id) {
            // Appel depuis le script Python - utiliser user_id fourni
            userId = user_id
            isPythonCall = true
        } else {
            // Appel depuis le frontend - vérifier via session
            const user = await getCurrentUser()
            if (!user) {
                return NextResponse.json(
                    { error: 'Not authenticated' },
                    { status: 401 }
                )
            }
            userId = user.id
        }

        if (!cache_key || !product_urls) {
            return NextResponse.json(
                { error: 'Missing required fields: cache_key, product_urls' },
                { status: 400 }
            )
        }

        // Pour les appels Python, utiliser le service role pour bypasser RLS
        // Pour les appels frontend, utiliser le client avec session
        let supabase
        if (isPythonCall && process.env.SUPABASE_SERVICE_ROLE_KEY) {
            supabase = createServiceClient(
                process.env.NEXT_PUBLIC_SUPABASE_URL!,
                process.env.SUPABASE_SERVICE_ROLE_KEY
            )
        } else {
            supabase = await createClient()
        }

        // Mettre à jour uniquement les URLs des produits
        const { data, error } = await supabase
            .from('scraper_cache')
            .update({
                product_urls: product_urls,
                updated_at: new Date().toISOString(),
            })
            .eq('user_id', userId)
            .eq('cache_key', cache_key)
            .select('id, cache_key')
            .single()

        if (error) {
            if (error.code === 'PGRST116') {
                return NextResponse.json(
                    { error: 'Scraper not found' },
                    { status: 404 }
                )
            }
            return NextResponse.json(
                { error: error.message },
                { status: 500 }
            )
        }

        return NextResponse.json({
            success: true,
            cache_key: data.cache_key,
            product_urls_count: product_urls.length,
            message: 'Product URLs updated'
        })
    } catch (error: any) {
        console.error('Error updating scraper URLs:', error)
        return NextResponse.json(
            { error: error.message || 'Internal server error' },
            { status: 500 }
        )
    }
}
