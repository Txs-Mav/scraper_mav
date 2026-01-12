/**
 * Fonctions utilitaires Supabase
 */
import { createClient } from './server'
import type { User, Scraping } from '@/types/user'

/**
 * Récupère l'utilisateur actuel depuis Supabase Auth
 */
export async function getCurrentUser() {
  const supabase = await createClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error || !user) {
    return null
  }

  // Récupérer les données utilisateur depuis la table users
  const { data: userData, error: userError } = await supabase
    .from('users')
    .select('*')
    .eq('id', user.id)
    .single()

  if (userError || !userData) {
    return null
  }

  return userData as User
}

/**
 * Vérifie si l'utilisateur est un compte principal
 */
export async function isMainAccount(userId: string): Promise<boolean> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('users')
    .select('role')
    .eq('id', userId)
    .single()

  if (error || !data) {
    return false
  }

  return data.role === 'main'
}

/**
 * Récupère les scrapings d'un utilisateur
 */
export async function getUserScrapings(userId: string): Promise<Scraping[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('scrapings')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('Error fetching scrapings:', error)
    return []
  }

  return (data || []) as Scraping[]
}

/**
 * Crée un nouveau scraping
 */
export async function createScraping(
  userId: string,
  scrapingData: {
    reference_url: string
    competitor_urls?: string[]
    products: any[]
    metadata: any
    scraping_time_seconds?: number
    mode?: string
  }
) {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('scrapings')
    .insert({
      user_id: userId,
      ...scrapingData,
    })
    .select()
    .single()

  if (error) {
    console.error('Error creating scraping:', error)
    throw error
  }

  return data as Scraping
}

/**
 * Met à jour un scraping existant
 */
export async function updateScraping(
  scrapingId: string,
  userId: string,
  updates: Partial<Scraping>
) {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('scrapings')
    .update(updates)
    .eq('id', scrapingId)
    .eq('user_id', userId) // Sécurité : vérifier que le scraping appartient à l'utilisateur
    .select()
    .single()

  if (error) {
    console.error('Error updating scraping:', error)
    throw error
  }

  return data as Scraping
}


