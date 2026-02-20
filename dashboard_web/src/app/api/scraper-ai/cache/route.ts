import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/supabase/helpers'

const CACHE_DIR = path.join(process.cwd(), '..', 'scraper_cache')

export async function GET() {
  try {
    const user = await getCurrentUser()
    
    // Si utilisateur connecté, charger depuis Supabase
    if (user) {
      const supabase = await createClient()
      
      const { data, error } = await supabase
        .from('scraper_cache')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
      
      if (error) {
        console.error('Error loading from Supabase:', error)
        // Fallback sur local
      } else if (data) {
        const scrapers = data.map(item => {
          // Vérifier si le cache est expiré
          const isExpired = item.expires_at && new Date(item.expires_at) < new Date()
          const status = isExpired ? 'expired' : (item.status || 'active')
          
          return {
            id: item.id,
            cacheKey: item.cache_key,
            url: item.site_url,
            siteName: item.metadata?.site_name || 'N/A',
            structureType: item.metadata?.structure_type || 'N/A',
            inventoryOnly: item.metadata?.inventory_only === true,
            selectors: item.selectors || {},
            productUrls: item.product_urls || [],
            productUrlsCount: (item.product_urls || []).length,
            expiresAt: item.expires_at,
            status: status,
            isExpired: isExpired,
            templateVersion: item.template_version || '1.0',
            lastProductCount: item.last_product_count || 0,
            lastRunAt: item.last_run_at,
            createdAt: item.created_at,
            updatedAt: item.updated_at,
            fileSize: item.scraper_code?.length || 0,
            source: 'supabase'
          }
        })
        
        return NextResponse.json({ scrapers })
      }
    }
    
    // Fallback: charger depuis le cache local
    if (!fs.existsSync(CACHE_DIR)) {
      return NextResponse.json({ scrapers: [] })
    }

    const files = fs.readdirSync(CACHE_DIR)
    const scrapers = []

    for (const file of files) {
      if (file.endsWith('_scraper.py')) {
        try {
          const filePath = path.join(CACHE_DIR, file)
          const content = fs.readFileSync(filePath, 'utf-8')
          
          // Extraire les métadonnées depuis les commentaires
          const cacheKey = file.replace('_scraper.py', '')
          const siteUrlMatch = content.match(/Site URL:\s*(https?:\/\/[^\s]+)/i)
          const siteNameMatch = content.match(/Site name:\s*([^\n]+)/i)
          const structureTypeMatch = content.match(/Structure type:\s*([^\n]+)/i)
          
          scrapers.push({
            cacheKey,
            url: siteUrlMatch?.[1] || 'N/A',
            siteName: siteNameMatch?.[1]?.trim() || 'N/A',
            structureType: structureTypeMatch?.[1]?.trim() || 'N/A',
            createdAt: fs.statSync(filePath).birthtime.toISOString(),
            fileSize: fs.statSync(filePath).size,
            source: 'local'
          })
        } catch (e) {
          console.error(`Error reading cache file ${file}:`, e)
        }
      }
    }

    return NextResponse.json({ scrapers })
  } catch (error: any) {
    console.error('Error reading cache:', error)
    return NextResponse.json(
      { error: 'Failed to read cache', message: error.message },
      { status: 500 }
    )
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await getCurrentUser()
    const { searchParams } = new URL(request.url)
    const cacheKey = searchParams.get('cache_key')
    const user_id = searchParams.get('user_id')
    const url = searchParams.get('url')

    if (!cacheKey && !url) {
      return NextResponse.json(
        { error: 'Either cache_key or url is required' },
        { status: 400 }
      )
    }

    // Si utilisateur connecté, supprimer depuis Supabase
    if (user && user_id === user.id) {
      const supabase = await createClient()
      
      let query = supabase
        .from('scraper_cache')
        .delete()
        .eq('user_id', user_id)
      
      if (cacheKey) {
        query = query.eq('cache_key', cacheKey)
      } else if (url) {
        query = query.eq('site_url', url)
      }
      
      const { error } = await query
      
      if (error) {
        return NextResponse.json(
          { error: error.message },
          { status: 500 }
        )
      }
      
      return NextResponse.json({
        success: true,
        deleted: true,
        message: 'Cache deleted from Supabase'
      })
    }

    // Fallback: supprimer depuis le cache local
    if (!fs.existsSync(CACHE_DIR)) {
      return NextResponse.json({ success: true, message: 'Cache already empty' })
    }

    let deleted = false

    if (cacheKey) {
      const filePath = path.join(CACHE_DIR, `${cacheKey}_scraper.py`)
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath)
        deleted = true
      }
    } else if (url) {
      // Trouver le fichier par URL
      const files = fs.readdirSync(CACHE_DIR)
      for (const file of files) {
        if (file.endsWith('_scraper.py')) {
          try {
            const filePath = path.join(CACHE_DIR, file)
            const content = fs.readFileSync(filePath, 'utf-8')
            const siteUrlMatch = content.match(/Site URL:\s*(https?:\/\/[^\s]+)/i)
            
            if (siteUrlMatch?.[1] === url) {
              fs.unlinkSync(filePath)
              deleted = true
              break
            }
          } catch (e) {
            // Ignorer les erreurs de parsing
          }
        }
      }
    }

    return NextResponse.json({
      success: true,
      deleted,
      message: deleted ? 'Cache invalidated' : 'Cache entry not found'
    })
  } catch (error: any) {
    console.error('Error deleting cache:', error)
    return NextResponse.json(
      { error: 'Failed to delete cache', message: error.message },
      { status: 500 }
    )
  }
}

