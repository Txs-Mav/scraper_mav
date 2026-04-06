/**
 * Feature flags — toggles activables uniquement dans le code source.
 *
 * CACHE_SCRAPING_MODE ("méthode du cache")
 * ─────────────────────────────────────────
 * Quand ACTIVÉ :
 *   - Un cron GitHub Actions scrape tous les sites universels toutes les heures
 *     (étalé par paires sur 60 min), et stocke les produits dans `scraped_site_data`.
 *   - "Analyser maintenant" → lecture instantanée depuis le cache pré-scrapé
 *     + comparaison en ~2-5 s → résultat affiché.
 *   - Un bouton secondaire "Forcer un scraping" permet quand même un scraping
 *     temps-réel si besoin.
 *
 * Quand DÉSACTIVÉ :
 *   - "Analyser maintenant" → scraping parallèle classique de tous les sites
 *     configurés par l'utilisateur (3-10 min).
 *   - Pas de cron, pas de bouton "Forcer".
 */

// ━━━ Configuration globale ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const CACHE_SCRAPING_ENABLED_GLOBAL = true

// ━━━ Overrides par user ID ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Pour désactiver le cache pour un utilisateur spécifique :
//   USER_OVERRIDES['uuid-de-l-utilisateur'] = false
//
// Pour activer uniquement pour certains utilisateurs (si global = false) :
//   USER_OVERRIDES['uuid-de-l-utilisateur'] = true

const USER_OVERRIDES: Record<string, boolean> = {
  // Exemples :
  // 'a1b2c3d4-e5f6-7890-abcd-ef1234567890': false,  // désactiver pour cet utilisateur
  // 'f9e8d7c6-b5a4-3210-fedc-ba0987654321': true,   // activer pour cet utilisateur
}

// ━━━ API publique ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function isCacheScrapingEnabled(userId?: string | null): boolean {
  if (userId && userId in USER_OVERRIDES) {
    return USER_OVERRIDES[userId]
  }
  return CACHE_SCRAPING_ENABLED_GLOBAL
}
