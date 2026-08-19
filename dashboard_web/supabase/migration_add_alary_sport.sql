-- Migration : ajout du concessionnaire Alary Sport (Saint-Jérôme, Laurentides).
-- Plateforme PowerGO / Next.js (comme SM Sport et Excel Moto) : listings
-- rendus côté client (RSC) → découverte via sitemap
-- /sitemaps/inventory-detail.xml (1322 URLs FR au 2026-08-19 : 1171 neuf
-- + 151 usagé). Oracle : payload Next.js de /fr/usage/ affiche total=151
-- = exactement le sitemap ; côté neuf les listings filtrent le
-- « sur commande » → le sitemap est le superset voulu.
-- JSON-LD niché dans @graph : Vehicle (véhicules) ou Product (remorques,
-- équipement). Stocks parfois alphanumériques (a-vendre-edl70sde).
-- Scraper dédié : scraper_ai/dedicated_scrapers/alary_sport.py
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
  'Alary Sport',
  'alary-sport',
  'https://www.alarysport.com/fr/',
  'alarysport.com',
  'alary-sport',
  ARRAY['inventaire', 'occasion'],
  ARRAY['moto', 'motoneige', 'vtt', 'cote-a-cote', 'motomarine', 'bateau',
        'ponton', 'moteur-hors-bord', 'remorque', 'equipement-mecanique',
        'voiturette-de-golf', 'vehicule-a-3-roues'],
  ARRAY[
    'alary sport', 'alary', 'saint-jerome', 'saint-jérôme', 'st-jerome',
    'laurentides', 'polaris', 'yamaha', 'indian motorcycle', 'indian',
    'mercury', 'lund', 'g3', 'suncatcher', 'avalon', 'princecraft',
    'skeeter', 'patriote', 'remeq', 'bercomac', 'harley-davidson',
    'honda', 'kawasaki', 'suzuki'
  ],
  ARRAY[
    'name', 'prix', 'prix_original', 'marque', 'modele', 'annee', 'etat',
    'kilometrage', 'couleur', 'image', 'inventaire', 'vehicule_type',
    'description'
  ],
  'Concessionnaire Polaris, Yamaha, Indian Motorcycle, Mercury, Lund, G3, SunCatcher et Avalon à Saint-Jérôme (Laurentides). Motos, motoneiges, VTT, côtes-à-côtes, motomarines, bateaux, pontons, chaloupes, moteurs hors-bord, remorques et équipement. ~1322 unités (dont ~150 usagées).',
  '/dealers/alary-sport.png',
  '{
    "domains": ["alarysport.com"],
    "detail": {
      "json_ld": "@graph → Vehicle (véhicules) ou Product (remorques/équipement) : name, brand.name, model, vehicleModelDate, color, mileageFromOdometer.value, sku, itemCondition, offers.price, image[]",
      "price_strike": "bloc .pg-vehicle-price → .list-price.line-through = prix barré (prix_original), .sale-price = prix courant",
      "name_fallback": "og:title (suffixe « Neuf à Saint-Jérôme » à retirer)",
      "note": "mileageFromOdometer.value = null sur le neuf → km omis. Marque doublée dans les noms d''usagés (« Harley-Davidson Harley-Davidson SPORTSTER… ») → dédup tokens adjacents. Descriptions en entités HTML (&Egrave;) + bannières « **…** » → unescape + nettoyage."
    },
    "discovery": {
      "method": "sitemap",
      "sitemap": "https://www.alarysport.com/sitemaps/inventory-detail.xml",
      "url_pattern": "/fr/(neuf|usage)/<segment>/inventaire/<slug>-a-vendre-<stock>/",
      "note": "Listings 100 % client-side (RSC Next.js) → sitemap obligatoire, AUCUN plafond. Stocks parfois ALPHANUMÉRIQUES (a-vendre-edl70sde, a-vendre-v-drive-2es). Deux unités distinctes peuvent partager le même id d''URL sous des slugs différents (sku 39171 vs 39171_) → dédup par sourceUrl, jamais par id de stock."
    }
  }'::jsonb,
  '[
    {
      "url": "https://www.alarysport.com/sitemaps/inventory-detail.xml",
      "type": "sitemap",
      "category": "inventaire",
      "note": "source de découverte unique (1171 neuf + 151 usagé au 2026-08-19), URLs /fr/ et /en/ — ne garder que /fr/"
    }
  ]'::jsonb,
  '{
    "type": "sitemap",
    "method": "sitemap_discovery",
    "rendering": "requests",
    "extraction": "json_ld_graph",
    "note": "PowerGO : pas de pagination serveur, sitemap = superset (inclut le « sur commande » que les listings filtrent). Site rapide sans anti-bot : 1322 pages détail en ~53 s à 10 workers. Oracle usagé : total=151 dans le payload Next.js de /fr/usage/ = compte sitemap exact."
  }'::jsonb,
  true,
  'approved',
  '1.0'
WHERE NOT EXISTS (
  SELECT 1 FROM shared_scrapers
  WHERE site_slug = 'alary-sport'
);
