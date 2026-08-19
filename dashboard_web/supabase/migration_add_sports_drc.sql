-- Migration : ajout du concessionnaire Sports DRC (Alma, Lac-Saint-Jean)
-- Plateforme WordPress + FacetWP, thème BRP « wp-pgs-brp-smart-site » —
-- AUCUN JSON-LD produit : extraction 100 % DOM. Découverte via
-- sitemap_index.xml → used-product-sitemapN.xml (le plugin appelle TOUTES
-- les unités « produit-occasion », même neuves ; FR+EN en double, on garde
-- /fr/ : 1330 unités au 2026-08-19 = union des listings FacetWP paginés,
-- 1312 neuf / 18 occasion, zéro écart).
-- Scraper dédié : scraper_ai/dedicated_scrapers/sports_drc.py
-- (écrit à la main le 2026-08-19). Cadence : toutes les 2 h via
-- STALE_OVERRIDES_MINUTES (scripts/scraper_cron.py).
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
  'Sports DRC',
  'sports-drc',
  'https://sportsdrc.com/fr/',
  'sportsdrc.com',
  'sports-drc',
  ARRAY['inventaire', 'occasion'],
  ARRAY['motoneige', 'cote-a-cote', 'moto', 'vtt', 'motomarine', 'bateau', 'ponton', 'quai'],
  ARRAY[
    'sports drc', 'sport drc', 'drc', 'alma', 'lac-saint-jean',
    'saguenay-lac-saint-jean', 'ski-doo', 'can-am', 'sea-doo', 'brp',
    'princecraft', 'manitou'
  ],
  ARRAY[
    'name', 'prix', 'prix_original', 'marque', 'modele', 'annee', 'etat',
    'kilometrage', 'couleur', 'image', 'inventaire', 'vin',
    'vehicule_type', 'description'
  ],
  'Gros concessionnaire BRP à Alma (Lac-Saint-Jean). Ski-Doo, Can-Am, Sea-Doo, bateaux et pontons Princecraft/Manitou, quais. Plateforme WordPress + FacetWP (thème BRP smart-site).',
  '/dealers/sports-drc.png',
  '{
    "domains": ["sportsdrc.com"],
    "detail": {
      "json_ld": "AUCUN (seulement WebSite/WebPage) — extraction 100 % DOM",
      "name": "h1 (fallback og:title avec suffixe « neuf/d''occasion à Alma - Sports DRC »)",
      "specs": ".overview .specs li.<champ> : make/model/year/stock/km/vin/ext-color + li.category (hidden) pour le type — JAMAIS .listWImgsContent (carrousel similaires)",
      "price": ".infos .price .main — rabais : <del><span.value>ancien</span></del> + span.value[data-price] courant → prendre le .value HORS del",
      "image": ".wrap .main img[src*=cdn.powergo.ca/media/inventory]",
      "description": ".description (retirer l''en-tête « Description » et l''écho du nom en tête/fin)"
    },
    "discovery": {
      "method": "sitemap_index",
      "sitemap_url": "https://sportsdrc.com/sitemap_index.xml",
      "sub_filter": "used-product",
      "marker": "-a-vendre-",
      "note": "Suivre UNIQUEMENT les sous-sitemaps used-product-sitemapN.xml (les 15 autres sont des vitrines catalogue). Stocks 100 % libres (« foyer-flottant », « vogue_289759 », « 22-0840U ») — la regex n''exige PAS de chiffre. Suffixe U du stock = usagé (fallback état, priorité au titre)."
    }
  }'::jsonb,
  '[
    {
      "url": "https://sportsdrc.com/sitemap_index.xml",
      "type": "sitemap"
    },
    {
      "url": "https://sportsdrc.com/fr/inventaire-neuf/",
      "type": "listing",
      "category": "inventaire",
      "note": "FacetWP, paginable en ?fwp_paged=N (110 pages) pour audit seulement"
    },
    {
      "url": "https://sportsdrc.com/fr/produits-occasion/",
      "type": "listing",
      "category": "occasion",
      "note": "FacetWP, paginable en ?fwp_paged=N pour audit seulement"
    }
  ]'::jsonb,
  '{
    "type": "sitemap",
    "method": "sitemap_index",
    "rendering": "requests",
    "extraction": "dom",
    "sitemap_url": "https://sportsdrc.com/sitemap_index.xml",
    "note": "Découverte sitemap SANS plafond (1330 unités = union listings FacetWP au 2026-08-19, 1312 neuf / 18 occasion). km émis hors neuf seulement (leçon « 1 km » placebo de la même famille de plugin). Écho du nom en tête/fin de description retiré. Mojibake PowerGO possible (réparation latin-1→utf-8)."
  }'::jsonb,
  true,
  'approved',
  '1.0'
WHERE NOT EXISTS (
  SELECT 1 FROM shared_scrapers
  WHERE site_slug = 'sports-drc'
);
