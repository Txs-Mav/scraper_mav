-- =====================================================
-- Migration : corrections du Security Advisor Supabase
-- =====================================================
--
-- Corrige deux alertes remontées par le linter Supabase :
--
-- 1. La vue `public.scraper_cache_with_stats` est définie avec
--    SECURITY DEFINER (comportement par défaut des vues Postgres).
--    On la recrée avec l'option `security_invoker = true` afin que
--    les requêtes s'exécutent avec les droits de l'utilisateur qui
--    interroge la vue (et non ceux du créateur), ce qui permet à
--    la RLS des tables sous-jacentes (`scraper_cache`, `scraping_results`)
--    de s'appliquer correctement.
--
-- 2. La table `public.promo_codes` est exposée via PostgREST mais
--    la RLS n'est pas activée. On active la RLS et on ajoute une
--    policy SELECT (anon + authenticated) — le endpoint `validate`
--    est appelé depuis la page `create-account` avant login.
--    Les écritures (INSERT/UPDATE/DELETE) ne sont autorisées qu'au
--    `service_role` qui bypass RLS (utilisé par le endpoint
--    `apply` pour incrémenter `current_uses`).
--
-- À exécuter dans l'éditeur SQL de Supabase.
-- =====================================================

-- =====================================================
-- 1. Vue scraper_cache_with_stats : security_invoker
-- =====================================================

-- Nécessite Postgres >= 15 (Supabase : OK).
ALTER VIEW public.scraper_cache_with_stats SET (security_invoker = true);

COMMENT ON VIEW public.scraper_cache_with_stats IS
  'Statistiques agrégées par scraper. security_invoker=true : applique la RLS de l''utilisateur courant sur scraper_cache et scraping_results.';

-- =====================================================
-- 2. RLS sur la table promo_codes
-- =====================================================

ALTER TABLE public.promo_codes ENABLE ROW LEVEL SECURITY;

-- Lecture : tout le monde (anon + authenticated) peut lire les codes
-- afin de les valider depuis la page d'inscription (pré-auth) et
-- depuis le dashboard (authenticated). Les codes ne contiennent aucune
-- donnée sensible.
DROP POLICY IF EXISTS "promo_codes_select_all" ON public.promo_codes;
CREATE POLICY "promo_codes_select_all"
  ON public.promo_codes
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- Pas de policy pour INSERT/UPDATE/DELETE : seules les clés
-- service_role (côté serveur via createServiceClient) pourront
-- modifier la table, car elles bypass RLS.

COMMENT ON TABLE public.promo_codes IS
  'Codes promo. RLS activée : lecture publique, écriture réservée au service_role.';
