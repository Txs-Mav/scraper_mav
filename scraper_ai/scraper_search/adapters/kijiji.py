"""
KijijiAdapter — petites annonces Kijiji.ca via Playwright stealth.

Kijiji est protégé par DataDome (anti-bot agressif côté front). Stratégie :
  1. Construire l'URL de recherche Kijiji canonique.
  2. Rendre la page via le BrowserAgent (Playwright + stealth + UA réaliste).
  3. Extraire les fiches via :
     a) Le state Next.js (`__NEXT_DATA__`) si présent — c'est la voie la plus
        propre (Kijiji est en Next.js).
     b) Sinon, JSON-LD `ItemList` / `Product` que Kijiji embed.
     c) Sinon, GenericProductExtractor sur chaque card.
  4. Normaliser et scorer.

Limitation : 1 résultat = 1 page rendue (~3-5 s). Pour la perf, on demande
volontairement la page de listing UNE fois et on en extrait 25-40 hits d'un coup.
"""
from __future__ import annotations

import json
import re
from typing import Any, Dict, List, Optional
from urllib.parse import quote_plus, urljoin

from ..models import SearchHit, SearchQuery
from ..scoring import make_hit, score_product
from .base import AdapterError, SearchAdapter


# Mapping requête → catégorie Kijiji (slug + numéro de catégorie)
# Kijiji structure ses URLs : /b-<categorie>/<localisation>/<query>/<cat-num>l<loc-num>
_KIJIJI_CATEGORIES = {
    # Véhicules motorisés (mappable depuis type_vehicule OU category_path)
    "auto": ("cars-trucks", "174"),
    "moto": ("motorcycles", "30"),
    "vtt": ("atv-snowmobile", "172"),
    "motoneige": ("atv-snowmobile", "172"),
    "sxs": ("atv-snowmobile", "172"),
    "nautique": ("boats-watercraft", "29"),
    # Catégories génériques (e-commerce)
    "electronique": ("electronics", "15"),
    "cellulaire": ("cell-phones", "760"),
    "ordinateur": ("computers", "16"),
    "audio": ("audio", "20"),
    "tv": ("tvs-video", "21"),
    "console-jeux": ("video-games-consoles", "141"),
    "meuble": ("furniture", "235"),
    "vetement": ("clothing", "274"),
    "chaussures": ("clothing", "274"),
    "outils": ("tools", "110"),
    "velo": ("bicycles", "644"),
    "ski-snowboard": ("ski-snowboard", "111"),
    # Accessoires (Kijiji n'a pas de bucket dédié → on les met dans véhicule
    # parent pour l'URL mais le scoring fera le tri)
    "accessoire-moto": ("motorcycles", "30"),
    "accessoire-auto": ("auto-parts-tires", "27"),
    "accessoire-vtt": ("atv-snowmobile", "172"),
    "accessoire-motoneige": ("atv-snowmobile", "172"),
    "piece-moto": ("motorcycle-parts-accessories", "311"),
    "piece-auto": ("auto-parts-tires", "27"),
}

DEFAULT_LOCATION = ("canada", "0")  # tout le Canada


# Kijiji code les prix dans son `__NEXT_DATA__` sous plusieurs `__typename` :
#   - `StandardAmountPrice`       : annonces générales — amount en CENTS
#   - `AutosDealerAmountPrice`    : concessionnaires auto/moto — amount en CENTS
#   - `AutosOwnerAmountPrice`     : particuliers auto/moto — amount en CENTS
#   - `RangePrice`                : fourchette de prix — minAmount en CENTS
#   - `SwapPrice`, `FreeUseAndTreasuresPrice`, `PleaseContactPrice` : pas de
#     montant exploitable, on retourne None.
#
# Règle générale (déduite par inspection live) : tout `__typename` qui finit
# par `AmountPrice` ou `RangePrice` envoie le montant EN CENTS. Tout autre
# type structuré n'a pas de montant numérique exploitable.
#
# Si on rencontre un dict sans `__typename` (rare/legacy) ou un nombre brut
# directement, on tombe sur le path historique (`float(amount)` tel quel) — ça
# garde la rétrocompat sans casser les vieux fixtures.
_KIJIJI_NON_NUMERIC_PRICE_TYPES = {
    "SwapPrice",
    "FreeUseAndTreasuresPrice",
    "PleaseContactPrice",
}


