"""
Comparaison rapide depuis les données pré-scrapées (scraped_site_data).

Appelé quand un utilisateur clique "Analyser maintenant" (méthode du cache).

Flow :
  1. Lit la config utilisateur (référence + concurrents)
  2. Pour chaque site → lit les produits depuis scraped_site_data
  3. Si un site n'a AUCUNE donnée → fallback scraping temps-réel + stockage
  4. Compare les produits (find_matching_products)
  5. Sauvegarde le résultat dans scrapings

Temps typique :
  - Tous les sites en cache : ~2-5 s
  - 1 site manquant + fallback scrape : ~30-90 s
  - Tous les sites manquants : ~3-10 min (équivalent au mode classique)

Usage :
  python scripts/compare_from_cache.py --user-id UUID
"""

import argparse
import os
import sys
import time
from pathlib import Path
from typing import Dict, List
from urllib.parse import urlparse

SCRIPT_DIR = Path(__file__).parent
PROJECT_ROOT = SCRIPT_DIR.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from _http_helpers import get_with_retry, post_with_retry

from scraper_ai.comparison import (
    find_matching_products,
    enrich_product_year,
    clean_product_name,
)
from scraper_ai.dedicated_scrapers.registry import DedicatedScraperRegistry


def _domain(url: str) -> str:
    try:
        if url and not url.startswith(('http://', 'https://')):
            url = 'https://' + url
        netloc = urlparse(url).netloc
        if not netloc:
            return url.lower().split('/')[0].replace('www.', '')
        return netloc.replace('www.', '').lower()
    except Exception:
        return url.lower().replace('www.', '').split('/')[0]


def _headers(supabase_key: str) -> dict:
    return {
        "apikey": supabase_key,
        "Authorization": f"Bearer {supabase_key}",
    }


def _fetch_user_config(supabase_url: str, supabase_key: str, user_id: str) -> dict:
    resp = get_with_retry(
        f"{supabase_url}/rest/v1/scraper_config",
        params={
            "select": "reference_url,competitor_urls,ignore_colors,match_mode,filter_catalogue_reference",
            "user_id": f"eq.{user_id}",
        },
        headers=_headers(supabase_key),
        timeout=20,
        max_attempts=4,
        logger=print,
    )
    if resp is None or resp.status_code != 200 or not resp.json():
        return {}
    return resp.json()[0]


STALE_THRESHOLD_HOURS = 2
CRON_LOCK_DOMAIN = '__cron_lock__'
CRON_LOCK_TIMEOUT_MINUTES = 45


def _is_cron_running(supabase_url: str, supabase_key: str) -> bool:
    """Vérifie si le cron scraper est actuellement en cours d'exécution.

    Lit la ligne sentinelle __cron_lock__ dans scraped_site_data.
    Retourne True si status='running' et scraped_at < 45 min (pas un lock périmé).
    """
    try:
        resp = get_with_retry(
            f"{supabase_url}/rest/v1/scraped_site_data",
            params={
                "select": "status,scraped_at",
                "site_domain": f"eq.{CRON_LOCK_DOMAIN}",
            },
            headers=_headers(supabase_key),
            timeout=15,
            max_attempts=3,
        )
        if resp is None or resp.status_code != 200 or not resp.json():
            return False

        row = resp.json()[0]
        if row.get("status") != "running":
            return False

        scraped_at = row.get("scraped_at", "")
        if not scraped_at:
            return False

        from datetime import datetime as dt, timezone as tz, timedelta
        lock_time = dt.fromisoformat(scraped_at.replace("Z", "+00:00"))
        age = dt.now(tz.utc) - lock_time
        if age > timedelta(minutes=CRON_LOCK_TIMEOUT_MINUTES):
            print(f"   ⚠️  Cron lock trouvé mais périmé ({age.total_seconds()/60:.0f} min) — ignoré")
            return False

        return True
    except Exception:
        return False


