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

try:
    from .smsport import SmsportScraper
    GENERATED_SCRAPERS['smsport'] = SmsportScraper
    GENERATED_DOMAINS['smsport.ca'] = 'smsport'
except Exception:
    pass

try:
    from .machinexperts import MachinexpertsScraper
    GENERATED_SCRAPERS['machinexperts'] = MachinexpertsScraper
except Exception:
    pass

try:
    from .hyundaitr import HyundaitrScraper
    GENERATED_SCRAPERS['hyundaitr'] = HyundaitrScraper
    GENERATED_DOMAINS['hyundaitr.com'] = 'hyundaitr'
except Exception:
    pass

try:
    from .bmwlaval import BmwLavalScraper
    GENERATED_SCRAPERS['bmwlaval'] = BmwLavalScraper
except Exception:
    pass

