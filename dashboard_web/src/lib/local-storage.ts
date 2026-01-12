/**
 * Utilitaires pour gérer les scrapings locaux dans localStorage
 */

const STORAGE_KEY = 'local_scrapings'
const MAX_LOCAL_SCRAPINGS = 10

export interface LocalScraping {
  id: string
  reference_url: string
  competitor_urls: string[]
  products: any[]
  metadata: any
  scraping_time_seconds?: number
  mode?: string
  created_at: string
}

/**
 * Récupère tous les scrapings locaux
 */
export function getLocalScrapings(): LocalScraping[] {
  if (typeof window === 'undefined') return []
  
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (!stored) return []
    return JSON.parse(stored)
  } catch (error) {
    console.error('Error reading local scrapings:', error)
    return []
  }
}

/**
 * Sauvegarde un scraping localement
 */
export function saveLocalScraping(scraping: Omit<LocalScraping, 'id' | 'created_at'>): { success: boolean; error?: string } {
  if (typeof window === 'undefined') {
    return { success: false, error: 'localStorage not available' }
  }

  try {
    const scrapings = getLocalScrapings()
    
    // Vérifier la limite
    if (scrapings.length >= MAX_LOCAL_SCRAPINGS) {
      return { success: false, error: `Limite de ${MAX_LOCAL_SCRAPINGS} scrapings atteinte. Connectez-vous pour plus de scrapings.` }
    }

    // Créer un nouveau scraping avec ID et timestamp
    const newScraping: LocalScraping = {
      ...scraping,
      id: `local_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      created_at: new Date().toISOString(),
    }

    scrapings.push(newScraping)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(scrapings))
    
    return { success: true }
  } catch (error: any) {
    console.error('Error saving local scraping:', error)
    return { success: false, error: error.message }
  }
}

/**
 * Supprime un scraping local
 */
export function deleteLocalScraping(id: string): boolean {
  if (typeof window === 'undefined') return false

  try {
    const scrapings = getLocalScrapings()
    const filtered = scrapings.filter(s => s.id !== id)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered))
    return true
  } catch (error) {
    console.error('Error deleting local scraping:', error)
    return false
  }
}

/**
 * Compte le nombre de scrapings locaux
 */
export function getLocalScrapingsCount(): number {
  return getLocalScrapings().length
}

/**
 * Vérifie si la limite est atteinte
 */
export function isLocalScrapingsLimitReached(): boolean {
  return getLocalScrapingsCount() >= MAX_LOCAL_SCRAPINGS
}

/**
 * Supprime tous les scrapings locaux
 */
export function clearLocalScrapings(): void {
  if (typeof window === 'undefined') return
  localStorage.removeItem(STORAGE_KEY)
}

/**
 * Migre les scrapings locaux vers Supabase (via API)
 */
export async function migrateLocalScrapingsToSupabase(): Promise<{ success: boolean; migrated: number; errors: string[] }> {
  const scrapings = getLocalScrapings()
  const errors: string[] = []
  let migrated = 0

  for (const scraping of scrapings) {
    try {
      const response = await fetch('/api/scrapings/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reference_url: scraping.reference_url,
          competitor_urls: scraping.competitor_urls,
          products: scraping.products,
          metadata: scraping.metadata,
          scraping_time_seconds: scraping.scraping_time_seconds,
          mode: scraping.mode,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        errors.push(`Erreur pour ${scraping.reference_url}: ${data.error || 'Unknown error'}`)
      } else {
        migrated++
      }
    } catch (error: any) {
      errors.push(`Erreur pour ${scraping.reference_url}: ${error.message}`)
    }
  }

  // Si tous les scrapings ont été migrés avec succès, supprimer les locaux
  if (migrated === scrapings.length && errors.length === 0) {
    clearLocalScrapings()
  }

  return { success: errors.length === 0, migrated, errors }
}