def _fetch_site_products(supabase_url: str, supabase_key: str, domain: str) -> tuple[List[dict], bool, int]:
    """Lit les produits pré-scrapés. Retourne (products, is_stale, age_minutes).
    
    Retourne ([], False, 0) si rien n'existe.
    Retourne (products, True, age) si les données existent mais sont vieilles de >2h.
    Retourne (products, False, age) si les données sont fraîches.
    """
    resp = get_with_retry(
        f"{supabase_url}/rest/v1/scraped_site_data",
        params={
            "select": "products,product_count,scraped_at,status",
            "site_domain": f"eq.{domain}",
        },
        headers=_headers(supabase_key),
        timeout=30,
        max_attempts=4,
        logger=print,
    )
    if resp is None or resp.status_code != 200 or not resp.json():
        return [], False, 0
    row = resp.json()[0]
    if row.get("status") != "success":
        return [], False, 0
    products = row.get("products", [])
    if not products:
        return [], False, 0

    scraped_at = row.get("scraped_at", "")
    is_stale = False
    age_min = 0
    if scraped_at:
        try:
            from datetime import datetime as dt, timezone as tz, timedelta
            scraped_dt = dt.fromisoformat(scraped_at.replace("Z", "+00:00"))
            age = dt.now(tz.utc) - scraped_dt
            age_min = int(age.total_seconds() / 60)
            is_stale = age > timedelta(hours=STALE_THRESHOLD_HOURS)
        except Exception:
            pass

    return products, is_stale, age_min


def _fallback_scrape(domain: str, site_url: str, supabase_url: str, supabase_key: str) -> List[dict]:
    """Scraping temps-réel d'un site manquant via son scraper dédié.
    
    Stocke aussi le résultat dans scraped_site_data pour les prochaines requêtes.
    """
    scraper = DedicatedScraperRegistry.get_by_url(site_url)
    if not scraper:
        print(f"   ⚠️  {domain}: pas de scraper dédié, impossible de scraper en fallback")
        return []

    print(f"   🔄 {domain}: scraping temps-réel (fallback)...")
    start = time.time()
    try:
        result = scraper.scrape(
            categories=['inventaire', 'occasion', 'catalogue'],
            inventory_only=False,
        )
        products = result.get('products', [])
        elapsed = time.time() - start
        print(f"   ✅ {domain}: {len(products)} produits en {elapsed:.0f}s (fallback)")

        if products:
            _save_fallback_to_cache(supabase_url, supabase_key, domain, site_url, products, result.get('metadata', {}), elapsed)

        return products
    except Exception as e:
        elapsed = time.time() - start
        print(f"   ❌ {domain}: échec fallback en {elapsed:.0f}s — {e}")
        return []


def _save_fallback_to_cache(supabase_url: str, supabase_key: str,
                            domain: str, site_url: str,
                            products: List[dict], metadata: dict, elapsed: float):
    """Stocke les produits scrapés en fallback dans scraped_site_data pour le futur."""
    from datetime import datetime as dt, timezone as tz
    now = dt.now(tz.utc).isoformat()
    row = {
        "site_url": site_url,
        "site_domain": domain,
        "products": products,
        "product_count": len(products),
        "metadata": metadata,
        "scraped_at": now,
        "scrape_duration_seconds": round(elapsed, 1),
        "status": "success",
        "error_message": None,
        "updated_at": now,
    }
    headers = {
        **_headers(supabase_key),
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=representation",
    }
    try:
        resp = post_with_retry(
            f"{supabase_url}/rest/v1/scraped_site_data",
            json=row,
            headers=headers,
            params={"on_conflict": "site_domain"},
            timeout=45,
            max_attempts=3,
            logger=print,
        )
        if resp is None:
            print(f"   ⚠️  {domain}: sauvegarde fallback impossible (Supabase injoignable)")
        elif resp.status_code in (200, 201):
            print(f"   💾 {domain}: fallback sauvegardé dans scraped_site_data")
        else:
            print(f"   ⚠️  {domain}: erreur sauvegarde fallback ({resp.status_code})")
    except Exception as e:
        print(f"   ⚠️  {domain}: erreur sauvegarde fallback — {e}")


def _save_scrapings(supabase_url: str, supabase_key: str, row: dict) -> bool:
    headers = {
        **_headers(supabase_key),
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }
    resp = post_with_retry(
        f"{supabase_url}/rest/v1/scrapings",
        json=row,
        headers=headers,
        timeout=45,
        max_attempts=4,
        logger=print,
    )
    if resp is None:
        print("⚠️  Supabase injoignable — sauvegarde scrapings échouée")
        return False
    if resp.status_code in (200, 201):
        data = resp.json()
        record = data[0] if isinstance(data, list) and data else data
        print(f"☁️  Sauvegardé dans scrapings (ID: {record.get('id', 'N/A')})")
        return True
    else:
        print(f"⚠️  Erreur PostgREST ({resp.status_code}): {resp.text[:300]}")
        return False


