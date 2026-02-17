"""
Configuration pour le scraper AI
Supporte à la fois Google AI API (dev) et Vertex AI (production)
"""
import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

# =============================================================================
# CONFIGURATION AI PROVIDER
# =============================================================================
# Utiliser "vertex" pour Vertex AI (production) ou "genai" pour Google AI API (dev)
AI_PROVIDER = os.environ.get("AI_PROVIDER", "vertex")

# Configuration Vertex AI (Production - Recommandé)
GCP_PROJECT_ID = os.environ.get("GCP_PROJECT_ID")
GCP_LOCATION = os.environ.get("GCP_LOCATION", "global")  # global = meilleure dispo
# Le fichier de credentials est optionnel si on utilise les Application Default Credentials
GOOGLE_APPLICATION_CREDENTIALS = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")

# Configuration Google AI API (Dev - Optionnel, fallback)
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY")

# Validation de la configuration
if AI_PROVIDER == "vertex":
    if not GCP_PROJECT_ID:
        raise ValueError(
            "GCP_PROJECT_ID est requis pour Vertex AI. "
            "Définissez-le dans votre fichier .env ou utilisez AI_PROVIDER=genai pour le dev."
        )
elif AI_PROVIDER == "genai":
    if not GEMINI_API_KEY:
        raise ValueError(
            "GEMINI_API_KEY est requis pour Google AI API. "
            "Définissez-le dans votre fichier .env ou utilisez AI_PROVIDER=vertex pour la production."
        )
else:
    raise ValueError(f"AI_PROVIDER invalide: {AI_PROVIDER}. Utilisez 'vertex' ou 'genai'.")

# =============================================================================
# MODÈLES GEMINI
# =============================================================================
# Pour l'analyse HTML et génération de scraper
MODEL_ANALYSIS = "gemini-2.0-flash-001"  # Version stable pour Vertex AI
MODEL_EXTRACTION = "gemini-1.5-flash-002"  # Pour l'extraction si nécessaire

# Version du prompt - Incrémenter cette valeur quand le prompt change
# Cela invalidera automatiquement tous les scrapers en cache
# Version 2.1: Correction boucle infinie pagination + limite sécurité
# Version 2.2: Correction UnboundLocalError pagination_info + initialisation variables
# Version 2.3: Simplification optimized_path (seulement chemin produits + méthode HTML)
# Version 2.4: Déduplication immédiate des URLs avec normalisation lors de l'ajout
# Version 2.5: Limite de 500 URLs avant passage à l'étape suivante
# Version 2.6: Extraction hybride - Utilise CSS/XPath d'abord, Gemini en fallback uniquement
# Version 2.7: Utilise fieldMappings détectés pour extraction CSS directe (pas de Gemini sauf fallback)
# Version 3.0: Extraction locale sans Gemini + URLs pré-découvertes par l'AI Agent
# Version 3.1: Correction erreur syntaxe avec '::attr(' dans le code généré
# Version 3.2: Correction erreur syntaxe avec 'page d\'accueil' - utilisation guillemets doubles
# Version 3.3: Génération de fichiers Python directement dans le cache
# Version 4.0: Architecture intelligente avec sélecteurs dynamiques et cache Supabase
# Version 4.1: Correction extraction prix multiples concaténés (ancien + nouveau prix)
# Version 4.2: Découpage intelligent des prix collés (ex: 113308995 → 8995)
PROMPT_VERSION = "4.2"

# Dossier de cache pour les scrapers générés
CACHE_DIR = Path(__file__).parent.parent / "scraper_cache"
CACHE_DIR.mkdir(exist_ok=True)

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
                "certifications": {"type": "array", "items": {"type": "string"}}
            }
        },
        "products": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "description": {"type": "string"},
                    "category": {
                        "type": "string",
                        "enum": ["moto", "motoneige", "motocross", "scooter", "quad", "side-by-side", "autre"]
                    },
                    "marque": {"type": "string"},
                    "modele": {"type": "string"},
                    "prix": {"type": "number"},
                    "prixReference": {"type": "number", "description": "Prix du même produit sur le site de référence"},
                    "differencePrix": {"type": "number", "description": "Différence de prix par rapport au site de référence (prix - prixReference)"},
                    "siteReference": {"type": "string", "description": "URL du site de référence utilisé pour la comparaison"},
                    "disponibilite": {
                        "type": "string",
                        "enum": ["en_stock", "sur_commande", "epuise", "non_disponible"]
                    },
                    "image": {"type": "string"},
                    "annee": {"type": "number"},
                    "kilometrage": {"type": "number"},
                    "cylindree": {"type": "string"},
                    "sourceUrl": {"type": "string"},
                    "sourceSite": {"type": "string", "description": "URL du site source du produit"},
                    "sourceCategorie": {
                        "type": "string",
                        "enum": ["inventaire", "catalogue", "vehicules_occasion"],
                        "description": "Catégorie indiquant si le véhicule est dans l'inventaire, le catalogue ou les véhicules d'occasion"
                    },
                    "etat": {
                        "type": "string",
                        "enum": ["neuf", "occasion", "demonstrateur"],
                        "description": "État/condition du véhicule: neuf (inventaire neuf ou catalogue), occasion (usagé/pre-owned), demonstrateur (démo)"
                    },
                    "attributes": {
                        "type": "object",
                        "properties": {
                            "couleur": {"type": "string"},
                            "etat": {"type": "string", "enum": ["neuf", "occasion", "demonstrateur"]},
                            "transmission": {"type": "string"},
                            "type_moteur": {"type": "string"}
                        }
                    }
                },
                "required": ["category", "marque", "modele", "prix", "disponibilite", "sourceCategorie", "etat"]
            }
        }
    },
    "required": ["companyInfo", "products"]
}

