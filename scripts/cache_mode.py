"""
Feature flag côté Python — miroir de dashboard_web/src/lib/feature-flags.ts

Quand CACHE_MODE_ENABLED = True :
  - Le scraper_cron.py scrape tous les sites universels en background
  - Le alert_cron.py SKIP le scraping par utilisateur (redondant)
  - "Analyser maintenant" lit depuis scraped_site_data (instantané)

Quand CACHE_MODE_ENABLED = False :
  - Le alert_cron.py scrape normalement pour chaque utilisateur
  - "Analyser maintenant" lance un scraping parallèle classique
"""

CACHE_MODE_ENABLED = True
