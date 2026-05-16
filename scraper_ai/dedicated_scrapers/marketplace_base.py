"""
Base pour les scrapers "marketplace" (annonces multi-vendeurs).

Contrairement aux concessionnaires (inventaire borné), les marketplaces
comme Kijiji, AutoTrader, LesPAC ou CycleTrader exposent des millions
d'annonces. On ne peut pas tout scraper d'un coup.

Stratégie adoptée : "scraping ciblé par référence". Au lieu de balayer
le marketplace avec des seeds génériques (Honda, Yamaha, ...), on lit
les modèles présents dans le site de référence de chaque utilisateur
qui a coché ce marketplace en concurrent, et on ne cherche QUE ces
modèles-là. On obtient ainsi un cache 100 % pertinent pour la
comparaison de prix.

Fallback : si aucun utilisateur n'a coché le marketplace, ou si aucune
référence n'a encore de produits dans `scraped_site_data`, on retombe
sur la liste de seeds génériques par défaut pour garder un snapshot
minimal disponible.

Le scraper hérite de `DedicatedScraper` pour s'intégrer naturellement
avec le scraper_cron.py horaire (qui scrape tous les `shared_scrapers`
actifs).
"""
from __future__ import annotations

import os
import time
from typing import Any, Dict, List, Optional, Tuple

import requests
from bs4 import BeautifulSoup

from .base import DedicatedScraper

# Seeds de fallback : marques powersport courantes. Utilisées seulement
# quand aucune référence utilisateur n'est disponible (premier lancement,
# pas d'user actif sur ce marketplace, etc.).
DEFAULT_MARKETPLACE_SEEDS: List[str] = [
    "honda",
    "yamaha",
    "kawasaki",
    "suzuki",
    "ktm",
    "harley-davidson",
    "bmw",
    "can-am",
    "ski-doo",
    "polaris",
]

# Plafond : au-delà, le scrape devient trop long et risque de timeout.
# 80 seeds × 30 résultats = 2 400 produits, ~30 min Playwright = OK.
MAX_TARGETED_SEEDS = 80


