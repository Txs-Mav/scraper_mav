"""Adapters de recherche pour différentes sources."""
from .base import SearchAdapter, AdapterError  # noqa: F401
from .dedicated import DedicatedScraperAdapter  # noqa: F401
from .shopify import ShopifySearchAdapter, build_shopify_adapters_for, is_shopify_store  # noqa: F401
from .ebay import EbayBrowseAdapter  # noqa: F401
from .kijiji import KijijiAdapter  # noqa: F401
from .amazon import AmazonAdapter  # noqa: F401

# Marketplaces e-commerce
from .bestbuy import BestBuyAdapter  # noqa: F401
from .walmart import WalmartAdapter  # noqa: F401
from .costco import CostcoAdapter  # noqa: F401
from .lespac import LesPacAdapter  # noqa: F401

# Marketplaces véhicules
from .autotrader import AutoTraderAdapter  # noqa: F401
from .cycletrader import CycleTraderAdapter  # noqa: F401

# Réseaux sociaux (auth requise)
from .facebook_marketplace import FacebookMarketplaceAdapter  # noqa: F401

# Adapter générique : domaines fournis explicitement par l'utilisateur
# (concessionnaires sans scraper dédié, partenaires custom, etc.)
from .generic_dealer import GenericDealerAdapter, build_generic_dealer_adapters  # noqa: F401