# Schéma pour l'analyse HTML et génération de scraper
SCRAPER_GENERATION_SCHEMA = {
    "type": "object",
    "properties": {
        "siteAnalysis": {
            "type": "object",
            "properties": {
                "siteName": {"type": "string", "description": "Nom du site analysé"},
                "siteUrl": {"type": "string", "description": "URL de base du site"},
                "structureType": {
                    "type": "string",
                    "enum": ["listing_page", "detail_page", "mixed", "spa"],
                    "description": "Type de structure du site"
                },
                "paginationStrategy": {
                    "type": "object",
                    "properties": {
                        "type": {
                            "type": "string",
                            "enum": ["url_params", "next_button", "infinite_scroll", "none"],
                            "description": "Type de pagination utilisé"
                        },
                        "pattern": {"type": "string", "description": "Pattern pour les URLs de pagination (ex: ?page={n})"},
                        "maxPages": {"type": "number", "description": "Nombre maximum de pages estimé"},
                        "selector": {"type": "string", "description": "Sélecteur CSS/XPath pour le bouton suivant"}
                    }
                },
                "productListSelector": {
                    "type": "string",
                    "description": "Sélecteur CSS/XPath pour la liste des produits"
                },
                "productDetailSelector": {
                    "type": "string",
                    "description": "Sélecteur CSS/XPath pour les détails d'un produit"
                }
            },
            "required": ["siteName", "siteUrl", "structureType"]
        },
        "fieldMappings": {
            "type": "object",
            "description": "Mapping de chaque champ du schéma vers le HTML",
            "properties": {
                "companyInfo": {
                    "type": "object",
                    "properties": {
                        "name": {"type": "string", "description": "Sélecteur ou méthode pour extraire le nom"},
                        "description": {"type": "string"},
                        "email": {"type": "string"},
                        "phone": {"type": "string"},
                        "address": {"type": "string"},
                        "logo": {"type": "string"},
                        "website": {"type": "string"},
                        "certifications": {"type": "string"}
                    }
                },
                "products": {
                    "type": "object",
                    "properties": {
                        "name": {"type": "string"},
                        "description": {"type": "string"},
                        "category": {"type": "string"},
                        "marque": {"type": "string"},
                        "modele": {"type": "string"},
                        "prix": {"type": "string"},
                        "disponibilite": {"type": "string"},
                        "image": {"type": "string"},
                        "annee": {"type": "string"},
                        "kilometrage": {"type": "string"},
                        "cylindree": {"type": "string"},
                        "sourceUrl": {"type": "string"},
                        "sourceCategorie": {"type": "string"},
                        "attributes": {
                            "type": "object",
                            "properties": {
                                "couleur": {"type": "string"},
                                "etat": {"type": "string"},
                                "transmission": {"type": "string"},
                                "type_moteur": {"type": "string"}
                            }
                        }
                    }
                }
            },
            "required": ["products"]
        },
        "scraperCode": {
            "type": "string",
            "description": "Code Python COMPLET avec URLs et sélecteurs HARDCODÉS. Le script doit contenir: 1) Liste PRODUCT_URLS avec toutes les URLs découvertes hardcodées, 2) Dictionnaire SELECTORS avec tous les sélecteurs CSS détectés hardcodés, 3) Code d'extraction local utilisant ces sélecteurs. PAS d'explications, PAS de markdown, UNIQUEMENT du code Python exécutable. Le script doit être COMPLÈTEMENT AUTONOME - pas besoin de exploration_result ou field_mappings au runtime."
        },
        "reasoning": {
            "type": "string",
            "description": "Explication de l'analyse et des choix de sélecteurs"
        }
    },
    "required": ["siteAnalysis", "fieldMappings", "scraperCode", "reasoning"]
}
