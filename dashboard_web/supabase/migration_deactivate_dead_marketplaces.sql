-- Migration: Désactivation des marketplaces jamais fonctionnelles (2026-08-18)
-- CycleTrader.com et MotorcycleDealers.ca échouent à chaque run du cron depuis
-- le 2026-05-15 (« 0 produits extraits ») : leur protection anti-bot (Cloudflare)
-- bloque les IPs datacenter de GitHub Actions. Le scraper MotorcycleDealers
-- fonctionne depuis une IP résidentielle — réactiver le jour où un proxy
-- résidentiel (ou un runner local) est en place.
--
-- NOTE : déjà appliquée en prod via PostgREST le 2026-08-18 (fichier conservé
-- pour traçabilité). Les cartes correspondantes ont été retirées de
-- src/lib/marketplace-sources.ts au même moment — les restaurer en cas de
-- réactivation.

UPDATE shared_scrapers
SET is_active = false,
    updated_at = NOW()
WHERE site_slug IN ('marketplace-cycletrader', 'motorcycledealers-ca');
