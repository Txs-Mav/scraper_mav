import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/server'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Outils MCP exposés au Claude d'un client Go-Data.
 * Lecture seule, et TOUJOURS filtrés sur les user_ids résolus depuis le token —
 * le client Supabase passé ici est en service role (bypass RLS), le filtre
 * applicatif est donc la seule barrière entre les clients.
 */

export interface GodataMcpContext {
  supabase: SupabaseClient
  userIds: string[]
}

export const GODATA_INSTRUCTIONS = `Tu es connecté aux données Go-Data de ce client.
Go-Data est une plateforme québécoise de veille tarifaire pour concessionnaires de véhicules récréatifs (motos, VTT, motoneiges, bateaux…). Le client surveille les prix de ses concurrents et reçoit des alertes de changements. Tous les prix sont en dollars canadiens (CAD).

Vocabulaire :
- « Comparaison » (scraping) : un relevé de prix entre le site du client (reference_url) et ses concurrents (competitor_urls), avec la liste des produits et prix relevés.
- « Site surveillé » : une surveillance automatique récurrente qui détecte les changements de prix, nouveaux produits et retraits chez les concurrents.
- « Changement détecté » : hausse/baisse de prix, nouveau produit, produit retiré ou changement de stock repéré par la surveillance.
- « Fiche de changements » : liste de prix que le client prévoit d'appliquer dans son propre système.

Comment répondre vite :
- « Quoi de neuf ? / Qu'est-ce qui a bougé ? » → list_price_changes (30 derniers jours par défaut).
- « Quels prix chez mes concurrents pour X ? » → list_price_comparisons puis get_comparison_products avec search.
- « Qu'est-ce que je surveille ? » → list_monitored_sites.
- « Quels prix dois-je mettre à jour ? » → list_price_update_sheets puis get_sheet_items.
- « Ma stratégie de prix ? » → get_pricing_strategy.
Appelle guide pour la description détaillée des données. Utilise les paramètres limit/search plutôt que de tout charger.`

const GODATA_GUIDE = `# Guide des données Go-Data

Toutes les données retournées appartiennent au client connecté (et à ses employés si compte principal). Prix en CAD.

## list_price_comparisons
Les relevés de prix (« comparaisons ») lancés par le client, du plus récent au plus ancien.
Champs utiles : reference_url (le site du client), competitor_urls, product_count, created_at.
Chaque comparaison contient des produits accessibles via get_comparison_products.

## get_comparison_products
Les produits d'une comparaison : nom, prix relevés chez le client et les concurrents.
Utilise search pour filtrer par nom de produit (ex. "CFORCE", "Sportsman") et limit pour borner la réponse — une comparaison peut contenir des centaines de produits.

## list_monitored_sites
Les surveillances automatiques configurées : site de référence, concurrents, horaire, types de changements surveillés (watch_price_increase, watch_new_products…), dernière exécution (last_run_at) et dernier changement détecté (last_change_detected_at).

## list_price_changes
L'historique des changements détectés par les surveillances.
change_type : price_increase, price_decrease, new_product, removed_product, stock_change.
old_value / new_value sont les valeurs avant/après (prix en CAD pour les changements de prix), percentage_change le pourcentage de variation.
Filtres : days (fenêtre en jours), change_type, product_search, only_unread.

## list_price_update_sheets / get_sheet_items
Les « fiches de changements » : listes de prix que le client prévoit d'appliquer (old_price → new_price par produit, applied indique si c'est fait).

## get_pricing_strategy
La règle de calcul de prix du client (ex. s'aligner sur le concurrent le moins cher moins 2 %), globale et par type de véhicule.

## Conseils
- Commence large (list_*), affine ensuite (get_*).
- Les dates sont en ISO 8601 UTC ; le client est au Québec (heure de l'Est).
- Si une réponse est tronquée, réduis limit ou utilise search.`

const MAX_TEXT = 80_000

function ok(value: unknown) {
  let text = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  if (text.length > MAX_TEXT) {
    text = text.slice(0, MAX_TEXT) + '\n… [réponse tronquée — réduis limit ou utilise search]'
  }
  return { content: [{ type: 'text' as const, text }] }
}

function fail(message: string) {
  return { isError: true, content: [{ type: 'text' as const, text: message }] }
}

