"""
Module de détection automatique des sélecteurs CSS via Gemini
Analyse le HTML d'un site et génère les sélecteurs spécifiques
"""
import json
import re
from typing import Dict, List, Optional, Any
from bs4 import BeautifulSoup

try:
    from .gemini_client import GeminiClient
    from .config import MODEL_ANALYSIS
except ImportError:
    from gemini_client import GeminiClient
    from config import MODEL_ANALYSIS


# Schéma JSON pour la détection des sélecteurs
SELECTOR_DETECTION_SCHEMA = {
    "type": "object",
    "properties": {
        "selectors": {
            "type": "object",
            "description": "Sélecteurs CSS détectés pour chaque champ",
            "properties": {
                "product_container": {
                    "type": "string",
                    "description": "Sélecteur CSS pour le conteneur de chaque produit (ex: .product-card, .vehicle-item)"
                },
                "name": {
                    "type": "string",
                    "description": "Sélecteur CSS pour le nom du produit (relatif au conteneur)"
                },
                "price": {
                    "type": "string",
                    "description": "Sélecteur CSS pour le prix (relatif au conteneur)"
                },
                "image": {
                    "type": "string",
                    "description": "Sélecteur CSS pour l'image (relatif au conteneur)"
                },
                "link": {
                    "type": "string",
                    "description": "Sélecteur CSS pour le lien vers la page détail (relatif au conteneur)"
                },
                "brand": {
                    "type": "string",
                    "description": "Sélecteur CSS pour la marque (optionnel)"
                },
                "model": {
                    "type": "string",
                    "description": "Sélecteur CSS pour le modèle (optionnel)"
                },
                "year": {
                    "type": "string",
                    "description": "Sélecteur CSS pour l'année (optionnel)"
                },
                "mileage": {
                    "type": "string",
                    "description": "Sélecteur CSS pour le kilométrage (optionnel)"
                },
                "availability": {
                    "type": "string",
                    "description": "Sélecteur CSS pour la disponibilité (optionnel)"
                },
                "condition": {
                    "type": "string",
                    "description": "Sélecteur CSS pour l'état/condition du véhicule: neuf, usagé, occasion, démonstrateur (optionnel, souvent un badge ou label)"
                }
            },
            "required": ["product_container", "name", "price", "image", "link"]
        },
        "pagination": {
            "type": "object",
            "properties": {
                "type": {
                    "type": "string",
                    "enum": ["url_params", "next_button", "infinite_scroll", "load_more", "none"],
                    "description": "Type de pagination détecté"
                },
                "next_button_selector": {
                    "type": "string",
                    "description": "Sélecteur CSS pour le bouton suivant (si applicable)"
                },
                "url_pattern": {
                    "type": "string",
                    "description": "Pattern d'URL pour la pagination (ex: ?page={n}, /page/{n}/)"
                }
            },
            "required": ["type"]
        },
        "site_info": {
            "type": "object",
            "properties": {
                "site_name": {"type": "string"},
                "structure_type": {
                    "type": "string",
                    "enum": ["listing_page", "detail_page", "mixed", "spa"]
                },
                "requires_javascript": {"type": "boolean"},
                "inventory_urls": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "URLs des pages d'inventaire détectées"
                }
            }
        },
        "extraction_notes": {
            "type": "string",
            "description": "Notes sur l'extraction (particularités du site, fallbacks nécessaires)"
        }
    },
    "required": ["selectors", "pagination", "site_info"]
}


