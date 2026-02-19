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


# ── Constants for CSS selector auto-discovery ──

_PRICE_PATTERN = re.compile(
    r'[\$€]\s*[\d\s,\.]+|[\d\s,\.]+\s*[\$€]|[\d\s,\.]+\s*(?:CAD|USD)',
    re.IGNORECASE,
)

_PRICE_EXCLUDE_KEYWORDS = frozenset([
    'old', 'was', 'msrp', 'list-price', 'regular', 'compare',
    'original', 'crossed', 'line-through', 'strike', 'barr',
    'strikethrough', 'previous', 'ancien',
])

_UTILITY_CLASS_PREFIXES = (
    'js-', 'col-', 'text-', 'font-', 'bg-', 'border-', 'rounded-', 'shadow-',
    'p-', 'px-', 'py-', 'pt-', 'pb-', 'pl-', 'pr-',
    'm-', 'mx-', 'my-', 'mt-', 'mb-', 'ml-', 'mr-',
    'w-', 'h-', 'min-w-', 'max-w-', 'min-h-', 'max-h-',
    'space-', 'gap-', 'leading-', 'tracking-',
    'opacity-', 'z-', 'overflow-', 'cursor-',
    'transition-', 'duration-', 'ease-', 'animate-',
    'items-', 'justify-', 'self-', 'order-',
    'float-', 'sr-only', 'aspect-',
)

_SPEC_LABELS = {
    'brand': ['make', 'marque', 'brand', 'manufacturer', 'manufacturier', 'fabricant'],
    'model': ['model', 'modèle', 'modele'],
    'year': ['year', 'année', 'annee'],
    'mileage': ['mileage', 'kilométrage', 'kilometrage', 'km', 'odometer', 'odomètre'],
}

