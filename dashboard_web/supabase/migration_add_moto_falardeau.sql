-- Migration : ajout du concessionnaire Moto Falardeau (Mont-Laurier, Laurentides)
-- Plateforme PowerGO / WordPress — sitemap inventory-sitemap.xml (FR+EN en double,
-- on ne garde que /fr/), listings client-side.
-- Scraper dédié : scraper_ai/dedicated_scrapers/moto_falardeau.py (écrit à la main
-- le 2026-08-17, modèle smsport.py). Cadence : toutes les 2 h via
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
  'Moto Falardeau',
  'moto-falardeau',
  'https://motofalardeau.com/fr/',
  'motofalardeau.com',
  'moto-falardeau',
  ARRAY['inventaire', 'occasion'],
  ARRAY['moto', 'cote-a-cote', 'vtt', 'ponton', 'bateau', 'motomarine', 'motoneige', 'velo-electrique', 'equipement-mecanique', 'remorque', 'vr'],
  ARRAY[
    'moto falardeau', 'falardeau', 'mont-laurier', 'laurentides',
    'hautes-laurentides', 'kawasaki', 'cfmoto', 'husqvarna', 'alumacraft',
    'armada', 'starcraft', 'suzuki', 'ktm'
  ],
  ARRAY[
    'name', 'prix', 'prix_original', 'marque', 'modele', 'annee', 'etat',
    'kilometrage', 'couleur', 'image', 'inventaire', 'vin',
    'vehicule_type', 'description'
  ],
  'Concessionnaire powersports et marine à Mont-Laurier (Hautes-Laurentides). Kawasaki, CFMOTO, Husqvarna, Alumacraft : motos, côtes-à-côtes, VTT, pontons, bateaux, motomarines, vélos électriques, moteurs hors-bord. Plateforme PowerGO/WordPress.',
  '/dealers/moto-falardeau.png',
  '{
    "domains": ["motofalardeau.com"],
    "detail": {
      "json_ld": "Vehicle (bloc <script> racine dédié — PAS dans @graph ici ; caractères de contrôle bruts → json.loads strict=False)",
      "price_fallback": "[class*=pg-vehicle-price]",
      "old_price": "del/s dans le bloc pg-vehicle-price",
      "km_fallback": "ul.specs li.km .number (jamais dans le JSON-LD)",
      "title": "meta[property=og:title]"
    },
    "discovery": {
      "method": "sitemap",
      "sitemap_url": "https://motofalardeau.com/inventory-sitemap.xml",
      "filter_lang": "/fr/inventaire/",
      "marker": "a-vendre-ins",
      "note": "Le sitemap liste chaque unité en FR et en EN (doublons) — filtrer /fr/. Listings client-side, le sitemap est la seule source. Pas de segment neuf/usage dans l''URL : état via itemCondition (fallback titre)."
    }
  }'::jsonb,
  '[
    {
      "url": "https://motofalardeau.com/inventory-sitemap.xml",
      "type": "sitemap"
    },
    {
      "url": "https://motofalardeau.com/fr/inventaire/",
      "type": "listing",
      "category": "inventaire",
      "note": "client-side, non scrapable en requests"
    }
  ]'::jsonb,
  '{
    "type": "sitemap",
    "method": "sitemap",
    "rendering": "requests",
    "extraction": "json_ld_graph",
    "sitemap_url": "https://motofalardeau.com/inventory-sitemap.xml",
    "note": "Découverte sitemap SANS plafond (143 unités FR au 2026-08-17). ~6 % des pages n''ont aucun JSON-LD Vehicle (rendu client) → fallback og:title + parsing marque/modèle/année depuis le nom, prix absent honnête. Descriptions JSON-LD avec entités HTML (&Eacute;) → double unescape. Km des occasions via ul.specs li.km. Mojibake PowerGO possible (réparation latin-1→utf-8)."
  }'::jsonb,
  true,
  'approved',
  '1.0'
WHERE NOT EXISTS (
  SELECT 1 FROM shared_scrapers
  WHERE site_slug = 'moto-falardeau'
);
