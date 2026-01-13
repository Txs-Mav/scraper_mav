#!/usr/bin/env python3
"""
Script d'entrée simple pour exécuter le scraper
"""
import sys
import os
from pathlib import Path

# Ajouter le répertoire parent au PYTHONPATH pour que Python trouve le module scraper
project_root = Path(__file__).parent
sys.path.insert(0, str(project_root))

# Maintenant on peut importer le module scraper
from scraper.main import main

if __name__ == "__main__":
    main()

