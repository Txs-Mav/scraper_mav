-- Migration : ajout du concessionnaire Évasion Sport / Évasion DR
-- (Laterrière, Saguenay). Plateforme atypique : site « Simply Web Editor /
-- TurnkeyWebSolutions » + inventaire equipmentsearch.com, MAIS listings et
-- JSON-LD Product rendus côté serveur — requests suffit.
-- Découverte : pagination serveur /fr/Inventaire/page/N/ (58 pages,
-- ~575 unités au 2026-08-19) + carte adid→catégorie via les listings par
-- catégorie (/fr/Motoneiges/, /fr/ATVs/, …).
-- ⚠️ ANTI-BOT AGRESSIF : bannit l'IP à 8 workers → 2 workers max + pauses.
-- Scraper dédié : scraper_ai/dedicated_scrapers/evasion_sport.py
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
  'Évasion Sport',
  'evasion-sport',
  'https://evasion-sport.com/fr/',
  'evasion-sport.com',
  'evasion-sport',
  ARRAY['inventaire', 'occasion'],
  ARRAY['motoneige', 'vtt', 'cote-a-cote', 'bateau', 'ponton', 'moteur-hors-bord', 'remorque', 'moto', 'velo-electrique'],
  ARRAY[
    'evasion sport', 'évasion sport', 'evasion dr', 'évasion dr',
    'laterrière', 'laterriere', 'chicoutimi', 'saguenay',
    'saguenay-lac-saint-jean', 'yamaha', 'arctic cat', 'avalon', 'legend',
    'mercury', 'argo', 'adly', 'scootterre', 'stark varg'
  ],
  ARRAY[
    'name', 'prix', 'prix_original', 'marque', 'modele', 'annee', 'etat',
    'image', 'inventaire', 'vehicule_type', 'description'
  ],
  'Concessionnaire Yamaha, Arctic Cat, Avalon, Legend, Mercury, Argo, Adly et Stark Varg à Laterrière (Saguenay). Motoneiges, VTT, côtes-à-côtes, bateaux, pontons, moteurs hors-bord, remorques. Inventaire equipmentsearch.com rendu côté serveur.',
  '/dealers/evasion-sport.jpg',
  '{
    "domains": ["evasion-sport.com"],
    "detail": {
      "json_ld": "Product (name, brand, mpn = n° stock, image, description, offers.priceSpecification[].price, offers.itemCondition — l''état est DANS offers)",
      "name_fallback": "<title> (= nom brut)",
      "note": "Ni km, ni couleur, ni VIN côté serveur (widget client) → champs omis honnêtement. Description = écho du nom + boilerplate « Évasion Sport, concessionnaire reconnu… » → coupée, souvent vide."
    },
    "discovery": {
      "method": "listing_pagination",
      "listing_url": "https://evasion-sport.com/fr/Inventaire/",
      "pagination": "/fr/Inventaire/page/N/ (pager serveur)",
      "marker": "/adid/<id>/",
      "note": "L''adid est l''identifiant unique d''unité (clé de dédup). Catégorie ABSENTE de la fiche → carte adid→catégorie construite en paginant les 10 listings par catégorie (/fr/Motoneiges/, /fr/ATVs/, /fr/Côte-à-côte/, /fr/Bateaux/, /fr/Pontons/, /fr/Moteurs-hors-bord/, /fr/Remorques/, /fr/Vélos-électriques/, /fr/motocyclettes-&-Scooters/, /fr/Produit-énergétique/). Fallback état : appartenance au listing /fr/Occasion/. ⚠️ ANTI-BOT : 2 workers max + 0,6 s entre pages de listing, sinon ban IP temporaire."
    }
  }'::jsonb,
  '[
    {
      "url": "https://evasion-sport.com/fr/Inventaire/",
      "type": "listing",
      "category": "inventaire",
      "note": "server-rendered, pagination /page/N/ (58 pages au 2026-08-19)"
    },
    {
      "url": "https://evasion-sport.com/fr/Occasion/",
      "type": "listing",
      "category": "occasion",
      "note": "sous-ensemble : sert de fallback d''état"
    }
  ]'::jsonb,
  '{
    "type": "pages",
    "method": "listing_pagination",
    "rendering": "requests",
    "extraction": "json_ld_product",
    "note": "Pagination serveur SANS plafond (~575 unités sur 58 pages au 2026-08-19). ⚠️ Anti-bot TurnkeyWebSolutions : à 8 workers l''IP est bannie (« temporarily blocked — JavaScript needs to be enabled ») → MAX_WORKERS=2 + 0,6 s entre pages. km/couleur/VIN indisponibles côté serveur — omis honnêtement."
  }'::jsonb,
  true,
  'approved',
  '1.0'
WHERE NOT EXISTS (
  SELECT 1 FROM shared_scrapers
  WHERE site_slug = 'evasion-sport'
);
