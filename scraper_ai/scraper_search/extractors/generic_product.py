"""
GenericProductExtractor — extrait un produit depuis n'importe quelle page HTML.

Stratégie en cascade (du plus fiable au plus heuristique) :

  1. JSON-LD `Product` / `Offer` / `AggregateOffer`        (couvre Shopify, WooCommerce,
                                                            Magento, beaucoup d'Amazon)
  2. JSON-LD `ItemList` / `BreadcrumbList`                  (catégorie / fil d'Ariane)
  3. Microdata `itemtype=schema.org/Product`                (Magento, sites custom)
  4. RDFa (rare mais présent sur Drupal Commerce)
  5. OpenGraph / Twitter Cards (`og:title`, `og:price:amount`,
     `product:price:amount`, `og:image`)                   (couvre la plupart des sites)
  6. Heuristiques DOM ciblées (sélecteurs CSS connus pour Amazon, eBay, Kijiji…)
  7. Fallback ultime : <title> + 1ère image + regex prix dans le DOM

Chaque couche enrichit le dict produit ; les valeurs déjà extraites par une couche
plus fiable ne sont jamais écrasées par une couche moins fiable.

API publique :
    extractor = GenericProductExtractor(html, base_url=url)
    product = extractor.extract()
    # → {"name", "prix", "currency", "sku", "image", "description",
    #    "marque", "categorie", "etat", "sourceUrl", "raw_meta"}
"""
from __future__ import annotations

import json
import re
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urljoin, urlparse

from bs4 import BeautifulSoup, Tag


# ---------------------------------------------------------------------------
# Patterns prix / nettoyage
# ---------------------------------------------------------------------------

# Important : on essaie d'abord les patterns avec séparateur de milliers
# (1,234.56 / 1.234,56) puis on retombe sur un entier pur.
# Le |\d+ doit être en dernier sinon il consomme avant que le pattern complet matche.
_NUMERIC_PRICE_INNER = (
    r"\d{1,3}(?:[,.\s]\d{3})+(?:[,.]\d{1,2})?"  # ex: 1,234.56 ou 1 234,56
    r"|\d+[,.]\d{1,2}"                            # ex: 1499.99 ou 12,50
    r"|\d+"                                        # ex: 1499 (entier pur)
)

_PRICE_REGEX = re.compile(
    rf"(?P<currency>CAD|USD|EUR|GBP|CA\$|US\$|\$|€|£)\s*"
    rf"(?P<value>{_NUMERIC_PRICE_INNER})",
    re.IGNORECASE,
)
_PRICE_NUM_THEN_CURRENCY = re.compile(
    rf"(?P<value>{_NUMERIC_PRICE_INNER})\s*"
    rf"(?P<currency>CAD|USD|EUR|GBP|CA\$|US\$|\$|€|£)",
    re.IGNORECASE,
)
_NUMERIC_PRICE = re.compile(_NUMERIC_PRICE_INNER)

_STATE_NEW = ("new", "neuf", "brand new", "neuve", "brand-new")
_STATE_USED = ("used", "occasion", "usagé", "usage", "pre-owned", "preowned",
               "second-hand", "secondhand", "refurbished", "reconditionné")


# ---------------------------------------------------------------------------
# Selectors heuristiques par marketplace (fallback DOM)
# ---------------------------------------------------------------------------

