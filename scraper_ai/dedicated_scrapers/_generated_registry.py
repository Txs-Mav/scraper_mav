# AUTO-GENERE par scraper_usine. Ne pas modifier.
GENERATED_SCRAPERS = {}
GENERATED_DOMAINS = {}

try:
    from .st_onge_ford import StOngeFordScraper
    GENERATED_SCRAPERS['st-onge-ford'] = StOngeFordScraper
    GENERATED_DOMAINS['st-onge-ford.com'] = 'st-onge-ford'
except ImportError:
    pass

