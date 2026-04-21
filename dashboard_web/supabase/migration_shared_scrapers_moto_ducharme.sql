-- Migration: Ajout de Moto Ducharme dans shared_scrapers
-- Date: 2026-04-03 (v1.0), 2026-04-20 (v1.1)
-- Description: Scraper dédié Moto Ducharme — Magento 2, Joliette QC
--              v1.1: Découverte via sitemap XML (~1171 URLs) + listings page 1 pour
--                    catégoriser neuf/occasion. La pagination `?p=N` est bloquée par
--                    reCAPTCHA Enterprise (robots.txt: Disallow: /*?p=*).
--              Concessionnaire Honda, Kawasaki, Husqvarna, Polaris, Talaria à Joliette.

INSERT INTO shared_scrapers (
  site_name,
  site_slug,
  site_url,
  site_domain,
  search_keywords,
  scraper_module,
  selectors,
  listing_urls,
  pagination_config,
  description,
  categories,
  vehicle_types,
  extracted_fields,
  is_active,
  last_verified_at,
  version
) VALUES (
  'Moto Ducharme',
  'moto-ducharme',
  'https://www.motoducharme.com/',
  'motoducharme.com',
  ARRAY['moto ducharme', 'motoducharme', 'ducharme', 'joliette', 'lanaudiere', 'lanaudière', 'honda', 'kawasaki', 'husqvarna', 'polaris', 'talaria', 'repentigny'],
  'moto_ducharme',
  '{
    "platform": "magento2",
    "discovery": {
      "method": "sitemap_xml",
      "sitemap_url": "https://www.motoducharme.com/pub/media/sitemap/sitemap_fr.xml",
      "product_url_pattern": "/fr/<slug>-cs-(w-get-)?<id>$",
      "listing_page1_fallback": true,
      "products_per_page": 36,
      "product_item_selector": "li.product-item, div.product-item",
      "product_link_selector": "a.product-item-link, a[href*=vehicules-]",
      "total_products_selector": "#toolbar-amount",
      "note": "La pagination ?p=N est bloquée par reCAPTCHA Enterprise — sitemap XML utilisé comme source principale."
    },
    "detail": {
      "title": "h1.page-title span, h1.page-title, h1",
      "brand": ".product-info-main (Fabricant: regex)",
      "model": ".product-info-main (Modèle: regex)",
      "year": ".product-info-main (Année: regex)",
      "inventory": ".product-info-main (Numéro inventaire: regex)",
      "mileage": ".product-info-main (Odomètre: regex)",
      "vehicle_type": ".product-info-main (Type: regex)",
      "price_sale": "Prix Moto Ducharme regex / .special-price .price",
      "price_regular": "Prix Régulier regex / .old-price .price",
      "image": ".fotorama__stage img, .gallery-placeholder img, meta[property=og:image]",
      "description": ".product.attribute.description .value",
      "specs": "table.data.table tr (th/td pairs)"
    },
    "domains": ["motoducharme.com"]
  }'::JSONB,
  '[
    {"url": "https://www.motoducharme.com/fr/vehicules-neufs", "type": "listing", "category": "inventaire", "etat": "neuf"},
    {"url": "https://www.motoducharme.com/fr/vehicules-d-occasion/motocyclettes", "type": "listing", "category": "occasion", "etat": "occasion"},
    {"url": "https://www.motoducharme.com/fr/vehicules-d-occasion/vtt", "type": "listing", "category": "occasion", "etat": "occasion"},
    {"url": "https://www.motoducharme.com/fr/vehicules-d-occasion/cotes-a-cotes", "type": "listing", "category": "occasion", "etat": "occasion"},
    {"url": "https://www.motoducharme.com/fr/vehicules-d-occasion/motoneiges", "type": "listing", "category": "occasion", "etat": "occasion"}
  ]'::JSONB,
  '{
    "type": "sitemap_xml",
    "sitemap_url": "https://www.motoducharme.com/pub/media/sitemap/sitemap_fr.xml",
    "per_page": 36,
    "note": "La pagination Magento ?p=N est bloquée par reCAPTCHA Enterprise (robots.txt: Disallow: /*?p=*). Découverte via sitemap XML (~1171 URLs produits canoniques) + listing page 1 (36 URLs par catégorie) pour déterminer neuf/occasion. L''état est aussi ré-évalué depuis kilométrage sur la page détail."
  }'::JSONB,
  'Concessionnaire powersports à Joliette, QC (Lanaudière), près de Repentigny. Honda, Kawasaki, Husqvarna, Polaris, Talaria. Motos, VTT, côte-à-côte, motoneiges, e-bike. Plateforme Magento 2. Entreprise familiale depuis 1961.',
  ARRAY['inventaire', 'occasion'],
  ARRAY['moto-standard', 'moto-sport', 'moto-custom', 'moto-trail', 'moto-competition', 'moto-double-usage', 'moto-grand-tourisme', 'moto-enfant', 'vtt', 'cote-a-cote', 'motoneige', 'e-bike'],
  ARRAY['name', 'prix', 'prix_regulier', 'marque', 'modele', 'annee', 'etat', 'kilometrage', 'couleur', 'image', 'inventaire', 'vehicule_type', 'description', 'cylindree', 'transmission', 'puissance', 'poids', 'reservoir', 'hauteur_selle', 'suspension_avant', 'suspension_arriere', 'abs', 'type_moteur', 'refroidissement'],
  TRUE,
  NOW(),
  '1.1'
)
ON CONFLICT (site_slug) DO UPDATE SET
  selectors = EXCLUDED.selectors,
  listing_urls = EXCLUDED.listing_urls,
  pagination_config = EXCLUDED.pagination_config,
  search_keywords = EXCLUDED.search_keywords,
  extracted_fields = EXCLUDED.extracted_fields,
  description = EXCLUDED.description,
  vehicle_types = EXCLUDED.vehicle_types,
  version = EXCLUDED.version,
  last_verified_at = NOW(),
  updated_at = NOW();
