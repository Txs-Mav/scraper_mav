"""
GenericDealerAdapter — recherche on-site générique sur un domaine arbitraire.

Cas d'usage : un utilisateur a un concurrent qui n'a pas (encore) de scraper
dédié dans le `DedicatedScraperRegistry`. On essaie quand même d'interroger
son moteur de recherche interne, en testant successivement des patterns
d'URL communs (`/search?q=`, `/recherche?q=`, etc.).

Stratégie en cascade :

  1. Skip si le domaine est déjà couvert par `DedicatedScraperRegistry`
     (le `DedicatedScraperAdapter` s'en charge mieux, avec cache).
  2. Pour chaque pattern de search on-site, rend la page via BrowserAgent.
  3. Au premier rendu qui produit ≥1 produit (via JSON-LD / microdata /
     extracteur générique), on stoppe.
  4. Si aucun pattern ne fonctionne, on tente un fallback Google
     `site:<domain> <query>` (mini SERP).

Limitations connues :
  - Pas de détection de pagination (1ʳᵉ page seulement).
  - Pas de routing par catégorie : seul le scoring filtre.
  - Performance : 1 domaine = 1 BrowserAgent (peut être lent si plusieurs
     patterns échouent avant succès — on limite à 3 patterns tentés max).
"""
from __future__ import annotations

import re
from typing import Any, Dict, List, Optional
from urllib.parse import quote_plus, urlparse

from ..extractors import GenericProductExtractor, extract_products_from_listing
from ..models import SearchHit, SearchQuery
from ..scoring import select_hits
from .base import AdapterError, SearchAdapter


# Patrons de recherche on-site, ordonnés par fréquence empirique observée
# sur les concessionnaires québécois/canadiens.
_SEARCH_PATTERNS: List[str] = [
    "/search?q={q}",
    "/recherche?q={q}",
    "/?s={q}",                  # WordPress / WooCommerce
    "/inventory?keyword={q}",   # plateformes véhicules
    "/inventaire?keyword={q}",
    "/products?q={q}",          # Shopify (déjà couvert ailleurs mais ne mange pas de pain)
    "/shop?q={q}",
]

# Combien de patterns on tente avant d'abandonner (pour limiter le temps).
_MAX_PATTERNS_TO_TRY = 3

# Marqueurs textuels qui indiquent "aucun résultat" sur une page (pour
# éviter de considérer une SERP vide comme une vraie réponse).
_EMPTY_RESULT_MARKERS = (
    "aucun résultat",
    "no results",
    "0 résultats",
    "0 results",
    "no products found",
    "aucun produit",
)


