-- Migration : ajout du concessionnaire Centre du Sport Lac-St-Jean (Alma, QC)
-- Plateforme SM360 (Shift Digital) — inventaire neuf + occasion.
-- Scraper dédié : scraper_ai/dedicated_scrapers/centre_du_sport_lac_st_jean.py
-- Cadence : toutes les 2 h via STALE_OVERRIDES_MINUTES (scripts/scraper_cron.py).
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
  selectors,
  listing_urls,
  pagination_config,
  is_active,
  validation_status,
  version
)
SELECT
  'Centre du Sport Lac-St-Jean',
  'centre-du-sport-lac-st-jean',
  'https://www.centredusportlacstjean.com/fr/',
  'centredusportlacstjean.com',
  'centre-du-sport-lac-st-jean',
  ARRAY['inventaire', 'occasion'],
  ARRAY['moto', 'vtt', 'cote-a-cote', 'motoneige', 'motomarine', 'bateau', 'ponton', 'moteur-hors-bord', 'remorque', 'equipement-motorise'],
  ARRAY[
    'centre du sport',
    'centre du sport lac st jean',
    'centre du sport lac-st-jean',
    'centredusportlacstjean',
    'alma',
    'lac-st-jean',
    'lac-saint-jean',
    'saguenay',
    'yamaha',
    'polaris',
    'honda',
    'g3',
    'jeanneau',
    'starcraft',
    'husqvarna',
    'remeq',
    'cfmoto'
  ],
  ARRAY[
    'name', 'prix', 'prix_original', 'marque', 'modele', 'annee', 'etat',
    'kilometrage', 'couleur', 'image', 'inventaire', 'vin',
    'vehicule_type', 'description'
  ],
  'Concessionnaire powersports et marine à Alma, QC (Lac-St-Jean). Yamaha : motos, VTT, côtes-à-côtes, motoneiges, motomarines, bateaux, pontons et moteurs hors-bord. Plateforme SM360 (Shift Digital).',
  '{
    "domains": ["centredusportlacstjean.com"],
    "listing": {
      "product_card": "article.inventory-list-layout-wrapper",
      "title": "a.inventory-list-layout__preview-name",
      "price": "meta[itemprop=price]",
      "old_price": ".inventory-list-layout__preview-price-strike",
      "image": ".inventory-list-layout__preview-image img"
    },
    "detail": {
      "json_ld": "Car",
      "stock": "stockNumber:''…'' (blob JS)",
      "vin": "vin:''…'' (blob JS)",
      "title": "h1"
    },
    "discovery": {
      "method": "paginated_listing",
      "page_param": "page",
      "per_page": 24,
      "inventory_url": "https://www.centredusportlacstjean.com/fr/inventaire-neuf",
      "used_url": "https://www.centredusportlacstjean.com/fr/inventaire-occasion"
    }
  }'::jsonb,
  '[
    {
      "url": "https://www.centredusportlacstjean.com/fr/inventaire-neuf",
      "type": "listing",
      "etat": "neuf",
      "category": "inventaire"
    },
    {
      "url": "https://www.centredusportlacstjean.com/fr/inventaire-occasion",
      "type": "listing",
      "etat": "occasion",
      "category": "occasion"
    }
  ]'::jsonb,
  '{
    "type": "page_param",
    "page_param": "page",
    "per_page": 24,
    "note": "Pagination SM360 classique ?page=N (24 produits/page). Le nombre total de pages est lu dans les liens de pagination de la page 1. Extraction hybride : cartes listing + JSON-LD Car et blob JS (stockNumber/vin) sur les pages détail."
  }'::jsonb,
  true,
  'approved',
  '1.0'
WHERE NOT EXISTS (
  SELECT 1 FROM shared_scrapers
  WHERE site_slug = 'centre-du-sport-lac-st-jean'
);