class MarketplaceSnapshotScraper(DedicatedScraper):
    """Scraper qui interroge un adaptateur de recherche fédérée avec des
    seeds ciblées sur les modèles de référence des utilisateurs.

    Les sous-classes doivent définir :
      - SITE_NAME, SITE_SLUG, SITE_URL, SITE_DOMAIN
      - _build_adapter() qui retourne un SearchAdapter prêt

    Les sous-classes peuvent override :
      - DEFAULT_SEEDS : seeds de fallback (si aucune référence dispo)
      - PER_SEED_MAX_RESULTS : nb de hits par requête
    """

    MAX_WORKERS: int = 1  # adaptateurs Playwright → un seul à la fois
    DEFAULT_SEEDS: List[str] = DEFAULT_MARKETPLACE_SEEDS
    PER_SEED_MAX_RESULTS: int = 30
    PER_SEED_TIMEOUT_SECONDS: int = 60

    def _build_adapter(self):
        """À implémenter dans les sous-classes — retourne un SearchAdapter prêt."""
        raise NotImplementedError

    # ── Méthodes abstraites de DedicatedScraper (non utilisées en pratique) ──
    def discover_product_urls(self, categories: Optional[List[str]] = None) -> List[str]:
        return []

    def extract_from_detail_page(self, url: str, html: str, soup: BeautifulSoup) -> Optional[Dict]:
        return None

    # ── Pipeline override : on remplace `scrape()` pour ne pas dépendre
    #    du flow découverte URL → fetch détail. ──
    def scrape(self, categories: Optional[List[str]] = None, inventory_only: bool = False) -> Dict[str, Any]:
        try:
            from scraper_ai.scraper_search.models import SearchQuery
        except Exception as e:
            print(f"   ⚠️  {self.SITE_DOMAIN}: scraper_search indisponible — {e}")
            return self._empty_marketplace_result(start_time=time.time())

        start_time = time.time()
        print(f"\n{'='*70}")
        print(f"🛒 SCRAPER MARKETPLACE: {self.SITE_NAME}")
        print(f"{'='*70}")
        print(f"🌐 Site: {self.SITE_URL}")

        seeds, seed_source = self._resolve_seeds()
        print(f"🌱 Seeds: {len(seeds)} ({seed_source})")
        if not seeds:
            return self._empty_marketplace_result(start_time=start_time)

        try:
            adapter = self._build_adapter()
        except Exception as e:
            print(f"   ❌ Échec construction adaptateur {self.SITE_DOMAIN}: {e}")
            return self._empty_marketplace_result(start_time=start_time)

        all_products: List[Dict[str, Any]] = []
        seen_urls: set[str] = set()
        success_seeds = 0

        for seed in seeds:
            try:
                query = self._build_query_for_seed(SearchQuery, seed)
                seed_start = time.time()
                hits = adapter.search(query, max_results=self.PER_SEED_MAX_RESULTS) or []
                elapsed = time.time() - seed_start
                kept = 0
                for hit in hits:
                    url = getattr(hit, "source_url", "") or ""
                    if url and url in seen_urls:
                        continue
                    product = _hit_to_product(hit, fallback_site=self.SITE_URL)
                    if not product:
                        continue
                    if url:
                        seen_urls.add(url)
                    all_products.append(product)
                    kept += 1
                success_seeds += 1
                print(f"   ✅ seed '{seed}': {kept} produit(s) en {elapsed:.1f}s")
            except Exception as e:
                print(f"   ⚠️  seed '{seed}' a échoué: {type(e).__name__} — {e}")
                continue

        elapsed = time.time() - start_time
        print(f"\n{'='*70}")
        print(f"✅ {self.SITE_NAME}: {len(all_products)} produit(s) "
              f"({success_seeds}/{len(seeds)} seeds OK) en {elapsed:.1f}s")
        print(f"{'='*70}")

        return {
            'products': all_products,
            'metadata': {
                'site_url': self.SITE_URL,
                'site_name': self.SITE_NAME,
                'scraper_type': 'marketplace_snapshot',
                'scraper_module': self.SITE_SLUG,
                'products_count': len(all_products),
                'seeds_source': seed_source,
                'seeds_executed': len(seeds),
                'seeds_succeeded': success_seeds,
                'execution_time_seconds': round(elapsed, 2),
                'cache_status': 'marketplace',
            },
            'scraper_info': {
                'type': 'marketplace_snapshot',
                'module': self.SITE_SLUG,
            }
        }

    def _build_query_for_seed(self, SearchQuery, seed: str):
        """Construit une SearchQuery depuis une seed textuelle.

        Une seed peut être :
          - une simple marque ("honda")
          - une chaîne marque+modèle ("honda crf450r")
          - marque+modèle+année ("honda crf450r 2024")
        """
        parts = seed.strip().split()
        marque = parts[0] if parts else seed
        modele = " ".join(parts[1:]) if len(parts) > 1 else None
        return SearchQuery(
            raw_text=seed,
            marque=marque,
            modele=modele,
            max_results=self.PER_SEED_MAX_RESULTS,
        )

    def _resolve_seeds(self) -> Tuple[List[str], str]:
        """Détermine les seeds à utiliser : référence-ciblées en priorité,
        sinon DEFAULT_SEEDS.

        Retourne (seeds, source) où source est l'un de :
          - 'targeted'  : modèles dérivés des références utilisateur
          - 'default'   : seeds génériques (fallback)
          - 'no_supabase' : env Supabase manquante → fallback default
        """
        supabase_url = os.environ.get("SUPABASE_URL")
        supabase_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
        if not supabase_url or not supabase_key:
            return list(self.DEFAULT_SEEDS), 'no_supabase'

        try:
            targeted = _collect_targeted_seeds(
                supabase_url=supabase_url,
                supabase_key=supabase_key,
                marketplace_domain=self.SITE_DOMAIN,
                limit=MAX_TARGETED_SEEDS,
            )
        except Exception as e:
            print(f"   ⚠️  Collecte seeds ciblées impossible — fallback default ({type(e).__name__}: {e})")
            return list(self.DEFAULT_SEEDS), 'default'

        if not targeted:
            print(f"   ℹ️  Aucune référence utilisateur pour {self.SITE_DOMAIN} — fallback default")
            return list(self.DEFAULT_SEEDS), 'default'

        return targeted, 'targeted'

    def _empty_marketplace_result(self, start_time: float) -> Dict[str, Any]:
        elapsed = time.time() - start_time
        return {
            'products': [],
            'metadata': {
                'site_url': self.SITE_URL,
                'site_name': self.SITE_NAME,
                'scraper_type': 'marketplace_snapshot',
                'scraper_module': self.SITE_SLUG,
                'products_count': 0,
                'execution_time_seconds': round(elapsed, 2),
                'cache_status': 'marketplace_empty',
            },
            'scraper_info': {
                'type': 'marketplace_snapshot',
                'module': self.SITE_SLUG,
            }
        }


# ── Collecte des seeds ciblées depuis Supabase ─────────────────────────