_HEURISTIC_SELECTORS: Dict[str, Dict[str, List[str]]] = {
    "amazon": {
        "name": ["#productTitle", "h1#title", "span#productTitle"],
        "price": [
            "span.a-price > span.a-offscreen",
            "#priceblock_ourprice",
            "#priceblock_dealprice",
            "#priceblock_saleprice",
            "span.a-price[data-a-color='price'] span.a-offscreen",
        ],
        "image": ["#landingImage", "#imgBlkFront", "img#main-image"],
        "sku": ["#ASIN", "input#ASIN"],
        "brand": ["#bylineInfo", "a#bylineInfo"],
    },
    "ebay": {
        "name": ["h1.x-item-title__mainTitle span", "h1#itemTitle", "h1.it-ttl"],
        "price": [
            "div.x-price-primary span.ux-textspans",
            "span#prcIsum",
            "span#mm-saleDscPrc",
            "div[data-testid='x-price-primary']",
        ],
        "image": ["img#icImg", "div.ux-image-carousel-item img"],
        "sku": ["div[data-testid='ux-layout-section-evo'] span"],
    },
    "kijiji": {
        "name": ["h1[itemprop='name']", "h1.title-2929470680", "h1[data-qa-id='vip-title']"],
        "price": [
            "span[itemprop='price']",
            "span.priceWrapper-3915768379 span",
            "span[data-qa-id='vip-price']",
        ],
        "image": ["img[itemprop='image']", "div.heroImage-1131930126 img"],
    },
    "shopify": {
        "name": ["h1.product__title", "h1.product-single__title", "h1[itemprop='name']"],
        "price": [
            "span.price-item--regular",
            "span[data-product-price]",
            "span.product__price",
        ],
        "image": ["img.product__image", "img[data-product-image]"],
    },
}


# ---------------------------------------------------------------------------
# Classe principale
# ---------------------------------------------------------------------------

