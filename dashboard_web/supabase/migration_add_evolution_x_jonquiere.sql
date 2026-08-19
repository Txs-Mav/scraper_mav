-- Migration : ajout du concessionnaire Évolution X Jonquière (Saguenay)
-- Plateforme PowerGO / WordPress + FacetWP — sitemap inventory-sitemap.xml
-- (FR uniquement, 94 unités au 2026-08-19, vérifié = union des listings
-- FacetWP paginés neuf + occasion, zéro écart), listings client-side.
-- Scraper dédié : scraper_ai/dedicated_scrapers/evolution_x_jonquiere.py
-- (écrit à la main le 2026-08-19, modèle moto_falardeau.py). Cadence :
-- toutes les 2 h via STALE_OVERRIDES_MINUTES (scripts/scraper_cron.py).
-- Idempotente : ne fait rien si le slug existe déjà.

INSERT INTO shared_scrapers (
  site_name,
  site_slug,
  site_url,
  site_domain,
  scraper_module,
  categories,
  vehicle_types,
  search_keywords,
  extracted_fields,
  description,
  logo_url,
  selectors,
  listing_urls,
  pagination_config,
  is_active,
  validation_status,
  version
)
SELECT
  'Évolution X Jonquière',
  'evolution-x-jonquiere',
  'https://www.evolutionxjonquiere.ca/fr/',
  'evolutionxjonquiere.ca',
  'evolution-x-jonquiere',
  ARRAY['inventaire', 'occasion'],
  ARRAY['motoneige', 'cote-a-cote', 'vtt', 'moto'],
  ARRAY[
    'evolution x', 'évolution x', 'evolution-x', 'evolution x jonquiere',
    'jonquière', 'jonquiere', 'saguenay', 'saguenay-lac-saint-jean', 'polaris'
  ],
  ARRAY[
    'name', 'prix', 'prix_original', 'marque', 'modele', 'annee', 'etat',
    'kilometrage', 'couleur', 'image', 'inventaire', 'vin',
    'vehicule_type', 'description'
  ],
  'Concessionnaire Polaris à Jonquière (Saguenay). Motoneiges, côtes-à-côtes, VTT neufs Polaris et occasions multimarques. Plateforme PowerGO/WordPress + FacetWP.',
  '/dealers/evolution-x-jonquiere.png',
  '{
    "domains": ["evolutionxjonquiere.ca"],
    "detail": {
      "json_ld": "Vehicle au niveau racine (script dédié)",
      "price_fallback": ".product-specs .price .current-price",
      "old_price": ".product-specs .price .old-price",
      "km_fallback": ".tab-pane li.km .number — UNIQUEMENT hors neuf (le dealer met « 1 km » placebo sur le neuf, et le carrousel similaires a ses propres li.km)",
      "title": "meta[property=og:title]"
    },
    "discovery": {
      "method": "sitemap",
      "sitemap_url": "https://www.evolutionxjonquiere.ca/inventory-sitemap.xml",
      "marker": "a-vendre-",
      "note": "IDs de stock très variables après a-vendre- : « 3017 », « 2783a », « 3731-3732 » (unités jumelées), « pol-s27ajn9fsp-1 » (code fabricant) — seule contrainte : au moins un chiffre. Pas de segment neuf/usage dans l''URL : état via itemCondition (fallback titre « d''occasion à Jonquière »)."
    }
  }'::jsonb,
  '[
    {
      "url": "https://www.evolutionxjonquiere.ca/inventory-sitemap.xml",
      "type": "sitemap"
    },
    {
      "url": "https://www.evolutionxjonquiere.ca/fr/inventaire-neuf/",
      "type": "listing",
      "category": "inventaire",
      "note": "FacetWP client-side, paginable en ?fwp_paged=N pour audit seulement"
    },
    {
      "url": "https://www.evolutionxjonquiere.ca/fr/produits-occasion/",
      "type": "listing",
      "category": "occasion",
      "note": "FacetWP client-side, paginable en ?fwp_paged=N pour audit seulement"
    }
  ]'::jsonb,
  '{
    "type": "sitemap",
    "method": "sitemap",
    "rendering": "requests",
    "extraction": "json_ld_graph",
    "sitemap_url": "https://www.evolutionxjonquiere.ca/inventory-sitemap.xml",
    "note": "Découverte sitemap SANS plafond (94 unités = union listings FacetWP au 2026-08-19, répartition 79 neuf / 15 occasion identique). Noms avec tokens doublés côté dealer (« Polaris polaris … 2023 2023 ») → dédup tokens adjacents. mileageFromOdometer absent du JSON-LD → km via .tab-pane li.km, hors neuf seulement. Prix barré .old-price scopé .product-specs. Mojibake PowerGO possible (réparation latin-1→utf-8)."
  }'::jsonb,
  true,
  'approved',
  '1.0'
WHERE NOT EXISTS (
  SELECT 1 FROM shared_scrapers
  WHERE site_slug = 'evolution-x-jonquiere'
);
