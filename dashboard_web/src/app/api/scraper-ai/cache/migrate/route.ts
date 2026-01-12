import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/supabase/helpers'
import fs from 'fs'
import path from 'path'

const CACHE_DIR = path.join(process.cwd(), '..', 'scraper_cache')

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      )
    }

    if (!fs.existsSync(CACHE_DIR)) {
      return NextResponse.json({
        success: true,
        migrated: 0,
        message: 'No local cache to migrate'
      })
    }

    const files = fs.readdirSync(CACHE_DIR)
    const scraperFiles = files.filter(f => f.endsWith('_scraper.py'))
    
    if (scraperFiles.length === 0) {
      return NextResponse.json({
        success: true,
        migrated: 0,
        message: 'No scrapers to migrate'
      })
    }

    const supabase = await createClient()
    let migrated = 0
    const errors: string[] = []

    for (const file of scraperFiles) {
      try {
        const filePath = path.join(CACHE_DIR, file)
        const scraper_code = fs.readFileSync(filePath, 'utf-8')
        const cache_key = file.replace('_scraper.py', '')
        
        // Extraire les métadonnées depuis les commentaires
        const siteUrlMatch = scraper_code.match(/Site URL:\s*(https?:\/\/[^\s]+)/i)
        const siteNameMatch = scraper_code.match(/Site name:\s*([^\n]+)/i)
        const structureTypeMatch = scraper_code.match(/Structure type:\s*([^\n]+)/i)
        const promptVersionMatch = scraper_code.match(/Version prompt:\s*([\d.]+)/i)
        
        const site_url = siteUrlMatch?.[1] || 'unknown'
        const metadata: any = {
          site_name: siteNameMatch?.[1]?.trim() || 'Unknown',
          site_url: site_url,
          structure_type: structureTypeMatch?.[1]?.trim() || 'unknown',
          prompt_version: promptVersionMatch?.[1] || '1.0'
        }
        
        // Extraire les sélecteurs depuis SELECTORS = {...}
        const selectorsMatch = scraper_code.match(/SELECTORS\s*=\s*(\{.*?\})/s)
        if (selectorsMatch) {
          try {
            // Essayer d'évaluer le dictionnaire (sécurisé car seulement des chaînes)
            metadata.selectors = eval(selectorsMatch[1], {"__builtins__": {}})
          } catch {
            // Ignorer si échec
          }
        }
        
        // Vérifier si le scraper existe déjà dans Supabase
        const { data: existing } = await supabase
          .from('scraper_cache')
          .select('id')
          .eq('user_id', user.id)
          .eq('cache_key', cache_key)
          .single()
        
        if (existing) {
          // Mettre à jour
          const { error } = await supabase
            .from('scraper_cache')
            .update({
              site_url,
              scraper_code,
              metadata,
              updated_at: new Date().toISOString()
            })
            .eq('id', existing.id)
          
          if (error) {
            errors.push(`Error updating ${cache_key}: ${error.message}`)
            continue
          }
        } else {
          // Créer
          const { error } = await supabase
            .from('scraper_cache')
            .insert({
              user_id: user.id,
              site_url,
              cache_key,
              scraper_code,
              metadata
            })
          
          if (error) {
            errors.push(`Error inserting ${cache_key}: ${error.message}`)
            continue
          }
        }
        
        // Supprimer le fichier local après migration réussie
        fs.unlinkSync(filePath)
        migrated++
        
      } catch (error: any) {
        errors.push(`Error processing ${file}: ${error.message}`)
      }
    }

    return NextResponse.json({
      success: errors.length === 0,
      migrated,
      errors,
      message: `Migrated ${migrated} scrapers to Supabase`
    })
  } catch (error: any) {
    console.error('Error migrating cache:', error)
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}