_LOGO_KEYWORDS = frozenset([
    'logo', 'icon', 'favicon', 'sprite', 'placeholder',
    'loading', 'spinner', 'avatar', 'badge', 'banner-ad',
])


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
                # Valider les sélecteurs contre le vrai HTML
                result = self._validate_and_fix_selectors(
                    result, html_samples, html_samples_raw=html_samples)
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
                elements = soup.select(selector)
                results[name] = len(elements) > 0
            except Exception:
                results[name] = False

        return results

    def _validate_and_fix_selectors(
        self,
        result: Dict,
        html_samples_text,
        html_samples_raw=None
    ) -> Dict:
        """Validate Gemini selectors against real HTML.

        When a selector is invalid (hallucinated by the AI), auto-discovers
        a replacement by scanning the HTML content for elements that match
        the expected field type (price pattern, heading, spec labels, etc.).
        Works on any site regardless of CMS.
        """
        selectors = result.get('selectors', {})
        if not selectors:
            return result

        soup = self._get_validation_soup(html_samples_text, html_samples_raw)
        if not soup:
            return result

        fixed = dict(selectors)
        fixed_count = 0
        discovered_elements = {}

        invalid_fields = []
        for field, selector in selectors.items():
            if not selector:
                continue
            try:
                found = soup.select(selector)
            except Exception:
                found = []
            if not found:
                invalid_fields.append(field)

        if not invalid_fields:
            return result

        discover_map = {
            'name': lambda: self._discover_name_element(soup),
            'price': lambda: self._discover_price_element(soup),
            'image': lambda: self._discover_image_element(soup),
            'brand': lambda: self._discover_spec_element(
                soup, 'brand', _SPEC_LABELS['brand']),
            'model': lambda: self._discover_spec_element(
                soup, 'model', _SPEC_LABELS['model']),
            'year': lambda: self._discover_spec_element(
                soup, 'year', _SPEC_LABELS['year']),
            'mileage': lambda: self._discover_spec_element(
                soup, 'mileage', _SPEC_LABELS['mileage']),
        }

        for field in invalid_fields:
            if field == 'product_container':
                continue

            discover_fn = discover_map.get(field)
            if not discover_fn:
                continue

            disc_result = discover_fn()
            if disc_result is not None:
                if isinstance(disc_result, tuple):
                    element, compound = disc_result
                    selector_str = compound or self._element_to_selector(element)
                else:
                    element = disc_result
                    selector_str = self._element_to_selector(element)

                if selector_str:
                    try:
                        if soup.select(selector_str):
                            fixed[field] = selector_str
                            fixed_count += 1
                            discovered_elements[field] = element
                            print(f"   🔧 Sélecteur '{field}' auto-découvert: "
                                  f"{selectors[field]} → {selector_str}")
                            continue
                    except Exception:
                        pass

            print(f"   ⚠️  Sélecteur '{field}' invalide, auto-découverte échouée: "
                  f"{selectors.get(field, '')}")

        if 'product_container' in invalid_fields:
            container_el = self._discover_container_element(
                soup, discovered_elements)
            if container_el:
                selector_str = self._element_to_selector(container_el)
                if selector_str:
                    try:
                        if soup.select(selector_str):
                            fixed['product_container'] = selector_str
                            fixed_count += 1
                            print(f"   🔧 Sélecteur 'product_container' auto-découvert: "
                                  f"{selectors.get('product_container', '')} → {selector_str}")
                    except Exception:
                        pass

        if fixed_count > 0:
            print(f"   🔧 {fixed_count} sélecteur(s) auto-découvert(s) par analyse HTML")

        result['selectors'] = fixed
        return result

    def _get_validation_soup(self, html_samples_text, html_samples_raw=None):
        """Extract a BeautifulSoup object from the first HTML sample."""
        if isinstance(html_samples_raw, dict) and html_samples_raw:
            return BeautifulSoup(
                next(iter(html_samples_raw.values())), 'html.parser')

        if isinstance(html_samples_text, dict) and html_samples_text:
            return BeautifulSoup(
                next(iter(html_samples_text.values())), 'html.parser')

        if isinstance(html_samples_text, str) and html_samples_text:
            sample = html_samples_text
            if '=== URL:' in sample:
                parts = sample.split('=== URL:')
                if len(parts) > 1:
                    chunk = parts[1]
                    nl = chunk.find('\n')
                    sample = chunk[nl + 1:] if nl >= 0 else chunk
            return BeautifulSoup(sample, 'html.parser')

        return None

    # ── Auto-discovery methods ──

    def _discover_name_element(self, soup):
        """Find the product name element (usually h1 on detail pages)."""
        h1 = soup.find('h1')
        if h1:
            text = h1.get_text(strip=True)
            if 5 <= len(text) <= 200:
                return h1

        for tag in ('h2', 'h3'):
            for heading in soup.find_all(tag):
                text = heading.get_text(strip=True)
                if not (5 <= len(text) <= 200):
                    continue
                in_chrome = any(
                    hasattr(a, 'name') and a.name in ('nav', 'footer', 'aside')
                    for a in heading.parents
                )
                if not in_chrome:
                    return heading

        return None

    def _discover_price_element(self, soup):
        """Find an element containing a monetary price by scanning text content."""
        candidates = []

        for text_node in soup.find_all(string=_PRICE_PATTERN):
            parent = text_node.parent
            if not parent or not hasattr(parent, 'name') or not parent.name:
                continue

            excluded = False
            check = parent
            for _ in range(8):
                if not check or not hasattr(check, 'get'):
                    break
                cls_str = ' '.join(check.get('class', [])).lower()
                style = (check.get('style') or '').lower()
                if (any(kw in cls_str for kw in _PRICE_EXCLUDE_KEYWORDS)
                        or 'line-through' in style):
                    excluded = True
                    break
                check = getattr(check, 'parent', None)

            if excluded:
                continue

            in_chrome = any(
                hasattr(a, 'name') and a.name in ('footer', 'nav', 'aside', 'header')
                for a in parent.parents
            )
            if in_chrome:
                continue

            score = 0
            p_classes = ' '.join(parent.get('class', [])).lower()
            if any(kw in p_classes for kw in ('price', 'prix', 'cost', 'amount', 'sale')):
                score += 20
            elif parent.get('class'):
                score += 5

            candidates.append((parent, score))

        if not candidates:
            return None

        candidates.sort(key=lambda x: x[1], reverse=True)
        return candidates[0][0]

    def _discover_spec_element(self, soup, field: str, labels: List[str]):
        """Find a spec value element (brand, model, year, mileage) by searching
        for known labels and their associated value elements.

        Returns (element, compound_selector) or None.  compound_selector is a
        pre-built CSS selector when the element alone would be ambiguous (e.g.
        multiple span.value inside different spec rows).
        """

        # Strategy 1: class attribute contains the label keyword
        for label in labels:
            for el in soup.select(f'[class*="{label}"]'):
                value_el = el.select_one('.value, span:last-child')
                target = value_el if value_el else el
                text = target.get_text(strip=True)
                clean = text
                for lb in labels:
                    clean = re.sub(
                        r'(?i)\b' + re.escape(lb) + r'\b\s*:?\s*', '', clean
                    ).strip()
                if clean and self._validate_spec_content(field, clean):
                    if value_el:
                        v_tag = value_el.name
                        v_cls = [c for c in value_el.get('class', [])
                                 if not self._is_utility_class(c)
                                 and re.match(r'^[a-zA-Z_-][a-zA-Z0-9_-]*$', c)]
                        child = f'{v_tag}.{v_cls[0]}' if v_cls else v_tag
                        compound = f'[class*="{label}"] {child}'
                        return (target, compound)
                    return (target, None)

        # Strategy 2: itemprop / schema.org attributes
        itemprop_map = {
            'brand': ['brand', 'manufacturer'],
            'model': ['model'],
            'year': ['releaseDate', 'dateVehicleFirstRegistered',
                     'modelDate', 'vehicleModelDate'],
            'mileage': ['mileageFromOdometer'],
        }
        for prop in itemprop_map.get(field, []):
            el = soup.find(attrs={'itemprop': prop})
            if el:
                text = el.get('content', '') or el.get_text(strip=True)
                if text and self._validate_spec_content(field, text):
                    return (el, None)

        # Strategy 3: label-value pairs in DOM (dt/dd, td/td, span siblings)
        for label in labels:
            pattern = re.compile(r'\b' + re.escape(label) + r'\b', re.IGNORECASE)
            for text_node in soup.find_all(string=pattern):
                parent = text_node.parent
                if not parent or not hasattr(parent, 'name'):
                    continue

                if parent.name == 'dt':
                    dd = parent.find_next_sibling('dd')
                    if dd and self._validate_spec_content(
                            field, dd.get_text(strip=True)):
                        return (dd, None)

                if parent.name in ('th', 'td'):
                    next_td = parent.find_next_sibling('td')
                    if next_td and self._validate_spec_content(
                            field, next_td.get_text(strip=True)):
                        return (next_td, None)

                if parent.name in ('span', 'strong', 'b', 'label', 'div', 'p'):
                    for sib in parent.find_next_siblings():
                        val = sib.get_text(strip=True)
                        if val and self._validate_spec_content(field, val):
                            return (sib, None)
                        break

                full = parent.get_text(strip=True)
                if ':' in full:
                    value = full.split(':', 1)[1].strip()
                    if value and self._validate_spec_content(field, value):
                        return (parent, None)

        return None

    def _discover_image_element(self, soup):
        """Find the main product image by scoring img elements."""
        candidates = []

        for img in soup.find_all('img'):
            src = (img.get('src', '') or img.get('data-src', '')
                   or img.get('data-lazy-src', ''))
            if not src:
                continue

            src_lower = src.lower()
            cls_str = ' '.join(img.get('class', [])).lower()

            if any(kw in src_lower or kw in cls_str for kw in _LOGO_KEYWORDS):
                continue

            try:
                w = int(img.get('width', 0) or 0)
                h = int(img.get('height', 0) or 0)
                if (w and w < 80) or (h and h < 80):
                    continue
            except (ValueError, TypeError):
                pass

            in_chrome = any(
                hasattr(a, 'name') and a.name in ('nav', 'footer', 'aside', 'header')
                for a in img.parents
            )
            if in_chrome:
                continue

            score = 0
            if any(kw in cls_str for kw in
                   ('product', 'vehicle', 'gallery', 'hero',
                    'main', 'primary', 'featured')):
                score += 20
            if any(kw in src_lower for kw in
                   ('product', 'vehicle', 'inventory', 'upload')):
                score += 10
            if img.parent and img.parent.name in ('picture', 'figure'):
                score += 5
            try:
                if int(img.get('width', 0) or 0) >= 300:
                    score += 10
            except (ValueError, TypeError):
                pass

            candidates.append((img, score))

        if not candidates:
            return None

        candidates.sort(key=lambda x: x[1], reverse=True)
        return candidates[0][0]

    def _discover_container_element(self, soup, found_elements: Dict):
        """Find the most specific common ancestor of the discovered elements."""
        elements = [el for el in found_elements.values() if el is not None]

        if len(elements) >= 2:
            def _ancestors(el):
                chain = []
                cur = el
                while cur and hasattr(cur, 'name') and cur.name:
                    chain.append(cur)
                    cur = getattr(cur, 'parent', None)
                return list(reversed(chain))

            chains = [_ancestors(el) for el in elements]
            common = None
            for level in zip(*chains):
                if all(node is level[0] for node in level):
                    common = level[0]
                else:
                    break

            if common and common.name not in ('html', 'body', '[document]'):
                return common

        if elements:
            current = elements[0].parent
            while current and hasattr(current, 'name') and current.name:
                if current.name in ('article', 'section', 'main', 'div'):
                    classes = current.get('class', [])
                    meaningful = [c for c in classes
                                  if not self._is_utility_class(c)]
                    if meaningful or current.name in ('article', 'main'):
                        return current
                current = getattr(current, 'parent', None)

        for tag in ('article', 'main', 'section'):
            el = soup.find(tag)
            if el:
                return el

        return None

    def _element_to_selector(self, element) -> Optional[str]:
        """Build a reusable CSS selector from a BeautifulSoup element."""
        if not element or not hasattr(element, 'name') or not element.name:
            return None

        tag = element.name

        el_id = element.get('id', '')
        if el_id and re.match(r'^[a-zA-Z][a-zA-Z0-9_-]*$', el_id):
            return f'#{el_id}'

        itemprop = element.get('itemprop', '')
        if itemprop:
            return f'[itemprop="{itemprop}"]'

        classes = element.get('class', [])
        meaningful = [
            c for c in classes
            if not self._is_utility_class(c)
            and re.match(r'^[a-zA-Z_-][a-zA-Z0-9_-]*$', c)
        ]
        if meaningful:
            return f'{tag}.{".".join(meaningful[:2])}'

        if tag in ('h1', 'h2', 'h3', 'article', 'main', 'section'):
            return tag

        parent = element.parent
        if (parent and hasattr(parent, 'name')
                and parent.name not in (None, 'html', 'body', '[document]')):
            p_classes = parent.get('class', [])
            p_meaningful = [
                c for c in p_classes
                if not self._is_utility_class(c)
                and re.match(r'^[a-zA-Z_-][a-zA-Z0-9_-]*$', c)
            ]
            if p_meaningful:
                return f'{parent.name}.{".".join(p_meaningful[:2])} {tag}'

        return tag

    @staticmethod
    def _is_utility_class(cls: str) -> bool:
        """Check if a CSS class is a utility/layout class (Tailwind, Bootstrap)."""
        if len(cls) <= 1:
            return True
        return any(cls.startswith(p) for p in _UTILITY_CLASS_PREFIXES)

    @staticmethod
    def _validate_spec_content(field: str, text: str) -> bool:
        """Validate that discovered text is plausible for the given spec field."""
        if not text or not text.strip():
            return False
        text = text.strip()

        if field == 'year':
            return bool(re.search(r'\b20[0-3]\d\b', text)) and len(text) < 20
        if field == 'brand':
            return 1 < len(text) < 40 and not text.isdigit()
        if field == 'model':
            return 1 < len(text) < 60 and not text.isdigit()
        if field == 'mileage':
            return bool(re.search(r'\d', text)) and len(text) < 30

        return len(text) > 0

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
        is_detail_page = len(containers) == 1

        for container in containers:
            product = {}

            for field, selector in selectors.items():
                if field == 'product_container' or not selector:
                    continue

                try:
                    element = container.select_one(selector)
                    # Sur une page de détail, si le champ est introuvable
                    # dans le container, chercher globalement (h1 souvent hors container)
                    if not element and is_detail_page and field in ('name', 'price', 'image'):
                        element = soup.select_one(selector)
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
