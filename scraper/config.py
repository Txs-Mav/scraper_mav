"""
Configuration et constantes pour le scraper
"""
import os
from pathlib import Path
from dotenv import load_dotenv

# Charger .env.local depuis le répertoire racine du projet
project_root = Path(__file__).parent.parent.parent
env_file = project_root / ".env.local"
load_dotenv(env_file)

# Configuration Gemini
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY")
if not GEMINI_API_KEY:
    raise ValueError("GEMINI_API_KEY environment variable is required")

# Modèles Gemini - utiliser flash pour la sélection (rapide) et pro pour l'extraction (précis)
MODEL_SELECTION = "gemini-flash-lite-latest"  # Pour la sélection de pages (rapide)
MODEL_EXTRACTION = "gemini-flash-latest"  # Pour l'extraction finale (précis)
MODEL = MODEL_EXTRACTION  # Par défaut pour compatibilité

# Limites de scraping
MAX_PAGES_TO_VISIT = 5  # Limite stricte pour accélérer le scraping (5 pages max)
MAX_DEPTH = 1  # Profondeur minimale - rester sur les pages principales uniquement
MIN_PRODUCTS_TARGET = 15  # Objectif ajusté pour 5 pages (réaliste)
MIN_COMPANY_INFO_FIELDS = 3  # Objectif ajusté pour 5 pages (réaliste)
MAX_IMAGES = 200  # Limite d'images pour Gemini
MAX_IMAGE_SIZE_MB = 4  # Taille max par image (MB)
MAX_TOTAL_SIZE_MB = 20  # Taille totale max pour inline images (MB)

# Schéma JSON pour l'extraction
EXTRACTION_SCHEMA = {
    "type": "object",
    "properties": {
        "companyInfo": {
            "type": "object",
            "properties": {
                "name": {"type": "string"},
                "description": {"type": "string"},
                "email": {"type": "string"},
                "phone": {"type": "string"},
                "address": {"type": "string"},
                "logo": {"type": "string"},
                "website": {"type": "string"},
                "certifications": {"type": "array", "items": {"type": "string"}},
                "storageType": {"type": "string", "enum": ["ambient", "chilled", "frozen"]}
            }
        },
        "products": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "description": {"type": "string"},
                    "pricePickup": {"type": "number"},
                    "priceStudent": {"type": "number"},
                    "priceFinal": {"type": "number"},
                    "image": {"type": "string"},
                    "ingredientsImage": {"type": "string"},
                    "nutritionImage": {"type": "string"},
                    "ingredientsText": {"type": "string"},
                    "nutritionText": {"type": "string"},
                    "unitSize": {"type": "string"},
                    "casePack": {"type": "string"},
                    "pallet": {
                        "type": "object",
                        "properties": {
                            "ti": {"type": "number"},
                            "hi": {"type": "number"}
                        }
                    },
                    "refrigerated": {"type": "boolean"},
                    "allergens": {"type": "array", "items": {"type": "string"}},
                    "category": {"type": "string"},
                    "sourceUrl": {"type": "string"},
                    "attributes": {
                        "type": "object",
                        "properties": {
                            "freezable": {"type": "boolean"},
                            "glutenFree": {"type": "boolean"},
                            "vegetarian": {"type": "boolean"},
                            "vegan": {"type": "boolean"},
                            "nutFree": {"type": "boolean"},
                            "halal": {"type": "boolean"},
                            "kosher": {"type": "boolean"},
                            "organic": {"type": "boolean"},
                            "quebecProduct": {"type": "boolean"}
                        }
                    }
                }
            }
        }
    },
    "required": ["companyInfo", "products"]
}

# Schéma pour la sélection de pages
PAGE_SELECTION_SCHEMA = {
    "type": "object",
    "properties": {
        "selectedPages": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Liste des URLs sélectionnées (maximum 5)",
            "minItems": 1,
            "maxItems": 5
        },
        "reasoning": {
            "type": "string",
            "description": "Explication de la sélection"
        },
        "contactInfo": {
            "type": "object",
            "properties": {
                "email": {"type": "string"},
                "phone": {"type": "string"},
                "address": {"type": "string"}
            }
        }
    },
    "required": ["selectedPages", "contactInfo", "reasoning"]
}

# Schéma pour le filtrage d'images
IMAGE_FILTER_SCHEMA = {
    "type": "object",
    "properties": {
        "logoImage": {
            "type": "object",
            "properties": {
                "url": {"type": "string"},
                "reason": {"type": "string"}
            },
            "description": "Le logo principal de l'entreprise (un seul, le meilleur)"
        },
        "productImages": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "url": {"type": "string"},
                    "productName": {"type": "string"},
                    "reason": {"type": "string"}
                }
            },
            "description": "Liste des images de produits individuels (pas de catégories, pas de doublons)"
        },
        "reasoning": {
            "type": "string",
            "description": "Explication du filtrage"
        }
    },
    "required": ["logoImage", "productImages", "reasoning"]
}

# Formats d'images supportés par Gemini
SUPPORTED_IMAGE_MIMES = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/heic', 'image/heif']