function dbError(error: { code?: string; message: string }) {
  if (error.code === 'PGRST205') {
    return fail('Cette donnée n’est pas encore disponible (migration manquante côté Go-Data).')
  }
  return fail(`Erreur Go-Data : ${error.message}`)
}

function clampLimit(limit: number | undefined, fallback: number, max: number): number {
  return Math.max(1, Math.min(limit ?? fallback, max))
}

export function registerGodataTools(server: McpServer, ctx: GodataMcpContext) {
  const { supabase, userIds } = ctx

  server.registerTool(
    'guide',
    {
      title: 'Guide des données Go-Data',
      description:
        "Mode d'emploi détaillé des données Go-Data de ce client : tables, champs, et quel outil utiliser pour quelle question. À lire en premier.",
      inputSchema: z.object({}),
    },
    async () => ok(GODATA_GUIDE)
  )

  server.registerTool(
    'list_price_comparisons',
    {
      title: 'Comparaisons de prix',
      description:
        'Liste les relevés de prix (comparaisons) du client, du plus récent au plus ancien : site de référence, concurrents, nombre de produits, date.',
      inputSchema: z.object({
        limit: z.number().int().min(1).max(100).optional().describe('Défaut 20, max 100'),
      }),
    },
    async ({ limit }) => {
      const { data, error } = await supabase
        .from('scrapings')
        .select('id, reference_url, competitor_urls, metadata, mode, created_at')
        .in('user_id', userIds)
        .order('created_at', { ascending: false })
        .limit(clampLimit(limit, 20, 100))
      if (error) return dbError(error)
      const rows = (data || []).map((s) => ({
        id: s.id,
        reference_url: s.reference_url,
        competitor_urls: s.competitor_urls,
        product_count: s.metadata?.product_count ?? s.metadata?.products_count ?? null,
        mode: s.mode,
        created_at: s.created_at,
      }))
      return ok(rows)
    }
  )

  server.registerTool(
    'get_comparison_products',
    {
      title: "Produits d'une comparaison",
      description:
        "Retourne les produits (noms et prix en CAD) d'une comparaison identifiée par son id. Utilise search pour filtrer par nom et limit pour borner la réponse.",
      inputSchema: z.object({
        comparison_id: z.string().describe('Id retourné par list_price_comparisons'),
        search: z.string().optional().describe('Filtre sur le nom du produit (insensible à la casse)'),
        limit: z.number().int().min(1).max(500).optional().describe('Défaut 100, max 500'),
      }),
    },
    async ({ comparison_id, search, limit }) => {
      const { data, error } = await supabase
        .from('scrapings')
        .select('id, reference_url, products, created_at')
        .eq('id', comparison_id)
        .in('user_id', userIds)
        .maybeSingle()
      if (error) return dbError(error)
      if (!data) return fail('Comparaison introuvable.')
      let products: any[] = Array.isArray(data.products) ? data.products : []
      const total = products.length
      if (search) {
        const needle = search.toLowerCase()
        products = products.filter((p) =>
          String(p?.name ?? p?.title ?? p?.product_name ?? '').toLowerCase().includes(needle)
        )
      }
      const capped = clampLimit(limit, 100, 500)
      // Champs lourds inutiles pour des questions de prix (descriptions HTML, images)
      const slim = products.slice(0, capped).map(({ description, image, ...rest }) => rest)
      return ok({
        comparison_id: data.id,
        reference_url: data.reference_url,
        created_at: data.created_at,
        total_products: total,
        matched: products.length,
        returned: slim.length,
        products: slim,
      })
    }
  )

  server.registerTool(
    'list_monitored_sites',
    {
      title: 'Sites surveillés',
      description:
        'Liste les surveillances automatiques du client : sites suivis, horaire, types de changements surveillés, dernière exécution et dernier changement détecté.',
      inputSchema: z.object({}),
    },
    async () => {
      const { data, error } = await supabase
        .from('scraper_alerts')
        .select(
          'id, is_active, reference_url, competitor_urls, categories, schedule_type, schedule_hour, schedule_minute, schedule_interval_hours, watch_price_increase, watch_price_decrease, watch_new_products, watch_removed_products, watch_stock_changes, min_price_change_pct, last_run_at, last_change_detected_at, created_at'
        )
        .in('user_id', userIds)
        .order('created_at', { ascending: false })
      if (error) return dbError(error)
      return ok(data || [])
    }
  )

  server.registerTool(
    'list_price_changes',
    {
      title: 'Changements de prix détectés',
      description:
        "Historique des changements détectés chez les concurrents : hausses/baisses de prix, nouveaux produits, retraits. C'est l'outil pour « qu'est-ce qui a bougé ? ».",
      inputSchema: z.object({
        change_type: z
          .enum(['price_increase', 'price_decrease', 'new_product', 'removed_product', 'stock_change'])
          .optional(),
        days: z.number().int().min(1).max(365).optional().describe('Fenêtre en jours, défaut 30'),
        product_search: z.string().optional().describe('Filtre sur le nom du produit'),
        only_unread: z.boolean().optional().describe('Seulement les changements non lus'),
        limit: z.number().int().min(1).max(200).optional().describe('Défaut 50, max 200'),
      }),
    },
    async ({ change_type, days, product_search, only_unread, limit }) => {
      const since = new Date(Date.now() - (days ?? 30) * 24 * 60 * 60 * 1000).toISOString()
      let query = supabase
        .from('alert_changes')
        .select('id, change_type, product_name, old_value, new_value, percentage_change, details, detected_at, is_read')
        .in('user_id', userIds)
        .gte('detected_at', since)
        .order('detected_at', { ascending: false })
        .limit(clampLimit(limit, 50, 200))
      if (change_type) query = query.eq('change_type', change_type)
      if (only_unread) query = query.eq('is_read', false)
      if (product_search) query = query.ilike('product_name', `%${product_search}%`)
      const { data, error } = await query
      if (error) return dbError(error)
      return ok(data || [])
    }
  )

  server.registerTool(
    'list_price_update_sheets',
    {
      title: 'Fiches de changements de prix',
      description:
        'Liste les fiches de changements du client : listes de prix à appliquer dans son système (nom, statut, nombre de lignes appliquées).',
      inputSchema: z.object({
        limit: z.number().int().min(1).max(100).optional().describe('Défaut 20, max 100'),
      }),
    },
    async ({ limit }) => {
      const { data, error } = await supabase
        .from('pricing_change_sheets')
        .select('id, name, status, items_count, applied_count, created_at, updated_at')
        .in('user_id', userIds)
        .order('created_at', { ascending: false })
        .limit(clampLimit(limit, 20, 100))
      if (error) return dbError(error)
      return ok(data || [])
    }
  )

  server.registerTool(
    'get_sheet_items',
    {
      title: "Lignes d'une fiche de changements",
      description:
        "Retourne les lignes d'une fiche de changements : produit, ancien prix, nouveau prix (CAD), appliqué ou non.",
      inputSchema: z.object({
        sheet_id: z.string().describe('Id retourné par list_price_update_sheets'),
        limit: z.number().int().min(1).max(500).optional().describe('Défaut 200, max 500'),
      }),
    },
    async ({ sheet_id, limit }) => {
      const { data: sheet, error: sheetError } = await supabase
        .from('pricing_change_sheets')
        .select('id, name, status')
        .eq('id', sheet_id)
        .in('user_id', userIds)
        .maybeSingle()
      if (sheetError) return dbError(sheetError)
      if (!sheet) return fail('Fiche introuvable.')
      const { data, error } = await supabase
        .from('pricing_change_sheet_items')
        .select('*')
        .eq('sheet_id', sheet_id)
        .limit(clampLimit(limit, 200, 500))
      if (error) return dbError(error)
      return ok({ sheet, items: data || [] })
    }
  )

  server.registerTool(
    'get_pricing_strategy',
    {
      title: 'Stratégie de prix',
      description:
        'La règle de calcul de prix du client (globale et par type de véhicule), utilisée pour générer les recommandations.',
      inputSchema: z.object({}),
    },
    async () => {
      const { data, error } = await supabase
        .from('pricing_strategy_settings')
        .select('apply_enabled, default_strategy, vehicle_type_strategies, updated_at')
        .in('user_id', userIds)
      if (error) return dbError(error)
      if (!data || data.length === 0) return ok("Aucune stratégie de prix configurée pour ce client.")
      return ok(data.length === 1 ? data[0] : data)
    }
  )
}