def _extract_kijiji_image(node: dict) -> str:
    """Récupère la première image d'un listing Kijiji.

    Format 2026 : `imageUrls` (liste de strings).
    Format legacy : `imageUrl`, `image`, `thumbnail`, `primaryImageUrl`.

    Bonus : remplace `?rule=kijijica-200-jpg` (thumbnail 200px très petit) par
    `kijijica-800-jpg` pour avoir une image utilisable en carte UI.
    """
    # Format 2026 : imageUrls = list[str]
    imgs = node.get("imageUrls")
    if isinstance(imgs, list) and imgs:
        first = imgs[0]
        if isinstance(first, str) and first:
            return _bump_kijiji_image_size(first)

    # Formats legacy : champs singuliers
    for img_key in ("imageUrl", "image", "thumbnail", "primaryImageUrl"):
        val = node.get(img_key)
        if not val:
            continue
        if isinstance(val, dict):
            val = val.get("url") or val.get("src")
        if isinstance(val, str) and val:
            return _bump_kijiji_image_size(val)
    return ""


def _bump_kijiji_image_size(url: str) -> str:
    """Augmente la taille d'une image Kijiji 200px → 800px.

    Le CDN Kijiji prend un param `?rule=kijijica-<taille>-<format>`. La taille
    par défaut dans les listings est 200 (thumbnail), trop petit pour des
    cartes produit. 800 reste raisonnable en bande passante.
    """
    if "rule=kijijica-200-" in url:
        return url.replace("rule=kijijica-200-", "rule=kijijica-800-")
    return url


def _extract_kijiji_location(node: dict) -> str:
    """Récupère la localisation lisible (ville) d'un listing."""
    loc = node.get("location") or node.get("locationName") or ""
    if isinstance(loc, dict):
        return str(loc.get("name") or loc.get("city") or "")
    if isinstance(loc, str):
        return loc
    return ""


# Mapping Kijiji canonicalName → champ produit normalisé.
# Sources observées sur Kijiji.ca en 2026 (auto, moto, bateau, VTT).
_KIJIJI_MAKE_KEYS = ("carmake", "motorcyclesmake", "boatsmake", "atvmake",
                     "snowmobilemake", "watercraftmake", "rvmake")
_KIJIJI_MODEL_KEYS = ("carmodel", "motorcyclesmodel", "boatsmodel", "atvmodel",
                      "snowmobilemodel", "watercraftmodel", "rvmodel")


def _extract_kijiji_attributes(node: dict) -> dict:
    """Parse `attributes.all` (liste de `ListingAttributeV2`) et retourne un
    dict normalisé { mileage, year, etat, marque, modele }.

    Format Kijiji 2026 :
        attributes.all = [
            {"__typename": "ListingAttributeV2",
             "canonicalName": "carmileageinkms",
             "canonicalValues": ["211000"]},
            ...
        ]
    """
    out: dict = {}
    attrs = node.get("attributes")
    if not isinstance(attrs, dict):
        return out
    all_attrs = attrs.get("all")
    if not isinstance(all_attrs, list):
        return out

    for a in all_attrs:
        if not isinstance(a, dict):
            continue
        name = a.get("canonicalName")
        values = a.get("canonicalValues")
        if not isinstance(name, str) or not isinstance(values, list) or not values:
            continue
        first = values[0]
        if not isinstance(first, str) or not first:
            continue

        # Kilométrage : "carmileageinkms" est en km (string → int)
        if name == "carmileageinkms" and "mileage" not in out:
            try:
                km = int(first.replace(",", "").replace(" ", ""))
                if km >= 0:
                    out["mileage"] = km
            except ValueError:
                pass
        # Année
        elif name == "caryear" and "year" not in out:
            try:
                yr = int(first)
                if 1900 < yr < 2100:
                    out["year"] = yr
            except ValueError:
                pass
        # État neuf / occasion
        elif name == "vehicletype" and "etat" not in out:
            v = first.lower()
            if v == "new":
                out["etat"] = "neuf"
            elif v in ("used", "occasion"):
                out["etat"] = "occasion"
        # Marque
        elif name in _KIJIJI_MAKE_KEYS and "marque" not in out:
            out["marque"] = first
        # Modèle
        elif name in _KIJIJI_MODEL_KEYS and "modele" not in out:
            out["modele"] = first

    return out