class GenericProductExtractor:
    """Extrait un produit normalisé depuis du HTML.

    Usage :
        ext = GenericProductExtractor(html, base_url="https://example.com/p/123")
        product = ext.extract()
    """

    def __init__(self, html: str, *, base_url: str = "",
                 marketplace_hint: Optional[str] = None):
        self.html = html or ""
        self.base_url = base_url or ""
        self.marketplace_hint = (marketplace_hint or "").lower() or self._guess_marketplace()
        try:
            self.soup = BeautifulSoup(self.html, "lxml")
        except Exception:
            # lxml pas dispo → fallback html.parser (toujours présent)
            self.soup = BeautifulSoup(self.html, "html.parser")

    # ------------------------------------------------------------------
    # Pipeline
    # ------------------------------------------------------------------

    def extract(self) -> Dict[str, Any]:
        """Renvoie un dict produit normalisé.
        Les clés non extraites sont absentes (pas None systématique)."""
        product: Dict[str, Any] = {"sourceUrl": self.base_url}
        meta: Dict[str, Any] = {}

        # 1) JSON-LD (couche la plus fiable)
        self._merge(product, self._extract_jsonld(meta))

        # 2) Microdata schema.org/Product
        self._merge(product, self._extract_microdata())

        # 3) OpenGraph + product:* meta + Twitter
        self._merge(product, self._extract_opengraph())

        # 4) Heuristiques DOM par marketplace (Amazon/eBay/Kijiji/Shopify)
        if self.marketplace_hint:
            self._merge(product, self._extract_heuristic(self.marketplace_hint))

        # 5) Heuristiques génériques (toutes les couches précédentes ont échoué pour un champ)
        self._merge(product, self._extract_fallback())

        # Post-traitement : URLs absolues, prix float, currency normalisée
        self._post_process(product)

        if meta:
            product["raw_meta"] = meta
        return product

    # ------------------------------------------------------------------
    # 1) JSON-LD
    # ------------------------------------------------------------------

    def _extract_jsonld(self, meta_acc: Dict[str, Any]) -> Dict[str, Any]:
        out: Dict[str, Any] = {}
        for script in self.soup.find_all("script", type=lambda t: t and "ld+json" in t.lower()):
            raw = script.string or script.get_text() or ""
            if not raw.strip():
                continue
            try:
                data = json.loads(raw)
            except json.JSONDecodeError:
                # Tolère les JSON-LD avec commentaires / trailing commas (Shopify/Magento le font)
                cleaned = self._tolerant_json(raw)
                try:
                    data = json.loads(cleaned)
                except Exception:
                    continue
            for node in self._iter_jsonld_nodes(data):
                t = self._normalize_type(node.get("@type"))
                if "product" in t:
                    self._merge(out, self._jsonld_product_to_dict(node))
                elif "offer" in t and not out.get("prix"):
                    price, currency = self._jsonld_offer_to_price(node)
                    if price is not None:
                        out["prix"] = price
                        if currency:
                            out["currency"] = currency
                elif "breadcrumblist" in t:
                    cat = self._jsonld_breadcrumb_to_category(node)
                    if cat and "categorie" not in out:
                        out["categorie"] = cat
                elif "itemlist" in t:
                    meta_acc.setdefault("itemlist_count", 0)
                    items = node.get("itemListElement") or []
                    if isinstance(items, list):
                        meta_acc["itemlist_count"] += len(items)
        return out

    @staticmethod
    def _iter_jsonld_nodes(data: Any):
        """Yield each dict node, supportant les arrays et les @graph."""
        if isinstance(data, list):
            for d in data:
                yield from GenericProductExtractor._iter_jsonld_nodes(d)
            return
        if not isinstance(data, dict):
            return
        if "@graph" in data and isinstance(data["@graph"], list):
            for d in data["@graph"]:
                yield from GenericProductExtractor._iter_jsonld_nodes(d)
        yield data

    @staticmethod
    def _normalize_type(t: Any) -> str:
        if isinstance(t, list):
            return " ".join(str(x).lower() for x in t)
        return str(t or "").lower()

    def _jsonld_product_to_dict(self, node: Dict[str, Any]) -> Dict[str, Any]:
        out: Dict[str, Any] = {}
        if name := self._first_str(node.get("name")):
            out["name"] = name
        if desc := self._first_str(node.get("description")):
            out["description"] = desc
        if sku := self._first_str(node.get("sku") or node.get("mpn") or node.get("gtin13")
                                  or node.get("gtin12") or node.get("gtin")):
            out["sku"] = sku
        if brand := node.get("brand"):
            if isinstance(brand, dict):
                bn = self._first_str(brand.get("name"))
            else:
                bn = self._first_str(brand)
            if bn:
                out["marque"] = bn
        if cat := self._first_str(node.get("category")):
            out["categorie"] = cat
        if image := node.get("image"):
            img_url = self._first_str(image) if not isinstance(image, dict) \
                      else self._first_str(image.get("url") or image.get("@id"))
            if img_url:
                out["image"] = img_url

        # Offers (peut être un dict ou une liste, ou AggregateOffer)
        offers = node.get("offers")
        if offers:
            price, currency = self._jsonld_offer_to_price(offers)
            if price is not None:
                out["prix"] = price
                if currency:
                    out["currency"] = currency
            # Disponibilité / état
            cond = self._extract_offer_condition(offers)
            if cond:
                out["etat"] = cond
            url = self._extract_offer_url(offers)
            if url:
                out["sourceUrl"] = url

        return out

    def _jsonld_offer_to_price(self, offers: Any) -> Tuple[Optional[float], Optional[str]]:
        """Supporte Offer, AggregateOffer, et listes d'Offer.
        Pour AggregateOffer renvoie lowPrice ; pour une liste renvoie le min."""
        if isinstance(offers, list):
            prices: List[Tuple[float, Optional[str]]] = []
            for o in offers:
                p, c = self._jsonld_offer_to_price(o)
                if p is not None:
                    prices.append((p, c))
            if not prices:
                return None, None
            prices.sort(key=lambda x: x[0])
            return prices[0]
        if not isinstance(offers, dict):
            return None, None
        # AggregateOffer
        low = offers.get("lowPrice") or offers.get("priceSpecification", {}).get("minPrice")
        if low is not None:
            currency = offers.get("priceCurrency") or offers.get("priceSpecification", {}).get("priceCurrency")
            return _safe_price(low), str(currency) if currency else None
        # Simple Offer
        price = offers.get("price")
        if price is None and "priceSpecification" in offers:
            spec = offers["priceSpecification"]
            if isinstance(spec, dict):
                price = spec.get("price")
        currency = offers.get("priceCurrency")
        if currency is None and "priceSpecification" in offers:
            spec = offers["priceSpecification"]
            if isinstance(spec, dict):
                currency = spec.get("priceCurrency")
        return _safe_price(price), str(currency) if currency else None

    def _extract_offer_condition(self, offers: Any) -> Optional[str]:
        if isinstance(offers, list):
            for o in offers:
                c = self._extract_offer_condition(o)
                if c:
                    return c
            return None
        if not isinstance(offers, dict):
            return None
        cond = offers.get("itemCondition")
        if not cond:
            return None
        cond_str = str(cond).lower()
        if "new" in cond_str:
            return "neuf"
        if "used" in cond_str or "refurbished" in cond_str:
            return "occasion"
        return None

    def _extract_offer_url(self, offers: Any) -> Optional[str]:
        if isinstance(offers, list):
            for o in offers:
                u = self._extract_offer_url(o)
                if u:
                    return u
            return None
        if isinstance(offers, dict):
            url = offers.get("url")
            if url and isinstance(url, str):
                return url
        return None

    def _jsonld_breadcrumb_to_category(self, node: Dict[str, Any]) -> Optional[str]:
        items = node.get("itemListElement") or []
        if not isinstance(items, list):
            return None
        names = []
        for it in items:
            if not isinstance(it, dict):
                continue
            name = it.get("name")
            if not name and isinstance(it.get("item"), dict):
                name = it["item"].get("name")
            if name:
                names.append(str(name))
        if len(names) >= 2:
            # On exclut le 1er crumb (souvent "Accueil") et le dernier (= le produit lui-même)
            return " > ".join(names[1:-1]) or names[-2]
        return None

    # ------------------------------------------------------------------
    # 2) Microdata schema.org
    # ------------------------------------------------------------------

    def _extract_microdata(self) -> Dict[str, Any]:
        out: Dict[str, Any] = {}
        scope = self.soup.find(attrs={"itemtype": re.compile(r"schema\.org/Product", re.I)})
        if not scope:
            return out

        def _itemprop(name: str) -> Optional[str]:
            el = scope.find(attrs={"itemprop": name})
            if not el:
                return None
            if el.has_attr("content"):
                return el["content"]
            if el.name == "img":
                return el.get("src") or el.get("data-src")
            if el.name == "a":
                return el.get("href")
            return el.get_text(strip=True) or None

        if name := _itemprop("name"):
            out["name"] = name
        if desc := _itemprop("description"):
            out["description"] = desc
        if sku := _itemprop("sku") or _itemprop("mpn") or _itemprop("gtin13"):
            out["sku"] = sku
        if image := _itemprop("image"):
            out["image"] = image
        if brand_el := scope.find(attrs={"itemprop": "brand"}):
            if brand_name := brand_el.get("content") or brand_el.get_text(strip=True):
                out["marque"] = brand_name
        # Offer dans le scope
        offer_el = scope.find(attrs={"itemtype": re.compile(r"schema\.org/Offer", re.I)})
        scope_offer = offer_el or scope
        if price_el := scope_offer.find(attrs={"itemprop": "price"}):
            price_raw = price_el.get("content") or price_el.get_text(strip=True)
            price = _safe_price(price_raw)
            if price is not None:
                out["prix"] = price
        if curr_el := scope_offer.find(attrs={"itemprop": "priceCurrency"}):
            currency = curr_el.get("content") or curr_el.get_text(strip=True)
            if currency:
                out["currency"] = currency
        return out

    # ------------------------------------------------------------------
    # 3) OpenGraph + product:* meta
    # ------------------------------------------------------------------

    def _extract_opengraph(self) -> Dict[str, Any]:
        out: Dict[str, Any] = {}

        def _meta(prop: str) -> Optional[str]:
            el = self.soup.find("meta", attrs={"property": prop}) \
                 or self.soup.find("meta", attrs={"name": prop})
            return el.get("content") if el and el.get("content") else None

        if name := _meta("og:title") or _meta("twitter:title"):
            out["name"] = name.strip()
        if desc := _meta("og:description") or _meta("twitter:description"):
            out["description"] = desc.strip()
        if img := _meta("og:image") or _meta("twitter:image") or _meta("og:image:secure_url"):
            out["image"] = img.strip()
        if url := _meta("og:url"):
            out["sourceUrl"] = url.strip()

        # Standard OpenGraph product (Facebook)
        price = _meta("product:price:amount") or _meta("og:price:amount")
        if price:
            v = _safe_price(price)
            if v is not None:
                out["prix"] = v
        currency = _meta("product:price:currency") or _meta("og:price:currency")
        if currency:
            out["currency"] = currency.strip().upper()
        if cond := _meta("product:condition"):
            cs = cond.lower()
            if "new" in cs:
                out["etat"] = "neuf"
            elif "used" in cs or "refurbished" in cs:
                out["etat"] = "occasion"
        if brand := _meta("product:brand") or _meta("og:brand"):
            out["marque"] = brand.strip()
        if cat := _meta("product:category") or _meta("article:section"):
            out["categorie"] = cat.strip()
        return out

    # ------------------------------------------------------------------
    # 4) Heuristiques DOM par marketplace
    # ------------------------------------------------------------------

    def _extract_heuristic(self, marketplace: str) -> Dict[str, Any]:
        selectors = _HEURISTIC_SELECTORS.get(marketplace)
        if not selectors:
            return {}
        out: Dict[str, Any] = {}
        for field, css_list in selectors.items():
            for css in css_list:
                try:
                    el = self.soup.select_one(css)
                except Exception:
                    continue
                if not el:
                    continue
                if field == "image":
                    val = el.get("src") or el.get("data-src") or el.get("data-old-hires")
                elif field == "price":
                    val = el.get_text(" ", strip=True)
                else:
                    val = el.get_text(" ", strip=True) or el.get("value")
                if val:
                    if field == "price":
                        p = _safe_price(val)
                        if p is not None:
                            out["prix"] = p
                            cur = _detect_currency(val)
                            if cur:
                                out["currency"] = cur
                    elif field == "name":
                        out["name"] = val.strip()
                    elif field == "image":
                        out["image"] = val.strip()
                    elif field == "sku":
                        out["sku"] = val.strip()
                    elif field == "brand":
                        out["marque"] = val.strip()
                    break
        return out

    # ------------------------------------------------------------------
    # 5) Fallback générique
    # ------------------------------------------------------------------

    def _extract_fallback(self) -> Dict[str, Any]:
        out: Dict[str, Any] = {}
        if title_tag := self.soup.find("title"):
            out["name"] = title_tag.get_text(strip=True)
        if h1 := self.soup.find("h1"):
            text = h1.get_text(" ", strip=True)
            if text and (not out.get("name") or len(text) > 5):
                out["name"] = text
        if first_img := self.soup.find("img"):
            src = first_img.get("src") or first_img.get("data-src")
            if src:
                out["image"] = src

        # Cherche un prix dans tout le DOM (meta, span class~="price"…)
        price_candidates: List[Tuple[float, str]] = []
        for el in self.soup.select("[class*='price'], [id*='price'], [data-price], "
                                    "[itemprop='price']"):
            txt = el.get("content") or el.get("data-price") or el.get_text(" ", strip=True)
            if not txt or len(txt) > 60:
                continue
            p = _safe_price(txt)
            if p and p > 0:
                price_candidates.append((p, txt))
        if price_candidates:
            # Meilleure heuristique : le plus fréquent / le plus "central"
            price_candidates.sort(key=lambda x: x[0])
            mid = price_candidates[len(price_candidates) // 2]
            out["prix"] = mid[0]
            cur = _detect_currency(mid[1])
            if cur:
                out["currency"] = cur

        # État (neuf / occasion) à partir du texte de la page
        body_text = self.soup.get_text(" ", strip=True).lower()[:5000]
        if any(w in body_text for w in _STATE_NEW) and not any(w in body_text for w in _STATE_USED):
            out.setdefault("etat", "neuf")
        elif any(w in body_text for w in _STATE_USED):
            out.setdefault("etat", "occasion")

        return out

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _guess_marketplace(self) -> Optional[str]:
        host = urlparse(self.base_url).netloc.lower()
        if "amazon" in host:
            return "amazon"
        if "ebay" in host:
            return "ebay"
        if "kijiji" in host:
            return "kijiji"
        # Détection Shopify via marqueurs HTML
        if "cdn.shopify.com" in self.html or "Shopify.theme" in self.html:
            return "shopify"
        return None

    def _post_process(self, product: Dict[str, Any]) -> None:
        # Résoudre l'image relative
        if img := product.get("image"):
            product["image"] = self._absolutize(img)
        if url := product.get("sourceUrl"):
            product["sourceUrl"] = self._absolutize(url)
        # Normaliser la currency
        if cur := product.get("currency"):
            product["currency"] = self._normalize_currency(cur)
        # Tronquer la description
        if desc := product.get("description"):
            product["description"] = str(desc).strip()[:1000]
        # name : strip + collapse whitespace
        if name := product.get("name"):
            product["name"] = re.sub(r"\s+", " ", str(name)).strip()

    def _absolutize(self, url: str) -> str:
        if not url:
            return url
        if url.startswith("//"):
            scheme = urlparse(self.base_url).scheme or "https"
            return f"{scheme}:{url}"
        if url.startswith("http"):
            return url
        if self.base_url:
            return urljoin(self.base_url, url)
        return url

    @staticmethod
    def _normalize_currency(c: str) -> str:
        c = c.strip().upper().replace("$", "")
        return {"CA": "CAD", "US": "USD"}.get(c, c) or c

    @staticmethod
    def _first_str(v: Any) -> Optional[str]:
        if v is None:
            return None
        if isinstance(v, str):
            return v.strip() or None
        if isinstance(v, list):
            for x in v:
                s = GenericProductExtractor._first_str(x)
                if s:
                    return s
            return None
        if isinstance(v, dict):
            for k in ("@value", "value", "name"):
                if k in v:
                    return GenericProductExtractor._first_str(v[k])
        try:
            return str(v).strip() or None
        except Exception:
            return None

    @staticmethod
    def _tolerant_json(raw: str) -> str:
        """Strip JS-style comments + trailing commas pour parser des JSON-LD pollués."""
        s = re.sub(r"/\*.*?\*/", "", raw, flags=re.DOTALL)
        s = re.sub(r"//[^\n]*", "", s)
        s = re.sub(r",(\s*[\]}])", r"\1", s)
        return s

    @staticmethod
    def _merge(target: Dict[str, Any], new: Dict[str, Any]) -> None:
        """Fusion non destructive : ne remplace pas une clé déjà présente."""
        for k, v in new.items():
            if v in (None, "", []):
                continue
            if k not in target or target[k] in (None, "", []):
                target[k] = v


# ---------------------------------------------------------------------------
# Helpers prix / currency (utilisables en standalone)
# ---------------------------------------------------------------------------

def _safe_price(v: Any) -> Optional[float]:
    """Convertit '1,299.99', '1 299,99 $', 'CAD 12.50', etc. → float."""
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return float(v) if v >= 0 else None
    s = str(v).strip()
    if not s:
        return None
    m = _PRICE_REGEX.search(s) or _PRICE_NUM_THEN_CURRENCY.search(s) or _NUMERIC_PRICE.search(s)
    if not m:
        return None
    try:
        raw = m.group("value") if "value" in m.groupdict() else m.group(0)
    except IndexError:
        raw = m.group(0)
    return _parse_price_string(raw)


def _parse_price_string(s: str) -> Optional[float]:
    """Parse '1,299.99' (en) ou '1 299,99' (fr) ou '12.50' (en) → float.
    Stratégie : si 2 séparateurs distincts → le 2nd est le décimal."""
    s = s.strip()
    if not s:
        return None
    # Toujours retirer les espaces (séparateur de milliers fr/qc)
    s = s.replace("\xa0", " ").replace(" ", "")
    has_comma = "," in s
    has_dot = "." in s

    if has_comma and has_dot:
        # Le séparateur le plus à droite est décimal
        if s.rfind(",") > s.rfind("."):
            s = s.replace(".", "").replace(",", ".")
        else:
            s = s.replace(",", "")
    elif has_comma and not has_dot:
        # Un seul ',': si ≥3 chiffres derrière, c'est un séparateur de milliers
        parts = s.split(",")
        if len(parts[-1]) == 3:
            s = s.replace(",", "")
        else:
            s = s.replace(",", ".")
    try:
        v = float(s)
        if v < 0 or v > 1e9:
            return None
        return v
    except (ValueError, TypeError):
        return None


def _detect_currency(text: str) -> Optional[str]:
    """Détecte la currency depuis un libellé brut ('CAD 12.50', '$ 9.99', '€10')."""
    t = text.strip().upper()
    for sym, code in (("CAD", "CAD"), ("USD", "USD"), ("EUR", "EUR"), ("GBP", "GBP"),
                      ("CA$", "CAD"), ("US$", "USD"), ("$", "USD"), ("€", "EUR"), ("£", "GBP")):
        if sym in t:
            return code
    return None


# ---------------------------------------------------------------------------
# API publique simple
# ---------------------------------------------------------------------------

def extract_product(html: str, *, base_url: str = "",
                    marketplace_hint: Optional[str] = None) -> Dict[str, Any]:
    """Wrapper fonctionnel : extrait un produit depuis du HTML brut."""
    return GenericProductExtractor(html, base_url=base_url,
                                    marketplace_hint=marketplace_hint).extract()


def extract_products_from_listing(html: str, *, base_url: str = "",
                                   item_selector: Optional[str] = None,
                                   max_items: int = 100) -> List[Dict[str, Any]]:
    """Extrait une liste de produits depuis une page de résultats / catégorie.

    Stratégie : si JSON-LD `ItemList` présent → parse direct.
    Sinon → cherche les blocs `[itemtype*=Product]` ou utilise `item_selector`.
    Pour chaque bloc, lance un mini-extracteur (inner HTML)."""
    products: List[Dict[str, Any]] = []
    try:
        soup = BeautifulSoup(html, "lxml")
    except Exception:
        soup = BeautifulSoup(html, "html.parser")

    # 1) ItemList JSON-LD
    for script in soup.find_all("script", type=lambda t: t and "ld+json" in t.lower()):
        raw = script.string or script.get_text() or ""
        try:
            data = json.loads(raw)
        except Exception:
            continue
        for node in GenericProductExtractor._iter_jsonld_nodes(data):
            t = GenericProductExtractor._normalize_type(node.get("@type"))
            if "itemlist" not in t:
                continue
            items = node.get("itemListElement") or []
            for it in items:
                if not isinstance(it, dict):
                    continue
                product = it.get("item") if isinstance(it.get("item"), dict) else it
                if isinstance(product, dict):
                    extracted = GenericProductExtractor("", base_url=base_url) \
                        ._jsonld_product_to_dict(product)
                    if extracted.get("name"):
                        products.append(extracted)
                if len(products) >= max_items:
                    return products

    if products:
        return products

    # 2) Microdata Products dans la page
    blocks: List[Tag] = []
    if item_selector:
        try:
            blocks = soup.select(item_selector)
        except Exception:
            blocks = []
    if not blocks:
        blocks = soup.find_all(attrs={"itemtype": re.compile(r"schema\.org/Product", re.I)})
    for blk in blocks[:max_items]:
        sub_extractor = GenericProductExtractor(str(blk), base_url=base_url)
        product = sub_extractor.extract()
        if product.get("name"):
            products.append(product)
    return products