def main():
    parser = argparse.ArgumentParser(description='Comparaison rapide depuis cache')
    parser.add_argument('--user-id', required=True, help='ID utilisateur')
    parser.add_argument('--reference', default=None, help='URL de référence (override config DB)')
    parser.add_argument('--competitors', default=None, help='URLs concurrents séparées par des virgules (override config DB)')
    args = parser.parse_args()

    user_id = args.user_id
    supabase_url = os.environ.get('SUPABASE_URL') or os.environ.get('NEXT_PUBLIC_SUPABASE_URL', '')
    supabase_key = os.environ.get('SUPABASE_SERVICE_ROLE_KEY', '')

    if not supabase_url or not supabase_key:
        print("❌ SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont requis")
        sys.exit(1)

    start_time = time.time()
    print(f"\n{'='*60}")
    print(f"⚡ COMPARAISON RAPIDE (méthode du cache)")
    print(f"{'='*60}")

    # ── 1. Config utilisateur (CLI override > DB) ──
    config = _fetch_user_config(supabase_url, supabase_key, user_id)

    reference_url = (args.reference or (config.get("reference_url", "") if config else "")).strip()
    if not reference_url:
        print("❌ Pas d'URL de référence configurée")
        sys.exit(1)

    if args.competitors is not None:
        competitor_urls = [u.strip() for u in args.competitors.split(',') if u.strip()]
    else:
        competitor_urls = (config.get("competitor_urls", []) if config else []) or []

    ignore_colors = (config.get("ignore_colors", False) if config else False)
    match_mode = (config.get("match_mode", "exact") if config else "exact")

    ref_domain = _domain(reference_url)
    all_domains: Dict[str, str] = {ref_domain: reference_url}
    for url in competitor_urls:
        d = _domain(url)
        if d not in all_domains:
            all_domains[d] = url

    print(f"⭐ Référence: {reference_url} ({ref_domain})")
    print(f"📦 Concurrents: {len(competitor_urls)}")
    print(f"🔗 Sites à charger: {len(all_domains)}\n")

    # ── 2. Charger les produits (cache → fallback scrape si manquant ou stale) ──
    cron_running = _is_cron_running(supabase_url, supabase_key)
    if cron_running:
        print("🔒 Cron en cours d'exécution — fallback scraping désactivé (utilisation du cache existant)")

    site_products: Dict[str, List[dict]] = {}
    cache_hits = 0
    fallback_scrapes = 0
    stale_refreshed = 0
    skipped_cron = 0

    for domain, url in all_domains.items():
        products, is_stale, age_min = _fetch_site_products(supabase_url, supabase_key, domain)

        if products and not is_stale:
            for p in products:
                if not p.get('sourceSite'):
                    p['sourceSite'] = url
            site_products[domain] = products
            cache_hits += 1
            print(f"   ✅ {domain}: {len(products)} produits (cache {age_min} min)")

        elif products and is_stale:
            if cron_running:
                for p in products:
                    if not p.get('sourceSite'):
                        p['sourceSite'] = url
                site_products[domain] = products
                cache_hits += 1
                skipped_cron += 1
                print(f"   🔒 {domain}: cache stale ({age_min} min) mais cron en cours — {len(products)} produits")
            else:
                print(f"   ⏳ {domain}: cache stale ({age_min} min, >{STALE_THRESHOLD_HOURS}h) → tentative de refresh...")
                fresh_products = _fallback_scrape(domain, url, supabase_url, supabase_key)
                if fresh_products:
                    for p in fresh_products:
                        if not p.get('sourceSite'):
                            p['sourceSite'] = url
                    site_products[domain] = fresh_products
                    stale_refreshed += 1
                    print(f"   ✅ {domain}: rafraîchi → {len(fresh_products)} produits")
                else:
                    for p in products:
                        if not p.get('sourceSite'):
                            p['sourceSite'] = url
                    site_products[domain] = products
                    cache_hits += 1
                    print(f"   ⚠️  {domain}: refresh échoué, ancien cache utilisé ({len(products)} produits, {age_min} min)")

        else:
            if cron_running:
                skipped_cron += 1
                print(f"   🔒 {domain}: aucun cache mais cron en cours — ignoré (sera disponible après le cron)")
            else:
                print(f"   ❌ {domain}: aucun cache → scraping temps-réel...")
                fallback_products = _fallback_scrape(domain, url, supabase_url, supabase_key)
                if fallback_products:
                    for p in fallback_products:
                        if not p.get('sourceSite'):
                            p['sourceSite'] = url
                    site_products[domain] = fallback_products
                    fallback_scrapes += 1
                else:
                    print(f"   ❌ {domain}: aucun produit disponible")

    print(f"\n📊 Cache frais: {cache_hits} | Stale rafraîchi: {stale_refreshed} | "
          f"Fallback: {fallback_scrapes} | "
          f"Indisponible: {len(all_domains) - cache_hits - fallback_scrapes - stale_refreshed}"
          + (f" | Skippé (cron): {skipped_cron}" if skipped_cron else ""))

    # ── 3. Vérifier le site de référence ──
    reference_products = site_products.get(ref_domain, [])
    if not reference_products:
        print(f"\n❌ Aucun produit pour le site de référence ({ref_domain})")
        sys.exit(1)

    for p in reference_products:
        enrich_product_year(p)
        clean_product_name(p)
        p['sourceSite'] = reference_url
        p['isReferenceProduct'] = True

    # ── 4. Comparer avec chaque concurrent ──
    all_matched_products = []
    for url in competitor_urls:
        comp_domain = _domain(url)
        comp_products = site_products.get(comp_domain, [])
        if not comp_products:
            continue

        for p in comp_products:
            enrich_product_year(p)
            clean_product_name(p)
            if not p.get('sourceSite'):
                p['sourceSite'] = url

        if reference_products and comp_products:
            matched = find_matching_products(
                reference_products=reference_products,
                comparison_products=comp_products,
                reference_url=reference_url,
                comparison_url=url,
                ignore_colors=ignore_colors,
                match_mode=match_mode,
            )
            all_matched_products.extend(matched)

    # ── 5. Assembler le résultat (même format que main.py) ──
    all_products_to_save = list(reference_products)
    added_source_urls = {p.get('sourceUrl') for p in reference_products if p.get('sourceUrl')}

    for matched in all_matched_products:
        source_url = matched.get('sourceUrl')
        if source_url and source_url in added_source_urls:
            continue
        all_products_to_save.append(matched)
        if source_url:
            added_source_urls.add(source_url)

    for url in competitor_urls:
        comp_domain = _domain(url)
        for product in site_products.get(comp_domain, []):
            source_url = product.get('sourceUrl')
            if source_url and source_url in added_source_urls:
                continue
            if not product.get('sourceSite'):
                product['sourceSite'] = url
            all_products_to_save.append(product)
            if source_url:
                added_source_urls.add(source_url)

    elapsed = time.time() - start_time

    # ── 6. Sauvegarder dans scrapings ──
    scraping_row = {
        "user_id": user_id,
        "reference_url": reference_url,
        "competitor_urls": competitor_urls,
        "products": all_products_to_save,
        "metadata": {
            "reference_url": reference_url,
            "reference_products_count": len(reference_products),
            "competitor_urls": competitor_urls,
            "total_matched_products": len(all_matched_products),
            "total_products": len(all_products_to_save),
            "scraping_time_seconds": round(elapsed, 1),
            "mode": "from_cache",
            "source": "scraped_site_data",
            "cache_hits": cache_hits,
            "stale_refreshed": stale_refreshed,
            "fallback_scrapes": fallback_scrapes,
        },
        "scraping_time_seconds": round(elapsed, 1),
        "mode": "from_cache",
    }

    saved = _save_scrapings(supabase_url, supabase_key, scraping_row)

    print(f"\n{'='*60}")
    print(f"✅ COMPARAISON TERMINÉE en {elapsed:.1f}s")
    print(f"{'='*60}")
    print(f"⭐ Référence: {len(reference_products)} produits")
    print(f"🔍 Correspondances: {len(all_matched_products)}")
    print(f"📦 Total sauvegardé: {len(all_products_to_save)}")
    print(f"📊 Cache: {cache_hits} | Stale refresh: {stale_refreshed} | Fallback: {fallback_scrapes}")
    print(f"{'='*60}\n")

    if not saved:
        sys.exit(2)


if __name__ == "__main__":
    main()