def _parse_kijiji_price(node):  # type: ignore[no-untyped-def]
    """Extrait un prix CAD (float) depuis le node `price` du __NEXT_DATA__ Kijiji.

    Retourne `None` si le prix n'est pas exploitable.
    """
    if node is None:
        return None
    if isinstance(node, (int, float)):
        # Nombre brut, on assume que c'est déjà en dollars.
        return float(node)
    if isinstance(node, dict):
        typename = node.get("__typename") or ""
        if typename in _KIJIJI_NON_NUMERIC_PRICE_TYPES:
            return None
        amount = node.get("amount")
        if amount is None:
            amount = node.get("value")
        if amount is None and typename == "RangePrice":
            # Prend la borne basse de la fourchette pour avoir un signal.
            mn = node.get("minAmount") or node.get("min")
            if mn is not None:
                amount = mn
        if amount is None:
            return None
        try:
            cents = float(amount)
        except (TypeError, ValueError):
            return None
        # Tous les types `*AmountPrice` et `RangePrice` de Kijiji envoient le
        # montant en CENTS (StandardAmountPrice, AutosDealerAmountPrice,
        # AutosOwnerAmountPrice, etc.). On divise par 100 dans ce cas.
        # Pour un dict sans __typename connu, on garde la valeur brute
        # (rétrocompat avec d'anciens fixtures non-Kijiji).
        if typename.endswith("AmountPrice") or typename == "RangePrice":
            return cents / 100.0
        return cents
    if isinstance(node, str):
        m = re.search(r"[\d,.\s]+", node)
        if not m:
            return None
        try:
            return float(m.group(0).replace(",", "").replace(" ", ""))
        except ValueError:
            return None
    return None