class GenericDealerAdapter(SearchAdapter):
    """Adapter on-site générique pour un concessionnaire sans scraper dédié."""

    # serves_categories=['*'] : on n'a aucun a priori sur ce que vend le site,
    # mais on s'active seulement si l'utilisateur a explicitement listé ce
    # domaine (cf. applies_to() override). On ne se mêle PAS du routing par
    # catégorie : c'est au scoring de filtrer.
    serves_categories: List[str] = ["*"]
    supported_types: List[str] = []

    default_timeout_ms = 18000
    max_scrolls = 2

    def __init__(self, domain: str, *,
                 timeout_ms: Optional[int] = None,
                 enable_google_fallback: bool = True):
        """
        Args:
            domain: domaine bare (ex: 'monconcess.com') ou URL complète.
            timeout_ms: timeout par page rendue.
            enable_google_fallback: si True, tente `site:<domain>` sur Google
                quand tous les patterns on-site échouent.
        """
        self.domain = self._normalize_domain(domain)
        self.site_url = f"https://{self.domain}"
        # Nom affiché : on capitalise le domaine pour avoir un libellé sympa.
        self.name = self.domain
        self.timeout_ms = timeout_ms or self.default_timeout_ms
        self.enable_google_fallback = enable_google_fallback

    @staticmethod
    def _normalize_domain(raw: str) -> str:
        """Accepte 'monconcess.com', 'https://www.monconcess.com', etc."""
        s = (raw or "").strip().lower()
        if not s:
            raise ValueError("domain est vide")
        # Strip schema
        s = re.sub(r"^https?://", "", s)
        # Strip path/query
        s = s.split("/", 1)[0]
        # Strip www.
        if s.startswith("www."):
            s = s[4:]
        return s

    # ------------------------------------------------------------------
    # Routing
    # ------------------------------------------------------------------

    def applies_to(self, query: SearchQuery) -> bool:
        """Un adapter générique n'est instancié QUE pour des domaines explicitement
        fournis par l'utilisateur. On accepte donc toujours."""
        return True

    # ------------------------------------------------------------------
    # search()
    # ------------------------------------------------------------------

    def search(self, query: SearchQuery, *, max_results: int = 50) -> List[SearchHit]:
        text = query.search_text()
        if not text:
            return []

        try:
            from scraper_ai.scraper_usine.browser_agent import BrowserAgent
        except ImportError as e:
            raise AdapterError(f"BrowserAgent indisponible: {e}")

        all_products: List[Dict[str, Any]] = []

        try:
            with BrowserAgent(block_assets=True, locale="fr-CA") as agent:
                # 1) On-site search : on tente les patterns prioritaires.
                products = self._try_onsite_patterns(agent, text)
                all_products.extend(products)

                # 2) Fallback Google site: si rien trouvé on-site.
                if not all_products and self.enable_google_fallback:
                    try:
                        google_products = self._try_google_site(agent, text)
                        all_products.extend(google_products)
                    except Exception as e:
                        # Le fallback ne doit pas faire planter l'adapter.
                        print(f"[GenericDealer/{self.domain}] Google fallback failed: {e}")
        except AdapterError:
            raise
        except Exception as e:
            raise AdapterError(f"{self.name} session error: {e}")

        if not all_products:
            return []

        return self._score_and_filter(query, all_products, max_results)

    # ------------------------------------------------------------------
    # On-site search
    # ------------------------------------------------------------------

    def _try_onsite_patterns(self, agent, text: str) -> List[Dict[str, Any]]:
        """Tente plusieurs patterns d'URL de search ; stoppe au 1er qui produit
        ≥1 produit extractable."""
        encoded = quote_plus(text)
        tried = 0
        for pattern in _SEARCH_PATTERNS:
            if tried >= _MAX_PATTERNS_TO_TRY:
                break
            url = f"https://{self.domain}{pattern.format(q=encoded)}"
            tried += 1
            try:
                result = agent.render(
                    url,
                    timeout_ms=self.timeout_ms,
                    networkidle_ms=2000,
                    scroll=True,
                    max_scrolls=self.max_scrolls,
                    dismiss_cookies=True,
                    post_load_wait_ms=1000,
                )
            except Exception:
                continue

            html = result.html or ""
            if not html or len(html) < 1500:
                continue
            if self._looks_empty(html):
                continue
            # Filtre rapide : si après redirect on est sur la home (pas de
            # query string ni de path qui suggère une SERP), on skip.
            final_url = (result.final_url or url).lower()
            if final_url == f"https://{self.domain}/" or final_url == f"https://{self.domain}":
                continue

            products = self._parse_listing(html, base_url=result.final_url or url)
            if products:
                return products

        return []

    # ------------------------------------------------------------------
    # Google site: fallback
    # ------------------------------------------------------------------

    def _try_google_site(self, agent, text: str) -> List[Dict[str, Any]]:
        """Dernier recours : `site:<domain> <text>` sur Google, on récupère
        les liens et on extrait quelques fiches produit individuelles."""
        google_url = (
            f"https://www.google.com/search?"
            f"q=site%3A{quote_plus(self.domain)}+{quote_plus(text)}"
            f"&hl=fr-CA&gl=ca&num=10"
        )
        try:
            result = agent.render(
                google_url,
                timeout_ms=self.timeout_ms,
                networkidle_ms=1500,
                dismiss_cookies=True,
            )
        except Exception as e:
            raise AdapterError(f"Google fallback render error: {e}")

        html = result.html or ""
        # Extraction des liens vers le domaine cible depuis le HTML Google.
        # On cherche les URLs qui contiennent notre domaine et qui ne sont
        # pas la home.
        pattern = re.compile(
            r'href="(https?://[^"]*?' + re.escape(self.domain) + r'[^"]*)"',
            re.IGNORECASE,
        )
        urls: List[str] = []
        seen = set()
        for m in pattern.finditer(html):
            u = m.group(1)
            # On ignore les URLs google internes ("/url?q=" stripping).
            if "google." in u or "/url?q=" in u:
                continue
            # Strip fragment/query trailing
            clean = u.split("#")[0]
            if clean in seen:
                continue
            seen.add(clean)
            # Ignore la home et les pages de catégorie évidentes
            parsed = urlparse(clean)
            if not parsed.path or parsed.path == "/":
                continue
            urls.append(clean)
            if len(urls) >= 5:
                break

        if not urls:
            return []

        # Pour chaque URL on rend la fiche et on extrait le produit.
        products: List[Dict[str, Any]] = []
        for u in urls:
            try:
                fiche = agent.render(
                    u,
                    timeout_ms=self.timeout_ms,
                    networkidle_ms=1500,
                    dismiss_cookies=True,
                )
            except Exception:
                continue
            single = GenericProductExtractor(
                fiche.html or "", base_url=u,
            ).extract()
            if single.get("name") and single.get("sourceUrl"):
                single["_source"] = self.name
                products.append(single)

        return products

    # ------------------------------------------------------------------
    # Parsing
    # ------------------------------------------------------------------

    def _parse_listing(self, html: str, *, base_url: str) -> List[Dict[str, Any]]:
        """Extrait une liste de produits via JSON-LD ItemList puis fallback
        sélecteur générique."""
        products = extract_products_from_listing(
            html, base_url=base_url, max_items=40,
        )
        out: List[Dict[str, Any]] = []
        for p in products:
            if not p.get("name") or not p.get("sourceUrl"):
                continue
            p["_source"] = self.name
            out.append(p)

        # Fallback : si pas de liste détectée, on tente d'extraire UN produit
        # (utile si l'utilisateur a tapé un nom très précis et que la SERP
        # contient une seule fiche).
        if not out:
            single = GenericProductExtractor(html, base_url=base_url).extract()
            if single.get("name") and single.get("sourceUrl"):
                single["_source"] = self.name
                out.append(single)
        return out

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _looks_empty(html: str) -> bool:
        """True si la page contient un marqueur 'aucun résultat'."""
        if not html:
            return True
        haystack = html[:10000].lower()
        return any(marker in haystack for marker in _EMPTY_RESULT_MARKERS)

    def _score_and_filter(self, query: SearchQuery,
                          products: List[Dict[str, Any]],
                          max_results: int) -> List[SearchHit]:
        slug = f"generic-{re.sub(r'[^a-z0-9]+', '-', self.domain).strip('-')}"
        hits, scanned, approx = select_hits(
            query, products,
            max_results=max_results,
            source_site=self.domain, source_slug=slug,
            dedup_key=lambda p: (p.get("sku") or "") or p.get("sourceUrl") or p.get("name") or None,
        )
        self.last_products_scanned = scanned
        self.last_approximate_count = approx
        return hits