class SelectorDetector:
    """Détecte les sélecteurs CSS d'un site via Gemini"""

    def __init__(self):
        self.gemini_client = GeminiClient()

    def detect_selectors(
        self,
        html_samples: Dict[str, str],
        base_url: str,
        existing_selectors: Optional[Dict] = None
    ) -> Dict[str, Any]:
        """Détecte les sélecteurs CSS à partir d'échantillons HTML

        Args:
            html_samples: Dict {url: html_content} avec des échantillons de pages
            base_url: URL de base du site
            existing_selectors: Sélecteurs existants à valider/améliorer (optionnel)

        Returns:
            Dict avec selectors, pagination, site_info, extraction_notes
        """
        print(f"\n🎯 DÉTECTION DES SÉLECTEURS CSS")
        print(f"   Site: {base_url}")
        print(f"   Échantillons: {len(html_samples)} pages")

        # Préparer les échantillons HTML (limiter la taille)
        prepared_samples = self._prepare_html_samples(html_samples)

        # Construire le prompt
        prompt = self._build_detection_prompt(
            prepared_samples, base_url, existing_selectors)

        # Appeler Gemini
        try:
            result = self.gemini_client.call(
                prompt=prompt,
                schema=SELECTOR_DETECTION_SCHEMA,
                model=MODEL_ANALYSIS,
                show_prompt=False
            )

            if result:
                print(f"   ✅ Sélecteurs détectés avec succès")
                self._log_detected_selectors(result)
                return result
            else:
                print(f"   ⚠️ Aucun sélecteur détecté, utilisation des fallbacks")
                return self._get_fallback_selectors()

        except Exception as e:
            print(f"   ❌ Erreur détection: {e}")
            return self._get_fallback_selectors()

    def _prepare_html_samples(self, html_samples: Dict[str, str], max_chars: int = 50000) -> str:
        """Prépare les échantillons HTML pour le prompt (limite la taille)"""
        prepared = []
        total_chars = 0

        for url, html in html_samples.items():
            if total_chars >= max_chars:
                break

            # Parser et nettoyer le HTML
            soup = BeautifulSoup(html, 'html.parser')

            # Supprimer les scripts et styles
            for tag in soup(['script', 'style', 'noscript', 'svg', 'path']):
                tag.decompose()

            # Garder seulement le body
            body = soup.find('body')
            if body:
                clean_html = str(body)
            else:
                clean_html = str(soup)

            # Limiter la taille par échantillon
            max_per_sample = max_chars // max(len(html_samples), 1)
            if len(clean_html) > max_per_sample:
                clean_html = clean_html[:max_per_sample] + "... [TRUNCATED]"

            prepared.append(f"=== URL: {url} ===\n{clean_html}\n")
            total_chars += len(clean_html)

        return "\n".join(prepared)

    def _build_detection_prompt(
        self,
        html_samples: str,
        base_url: str,
        existing_selectors: Optional[Dict] = None
    ) -> str:
        """Construit le prompt pour la détection des sélecteurs"""

        existing_info = ""
        if existing_selectors:
            existing_info = f"""
## SÉLECTEURS EXISTANTS (à valider/améliorer)
```json
{json.dumps(existing_selectors, indent=2)}
```

Vérifie si ces sélecteurs fonctionnent toujours avec le HTML fourni.
Si oui, conserve-les. Sinon, propose des alternatives.
"""

        return f"""# MISSION: Détection des Sélecteurs CSS

Tu es un expert en web scraping. Analyse le HTML suivant et détecte les sélecteurs CSS pour extraire les produits.

## SITE
URL de base: {base_url}

## CONTEXTE
Ce site vend des véhicules (motos, motoneiges, quads, etc.).
On veut extraire: nom, prix, image, lien vers la page détail, marque, modèle, année, et ÉTAT/CONDITION (neuf, usagé/occasion, démonstrateur).

## RÈGLES IMPORTANTES

1. **Sélecteurs CSS valides**:
   - Utilise des sélecteurs CSS standards (pas de XPath)
   - Préfère les classes (.class) aux IDs (#id) car plus stables
   - Les sélecteurs doivent être RELATIFS au conteneur produit

2. **Conteneur produit**:
   - Identifie le conteneur qui englobe chaque produit
   - Souvent: .product-card, .vehicle-item, .inventory-item, article, etc.

3. **Prix**:
   - Cherche les classes contenant "price", "prix", "cost", "amount"
   - Attention aux prix barrés vs prix actuels

4. **Images**:
   - Cherche img avec src ou data-src
   - Préfère les images principales (pas les thumbnails)

5. **Condition/État du véhicule**:
   - Cherche les badges, labels, ou textes indiquant: "Neuf", "Usagé", "Occasion", "Démonstrateur", "Used", "New", "Demo"
   - Souvent dans des badges ([class*="badge"]), labels, ou spans avec des classes comme "condition", "etat", "status", "type"
   - Aussi dans les breadcrumbs ou catégories (ex: "Inventaire neuf", "Véhicules d'occasion")

6. **Pagination**:
   - Identifie le type: URL params (?page=2), bouton next, scroll infini
   - Si bouton next, donne le sélecteur

{existing_info}

## HTML À ANALYSER
{html_samples}

## RÉPONSE ATTENDUE
Retourne un JSON avec:
- selectors: les sélecteurs CSS détectés
- pagination: type et sélecteur si applicable
- site_info: informations sur le site
- extraction_notes: notes importantes pour l'extraction

IMPORTANT: Les sélecteurs doivent être TESTÉS sur le HTML fourni.
"""

    def _log_detected_selectors(self, result: Dict):
        """Affiche les sélecteurs détectés"""
        selectors = result.get('selectors', {})
        print(f"\n   📋 Sélecteurs détectés:")
        for key, value in selectors.items():
            if value:
                print(f"      {key}: {value}")

        pagination = result.get('pagination', {})
        print(f"\n   📑 Pagination: {pagination.get('type', 'none')}")
        if pagination.get('next_button_selector'):
            print(
                f"      Bouton suivant: {pagination['next_button_selector']}")
        if pagination.get('url_pattern'):
            print(f"      Pattern URL: {pagination['url_pattern']}")

    def _get_fallback_selectors(self) -> Dict[str, Any]:
        """Retourne des sélecteurs par défaut en cas d'échec"""
        return {
            "selectors": {
                "product_container": ".product-card, .vehicle-item, .inventory-item, article[class*='product']",
                "name": "h2, h3, .title, .name, [class*='title'], [class*='name']",
                "price": ".price, .prix, [class*='price'], [class*='prix']",
                "image": "img",
                "link": "a[href]",
                "brand": "[class*='brand'], [class*='marque'], [class*='make']",
                "model": "[class*='model'], [class*='modele']",
                "year": "[class*='year'], [class*='annee'], [class*='year']",
                "mileage": "[class*='mileage'], [class*='kilometrage'], [class*='km']",
                "availability": "[class*='stock'], [class*='disponib'], [class*='avail']",
                "condition": "[class*='condition'], [class*='etat'], [class*='badge'], [class*='status'], [class*='type']"
            },
            "pagination": {
                "type": "url_params",
                "url_pattern": "?page={n}"
            },
            "site_info": {
                "site_name": "Unknown",
                "structure_type": "listing_page",
                "requires_javascript": False,
                "inventory_urls": []
            },
            "extraction_notes": "Sélecteurs par défaut - extraction peut nécessiter ajustements"
        }

    def validate_selectors(self, html: str, selectors: Dict[str, str]) -> Dict[str, bool]:
        """Valide que les sélecteurs fonctionnent sur le HTML donné

        Returns:
            Dict {selector_name: is_valid}
        """
        soup = BeautifulSoup(html, 'html.parser')
        results = {}

        for name, selector in selectors.items():
            if not selector:
                results[name] = False
                continue

            try:
                # Essayer de trouver des éléments avec ce sélecteur
                elements = soup.select(selector)
                results[name] = len(elements) > 0
            except Exception:
                results[name] = False

        return results

    def extract_with_selectors(
        self,
        html: str,
        selectors: Dict[str, str],
        base_url: str
    ) -> List[Dict]:
        """Extrait les produits en utilisant les sélecteurs détectés

        Args:
            html: HTML de la page
            selectors: Sélecteurs CSS
            base_url: URL de base pour résoudre les liens relatifs

        Returns:
            Liste de produits extraits avec etat et sourceCategorie détectés
        """
        from urllib.parse import urljoin

        soup = BeautifulSoup(html, 'html.parser')
        products = []

        # Trouver tous les conteneurs de produits
        container_selector = selectors.get('product_container', '')
        if not container_selector:
            return products

        containers = soup.select(container_selector)

        for container in containers:
            product = {}

            # Extraire chaque champ
            for field, selector in selectors.items():
                if field == 'product_container' or not selector:
                    continue

                try:
                    element = container.select_one(selector)
                    if element:
                        if field == 'image':
                            # Pour les images, prendre src ou data-src
                            img_url = element.get('src') or element.get(
                                'data-src') or element.get('data-lazy-src')
                            if img_url:
                                product['image'] = urljoin(base_url, img_url)
                        elif field == 'link':
                            # Pour les liens, prendre href
                            href = element.get('href')
                            if href:
                                product['sourceUrl'] = urljoin(base_url, href)
                        elif field == 'price':
                            # Pour le prix, nettoyer et convertir
                            price_text = element.get_text(strip=True)
                            price = self._parse_price(price_text)
                            if price:
                                product['prix'] = price
                        elif field == 'year':
                            # Pour l'année, extraire le nombre
                            year_text = element.get_text(strip=True)
                            year = self._parse_year(year_text)
                            if year:
                                product['annee'] = year
                        elif field == 'condition':
                            # Pour l'état/condition, mapper vers etat
                            text = element.get_text(strip=True).lower()
                            if text:
                                etat = self._parse_condition(text)
                                if etat:
                                    product['etat'] = etat
                        else:
                            # Pour les autres champs, prendre le texte
                            text = element.get_text(strip=True)
                            if text:
                                # Mapper les noms de champs
                                field_mapping = {
                                    'name': 'name',
                                    'brand': 'marque',
                                    'model': 'modele',
                                    'mileage': 'kilometrage',
                                    'availability': 'disponibilite'
                                }
                                product[field_mapping.get(field, field)] = text
                except Exception:
                    continue

            # ── Détection de l'état depuis l'URL du produit ──
            # L'URL du produit contient souvent l'état (neuf, usage, occasion)
            if not product.get('etat'):
                product_url = product.get('sourceUrl', '')
                etat_from_url = self._detect_etat_from_url(product_url)
                if etat_from_url:
                    product['etat'] = etat_from_url

            # ── Détection de l'état depuis le texte du container ──
            if not product.get('etat'):
                container_text = container.get_text(separator=' ', strip=True).lower()
                etat_from_text = self._detect_etat_from_text(container_text)
                if etat_from_text:
                    product['etat'] = etat_from_text

            # ── Détection du sourceCategorie depuis l'URL du produit ──
            if not product.get('sourceCategorie'):
                product_url = product.get('sourceUrl', '')
                source_cat = self._detect_source_categorie_from_url(product_url)
                if source_cat:
                    product['sourceCategorie'] = source_cat

            # Ajouter le produit s'il a au moins un nom ou un prix
            if product.get('name') or product.get('prix'):
                product['sourceSite'] = base_url
                products.append(product)

        return products

    def _parse_condition(self, text: str) -> Optional[str]:
        """Parse un texte de condition en valeur normalisée (neuf, occasion, demonstrateur)"""
        if not text:
            return None
        text = text.lower().strip()
        
        if any(x in text for x in ['usagé', 'usag', 'occasion', 'used', 'pre-owned', 'pré-possédé', 'pre-possede', 'seconde main']):
            return 'occasion'
        elif any(x in text for x in ['démonstrateur', 'demonstrateur', 'démo', 'demo']):
            return 'demonstrateur'
        elif any(x in text for x in ['neuf', 'new', 'nouveau']):
            return 'neuf'
        return None

    def _detect_etat_from_url(self, url: str) -> Optional[str]:
        """Détecte l'état du produit depuis son URL
        
        Les sites de concessionnaires encodent souvent l'état dans l'URL:
        - /usage/ ou /used/ ou /occasion/ → occasion
        - /neuf/ ou /new/ → neuf
        - /demo/ → demonstrateur
        """
        if not url:
            return None
        url_lower = url.lower()
        
        # Patterns URL pour occasion/usagé
        if any(x in url_lower for x in ['/usage/', '/used/', '/occasion/', '/pre-owned/',
                                          '/usag', '/d-occasion/', '/pre-possede/',
                                          '-usage-', '-used-', '-occasion-',
                                          'vehicules-occasion', 'vehicule-occasion',
                                          'inventaire-usage']):
            return 'occasion'
        
        # Patterns URL pour démonstrateur
        if any(x in url_lower for x in ['/demo/', '/demonstrat/', '-demo-', '-demonstr-',
                                          'demonstrateur']):
            return 'demonstrateur'
        
        # Patterns URL pour neuf
        if any(x in url_lower for x in ['/neuf/', '/new/', '-neuf-', '-new-',
                                          'inventaire-neuf']):
            return 'neuf'
        
        return None

    def _detect_etat_from_text(self, text: str) -> Optional[str]:
        """Détecte l'état depuis le texte visible du container produit"""
        if not text:
            return None
        
        import re
        # Chercher des mots-clés d'état encadrés par des espaces ou limites de mots
        # pour éviter les faux positifs (ex: "neuf" dans "neufly")
        if re.search(r'\b(usagé|usag[eé]|occasion|used|pre-owned|pré-possédé)\b', text):
            return 'occasion'
        if re.search(r'\b(démonstrateur|demonstrateur|démo|demo unit)\b', text):
            return 'demonstrateur'
        if re.search(r'\b(neuf|brand new)\b', text):
            return 'neuf'
        
        return None

    def _detect_source_categorie_from_url(self, url: str) -> Optional[str]:
        """Détecte le sourceCategorie depuis l'URL du produit"""
        if not url:
            return None
        url_lower = url.lower()
        
        if any(x in url_lower for x in ['occasion', 'used', 'pre-owned', 'usag', 'd-occasion',
                                          'pre-possede', 'seconde-main']):
            return 'vehicules_occasion'
        elif any(x in url_lower for x in ['catalogue', 'catalog', 'showroom', 'gamme',
                                            '/models/', '/modeles/']):
            return 'catalogue'
        elif any(x in url_lower for x in ['inventaire', 'inventory', 'stock', 'en-stock',
                                            'a-vendre', 'for-sale']):
            return 'inventaire'
        
        return None

    def _parse_price(self, price_text: str) -> Optional[float]:
        """Parse un texte de prix en nombre

        Gère les cas où il y a plusieurs prix (prix barré + prix actuel)
        en extrayant le DERNIER prix (qui est généralement le prix actuel affiché)
        """
        if not price_text:
            return None

        # Chercher tous les patterns de prix dans le texte (dans l'ordre d'apparition)
        # Patterns: $1234, 1234$, 1234.56$, $1,234.56, 1 234,56 $, etc.
        price_patterns = [
            r'\$\s*([\d\s,]+(?:\.\d{2})?)',  # $1234.56 ou $1,234.56
            r'([\d\s,]+(?:\.\d{2})?)\s*\$',  # 1234.56$ ou 1,234.56$
            r'([\d\s,]+(?:,\d{2})?)\s*(?:CAD|USD|EUR|€)',  # 1234,56 CAD
            # Nombre avec séparateurs
            r'(\d{1,3}(?:[\s,]\d{3})*(?:[.,]\d{2})?)',
        ]

        all_prices = []

        for pattern in price_patterns:
            for match in re.finditer(pattern, price_text):
                price = self._clean_price_string(match.group(
                    1) if match.lastindex else match.group(0))
                # Prix raisonnable (1$ à 10M$) — ne PAS filtrer trop strictement
                # Les prix des accessoires et petits véhicules peuvent être bas
                if price and 1 < price < 10000000:
                    all_prices.append((match.start(), price))

        # Si aucun prix trouvé avec les patterns, essayer l'extraction simple
        if not all_prices:
            # Séparer par espaces et chercher des nombres
            current_pos = 0
            for part in price_text.split():
                cleaned = re.sub(r'[^\d.,]', '', part)
                if cleaned:
                    price = self._clean_price_string(cleaned)
                    if price and 1 < price < 10000000:
                        all_prices.append((current_pos, price))
                current_pos += len(part) + 1

        if not all_prices:
            return None

        # Trier par position et retourner le DERNIER prix (prix actuel)
        all_prices.sort(key=lambda x: x[0])
        return all_prices[-1][1]

    def _clean_price_string(self, price_str: str) -> Optional[float]:
        """Nettoie une chaîne de prix et la convertit en float"""
        if not price_str:
            return None

        # Supprimer les espaces
        cleaned = price_str.replace(' ', '').replace('\u00a0', '')

        # Supprimer les caractères non numériques sauf . et ,
        cleaned = re.sub(r'[^\d.,]', '', cleaned)

        if not cleaned:
            return None

        # Gérer les formats français (1 234,56) et anglais (1,234.56)
        if ',' in cleaned and '.' in cleaned:
            # Format mixte - déterminer lequel est le séparateur décimal
            if cleaned.rindex(',') > cleaned.rindex('.'):
                # Format français: 1.234,56
                cleaned = cleaned.replace('.', '').replace(',', '.')
            else:
                # Format anglais: 1,234.56
                cleaned = cleaned.replace(',', '')
        elif ',' in cleaned:
            # Vérifier si c'est un séparateur de milliers ou décimal
            parts = cleaned.split(',')
            if len(parts) == 2 and len(parts[1]) == 2:
                # Probablement décimal: 1234,56
                cleaned = cleaned.replace(',', '.')
            else:
                # Probablement milliers: 1,234
                cleaned = cleaned.replace(',', '')

        try:
            return float(cleaned)
        except ValueError:
            return None

    def _parse_year(self, year_text: str) -> Optional[int]:
        """Parse un texte d'année en nombre"""
        if not year_text:
            return None

        # Chercher un nombre à 4 chiffres commençant par 19 ou 20
        match = re.search(r'(19|20)\d{2}', year_text)
        if match:
            return int(match.group())

        return None