class KijijiAdapter(SearchAdapter):
    """Adapter Kijiji.ca."""

    name = "Kijiji.ca"
    site_url = "https://www.kijiji.ca"
    supported_types: List[str] = []  # accepte tout (legacy)
    # Kijiji couvre absolument tout (petites annonces). Le sous-tri (cars, atv,
    # electronics, …) est géré par `_pick_category` qui mappe la query.
    serves_categories: List[str] = ["*"]

    def __init__(self, *,
                 location_slug: str = DEFAULT_LOCATION[0],
                 location_id: str = DEFAULT_LOCATION[1],
                 timeout_ms: int = 20000,
                 max_pages: int = 1):
        """
        Args:
            location_slug: 'canada' (tout le Canada), 'province-de-quebec',
                           'ville-de-montreal', etc.
            location_id:   ID Kijiji correspondant (0 = Canada)
            timeout_ms:    timeout par page (Kijiji + DataDome = 8-15 s)
            max_pages:     nb de pages de résultats à scraper (40 résultats / page)
        """
        self.location_slug = location_slug
        self.location_id = location_id
        self.timeout_ms = timeout_ms
        self.max_pages = max_pages

    # ------------------------------------------------------------------
    # search()
    # ------------------------------------------------------------------

    def search(self, query: SearchQuery, *, max_results: int = 50) -> List[SearchHit]:
        text = query.search_text()
        if not text:
            return []

        category_slug, category_id = self._pick_category(query)
        urls = [self._build_url(text, category_slug, category_id, page=p)
                for p in range(1, self.max_pages + 1)]

        try:
            from scraper_ai.scraper_usine.browser_agent import BrowserAgent
        except ImportError as e:
            raise AdapterError(f"BrowserAgent indisponible: {e}")

        all_products: List[Dict[str, Any]] = []
        try:
            with BrowserAgent(block_assets=True, locale="fr-CA") as agent:
                for url in urls:
                    try:
                        result = agent.render(
                            url,
                            timeout_ms=self.timeout_ms,
                            networkidle_ms=2500,
                            scroll=True,
                            max_scrolls=3,
                            dismiss_cookies=True,
                        )
                    except Exception as e:
                        raise AdapterError(f"Kijiji render error {url}: {e}")
                    if not result.html or len(result.html) < 1000:
                        continue
                    products = self._parse_listing(result.html, base_url=url)
                    all_products.extend(products)
                    if len(all_products) >= max_results * 2:
                        break
        except AdapterError:
            raise
        except Exception as e:
            raise AdapterError(f"Kijiji session error: {e}")

        if not all_products:
            return []

        hits: List[SearchHit] = []
        seen_urls = set()
        for p in all_products:
            u = p.get("sourceUrl", "")
            if u in seen_urls:
                continue
            seen_urls.add(u)
            sc, reason = score_product(query, p)
            if sc < query.min_score:
                continue
            hits.append(make_hit(
                p, sc, reason,
                source_site="kijiji.ca",
                source_slug="kijiji",
            ))
        hits.sort(key=lambda h: h.score, reverse=True)
        return hits[:max_results]

    # ------------------------------------------------------------------
    # URL building
    # ------------------------------------------------------------------

    @staticmethod
    def _has_strong_product_identity(query: SearchQuery) -> bool:
        """True si la query identifie un produit précis qu'on peut retrouver
        par son titre sans avoir besoin de filtrer par sous-catégorie Kijiji.

        Cas couverts :
          - marque + modèle  → "2013 Bayliner Flight Series 175", "iPhone 15 Pro"
          - marque + année   → "Ski-Doo Summit 850 2024"
          - SKU explicite    → "MPN: ABC-123"
        """
        if query.sku:
            return True
        has_marque = bool(query.marque)
        has_modele = bool(query.modele)
        has_year = bool(query.annee or query.annee_min or query.annee_max)
        return has_marque and (has_modele or has_year)

    def _pick_category(self, query: SearchQuery) -> tuple:
        """Choisit la catégorie Kijiji la plus pertinente.

        Ordre de priorité :
          1. Si la query identifie un produit précis (marque + modèle ou
             marque + année), on passe en mode "toutes catégories" sur Kijiji.
             Raison : Kijiji a des sous-catégories trop fragmentées (un même
             bateau peut être classé dans `boats-watercraft` OU `water-sport`,
             une moto sous `motorcycles` OU `motorcycle-parts-accessories`…).
             Filtrer par sous-catégorie ferait rater des annonces correctement
             identifiables par leur titre. Le scoring backend (marque + année
             + modèle) filtre déjà efficacement le bruit.
          2. `query.category_path` (taxonomie pré-triée par l'utilisateur)
          3. `query.type_vehicule` (legacy)
          4. `query.categorie` (libellé libre)
          5. Fallback "toutes catégories"
        """
        # 1) Signal d'identité fort → on élargit la recherche.
        if self._has_strong_product_identity(query):
            return ("", "0")

        if query.category_path:
            # On utilise la dernière feuille du path comme clé (ex:
            # 'electronique.cellulaire' → 'cellulaire').
            leaf = query.category_path.split(".")[-1]
            if leaf in _KIJIJI_CATEGORIES:
                return _KIJIJI_CATEGORIES[leaf]
            # Sinon on remonte d'un cran (ex: 'accessoire.accessoire-moto'
            # → tente 'accessoire-moto').
            for part in reversed(query.category_path.split(".")):
                if part in _KIJIJI_CATEGORIES:
                    return _KIJIJI_CATEGORIES[part]

        if query.type_vehicule and query.type_vehicule in _KIJIJI_CATEGORIES:
            return _KIJIJI_CATEGORIES[query.type_vehicule]
        if query.categorie:
            cat_lower = query.categorie.lower()
            for k, v in _KIJIJI_CATEGORIES.items():
                if k in cat_lower:
                    return v
        # Fallback : recherche dans toutes les catégories
        return ("", "0")

    def _build_url(self, text: str, category_slug: str, category_id: str,
                    *, page: int = 1) -> str:
        text_slug = quote_plus(text.lower().strip())
        # Format Kijiji moderne : /b-<categorie>/<loc>/<query>/k0c<cat>l<loc>
        if category_slug:
            base = f"https://www.kijiji.ca/b-{category_slug}/{self.location_slug}/{text_slug}"
        else:
            base = f"https://www.kijiji.ca/b-canada/{text_slug}"
        suffix = f"/k0c{category_id}l{self.location_id}"
        page_part = f"/page-{page}" if page > 1 else ""
        return f"{base}{page_part}{suffix}"

    # ------------------------------------------------------------------
    # Parsing
    # ------------------------------------------------------------------

    def _parse_listing(self, html: str, *, base_url: str) -> List[Dict[str, Any]]:
        # 1) __NEXT_DATA__ (le plus propre, Kijiji est en Next.js)
        products = self._parse_next_data(html, base_url=base_url)
        if products:
            return products

        # 2) Fallback : JSON-LD ItemList + extraction par card
        from ..extractors.generic_product import (
            extract_products_from_listing, GenericProductExtractor,
        )
        products = extract_products_from_listing(
            html, base_url=base_url,
            item_selector="[data-testid='listing-card'], .listing-card, "
                          "section[data-listing-id], li[data-listing-id]",
        )
        if products:
            for p in products:
                if not p.get("sourceUrl") and p.get("name"):
                    # Reconstruire l'URL si on n'a que le titre
                    pass
            return products

        # 3) Dernier recours : extraction sur la page complète (1 produit)
        single = GenericProductExtractor(html, base_url=base_url, marketplace_hint="kijiji").extract()
        return [single] if single.get("name") else []

    def _parse_next_data(self, html: str, *, base_url: str) -> List[Dict[str, Any]]:
        """Cherche un bloc <script id="__NEXT_DATA__"> et en extrait les listings."""
        m = re.search(
            r'<script[^>]+id="__NEXT_DATA__"[^>]*>(.*?)</script>',
            html, re.DOTALL,
        )
        if not m:
            return []
        try:
            data = json.loads(m.group(1))
        except json.JSONDecodeError:
            return []

        # Kijiji change la forme du payload de temps en temps. On cherche tous les
        # objets qui ressemblent à un listing (id + title + price).
        listings: List[Dict[str, Any]] = []
        self._walk_next_data(data, listings)
        return listings

    def _walk_next_data(self, node: Any, out: List[Dict[str, Any]],
                        *, depth: int = 0) -> None:
        if depth > 30:
            return
        if isinstance(node, list):
            for item in node:
                self._walk_next_data(item, out, depth=depth + 1)
            return
        if not isinstance(node, dict):
            return
        # Heuristique : un listing Kijiji a "title" + ("price" OR "priceText")
        # + ("url" OR "seoUrl" OR "id")
        title = node.get("title")
        url = node.get("url") or node.get("seoUrl") or node.get("href") or ""
        price_node = node.get("price") or node.get("priceText") or node.get("amount")
        if (isinstance(title, str) and len(title) > 5
                and (price_node is not None) and url):
            full_url = url if url.startswith("http") else urljoin("https://www.kijiji.ca", url)
            price = _parse_kijiji_price(price_node)

            # Image principale : format Kijiji 2026 = `imageUrls` (liste de
            # strings). On garde aussi les anciens noms en fallback pour les
            # vieux fixtures / changements de format futurs.
            image = _extract_kijiji_image(node)

            location = _extract_kijiji_location(node)

            # Attributs structurés (Kijiji 2026) : `attributes.all` est une
            # liste de `ListingAttributeV2` qui contient kilométrage, année,
            # état, marque/modèle, etc. Ça remplace l'heuristique titre.
            attrs = _extract_kijiji_attributes(node)

            # Année : préfère `caryear` des attributs ; sinon fallback titre.
            annee = attrs.get("year")
            if annee is None:
                year_match = re.search(r"\b(19[89]\d|20[0-3]\d)\b", title)
                annee = int(year_match.group(0)) if year_match else None

            # État : `vehicletype` = "used"/"new" → "occasion"/"neuf".
            etat = attrs.get("etat", "occasion")

            # Marque / modèle (utile pour le scoring frontend et la valuation).
            marque = attrs.get("marque")
            modele = attrs.get("modele")

            out.append({
                "name": title,
                "prix": price,
                "annee": annee,
                "kilometrage": attrs.get("mileage"),
                "marque": marque,
                "modele": modele,
                "image": image,
                "sourceUrl": full_url,
                "description": str(node.get("description", ""))[:300],
                "etat": etat,
                "vendor": location or None,
            })
            return
        for v in node.values():
            self._walk_next_data(v, out, depth=depth + 1)