# ---------------------------------------------------------------------------
# Factory
# ---------------------------------------------------------------------------

def build_generic_dealer_adapters(
    domains: List[str], *,
    enable_google_fallback: bool = True,
) -> List[GenericDealerAdapter]:
    """Construit un adapter par domaine fourni.

    Ignore (silencieusement) les domaines déjà couverts par un scraper dédié
    enregistré dans `DedicatedScraperRegistry` : ces domaines seront servis
    par le `DedicatedScraperAdapter` (plus rapide et plus fiable grâce au
    cache d'inventaire).
    """
    if not domains:
        return []

    # Domaines déjà couverts
    covered: set = set()
    try:
        from scraper_ai.dedicated_scrapers.registry import _DOMAIN_MAP
        covered = {d.lower() for d in _DOMAIN_MAP.keys()}
    except Exception:
        pass

    adapters: List[GenericDealerAdapter] = []
    seen = set()
    for raw in domains:
        try:
            normalized = GenericDealerAdapter._normalize_domain(raw)
        except ValueError:
            continue
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        if normalized in covered or f"www.{normalized}" in covered:
            # Couvert par scraper dédié — on saute (DedicatedScraperAdapter le gère).
            continue
        adapters.append(GenericDealerAdapter(
            normalized,
            enable_google_fallback=enable_google_fallback,
        ))
    return adapters
