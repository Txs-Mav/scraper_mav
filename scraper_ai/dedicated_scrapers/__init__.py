"""
Scrapers dédiés avec sélecteurs hardcodés.
Pas besoin de Gemini — chaque module connaît son site par coeur.
"""
from .registry import DedicatedScraperRegistry, get_registry

__all__ = ['DedicatedScraperRegistry', 'get_registry']