def _collect_targeted_seeds(
    *,
    supabase_url: str,
    supabase_key: str,
    marketplace_domain: str,
    limit: int = MAX_TARGETED_SEEDS,
) -> List[str]:
    """Lit `scraper_config` + `scraped_site_data` pour construire la liste
    des seeds (marque + modèle uniques) à interroger sur ce marketplace.

    Étapes :
      1. Lit tous les `scraper_config` actifs avec une `reference_url`.
      2. Garde ceux dont `competitor_urls` contient `marketplace_domain`.
      3. Pour chaque user retenu, lit les produits du site de référence
         depuis `scraped_site_data[ref_domain]`.
      4. Dédoublonne par (marque, modèle).
      5. Retourne max `limit` seeds, triées par fréquence (modèles les
         plus communs en premier).
    """
    headers = {"apikey": supabase_key, "Authorization": f"Bearer {supabase_key}"}

    # 1) Lecture des configs
    resp = requests.get(
        f"{supabase_url}/rest/v1/scraper_config",
        params={
            "select": "user_id,reference_url,competitor_urls",
            "reference_url": "not.is.null",
        },
        headers=headers,
        timeout=30,
    )
    if resp.status_code != 200:
        return []
    configs = resp.json() or []

    # 2) Filtre sur le marketplace
    target_users: List[Tuple[str, str]] = []  # (user_id, ref_domain)
    for c in configs:
        ref_url = c.get("reference_url", "")
        competitors = c.get("competitor_urls") or []
        if not ref_url or not competitors:
            continue
        if not any(marketplace_domain in (u or "").lower() for u in competitors):
            continue
        target_users.append((c["user_id"], _domain_from_url(ref_url)))

    if not target_users:
        return []

    # 3) Lecture des produits de référence (un seul GET par domaine unique)
    unique_ref_domains = list({d for _, d in target_users if d})
    if not unique_ref_domains:
        return []

    ref_products_by_domain: Dict[str, List[dict]] = {}
    # PostgREST `in.(...)` syntax
    in_filter = ",".join(unique_ref_domains)
    resp = requests.get(
        f"{supabase_url}/rest/v1/scraped_site_data",
        params={
            "select": "site_domain,products",
            "site_domain": f"in.({in_filter})",
            "status": "eq.success",
        },
        headers=headers,
        timeout=60,
    )
    if resp.status_code == 200:
        for row in resp.json() or []:
            domain = row.get("site_domain", "")
            products = row.get("products") or []
            if domain and products:
                ref_products_by_domain[domain] = products

    # 4) Agrégation des (marque, modèle) avec compteur de fréquence
    seed_counts: Dict[str, int] = {}
    for _user_id, ref_domain in target_users:
        products = ref_products_by_domain.get(ref_domain, [])
        for p in products:
            seed = _product_to_seed(p)
            if not seed:
                continue
            seed_counts[seed] = seed_counts.get(seed, 0) + 1

    if not seed_counts:
        return []

    # 5) Tri par fréquence décroissante puis cap à `limit`
    sorted_seeds = sorted(seed_counts.items(), key=lambda kv: (-kv[1], kv[0]))
    return [seed for seed, _ in sorted_seeds[:limit]]


def _domain_from_url(url: str) -> str:
    try:
        if not url.startswith(("http://", "https://")):
            url = "https://" + url
        from urllib.parse import urlparse
        return urlparse(url).netloc.replace("www.", "").lower()
    except Exception:
        return ""


def _product_to_seed(product: dict) -> Optional[str]:
    """Convertit un produit en seed 'marque modele' (lowercase, trimmed)."""
    if not isinstance(product, dict):
        return None
    marque = str(product.get("marque") or "").strip().lower()
    modele = str(product.get("modele") or "").strip().lower()
    if not marque and not modele:
        return None
    # On exige au moins une marque pour éviter les seeds trop vagues comme
    # juste "ninja 500" (qui matchent peu sur les marketplaces).
    if not marque:
        return None
    if modele:
        # Limiter la longueur du modèle pour éviter de matcher du bruit
        # (descriptions longues parfois mises dans le champ modele).
        modele = " ".join(modele.split()[:3])
        return f"{marque} {modele}".strip()
    return marque


def _hit_to_product(hit: Any, *, fallback_site: str) -> Optional[Dict[str, Any]]:
    """Convertit un SearchHit en dict produit compatible avec scraped_site_data."""
    name = getattr(hit, "name", "") or ""
    if not name or len(name) < 3:
        return None
    prix = getattr(hit, "prix", None)
    try:
        prix_val = float(prix) if prix is not None else None
    except (TypeError, ValueError):
        prix_val = None
    return {
        'name': name,
        'prix': prix_val,
        'annee': getattr(hit, "annee", None),
        'marque': getattr(hit, "marque", None),
        'modele': getattr(hit, "modele", None),
        'kilometrage': getattr(hit, "kilometrage", None),
        'couleur': getattr(hit, "couleur", None),
        'etat': getattr(hit, "etat", None),
        'image': getattr(hit, "image", "") or "",
        'description': getattr(hit, "description", "") or "",
        'sourceUrl': getattr(hit, "source_url", "") or "",
        'sourceSite': getattr(hit, "source_site", "") or fallback_site,
        'sourceCategorie': 'marketplace',
    }
