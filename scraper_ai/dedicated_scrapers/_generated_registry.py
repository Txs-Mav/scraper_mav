# AUTO-GENERE par scraper_usine. Ne pas modifier.
GENERATED_SCRAPERS = {}
GENERATED_DOMAINS = {}

try:
    from .st_onge_ford import StOngeFordScraper
    GENERATED_SCRAPERS['st-onge-ford'] = StOngeFordScraper
    GENERATED_DOMAINS['st-onge-ford.com'] = 'st-onge-ford'
except Exception:
    pass

try:
    from .adrenalinesports import AdrenalinesportsScraper
    GENERATED_SCRAPERS['adrenalinesports'] = AdrenalinesportsScraper
    GENERATED_DOMAINS['adrenalinesports.ca'] = 'adrenalinesports'
except Exception:
    pass

# smsport : promu dans registry.py (réécrit à la main le 2026-08-11) —
# retiré d'ici car GENERATED_SCRAPERS est mergé APRÈS _SCRAPERS et
# écraserait l'entrée principale.

try:
    from .excelmoto import ExcelmotoScraper
    GENERATED_SCRAPERS['excelmoto'] = ExcelmotoScraper
    GENERATED_DOMAINS['excelmoto.com'] = 'excelmoto'
except Exception:
    pass

