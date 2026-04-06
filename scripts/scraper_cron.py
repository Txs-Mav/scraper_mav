"""
Scraping automatique — exécuté par GitHub Actions toutes les 30 min.

Stratégie "double couverture" pour ~100% de fiabilité :
  - Le cron tourne toutes les 30 min
  - Mais ne scrape QUE les sites dont les données sont vieilles de >50 min
  - Si un site échoue à :00, il sera re-tenté à :30 (2 chances par heure)
  - Sites groupés par paires, étalés sur ~25 min max (pas 60)
  - 2 rounds de retry après tous les batches

Règle de persistance :
  - Succès  → UPSERT complet (products, product_count, status, scraped_at)
  - Erreur  → UPSERT status + error_message UNIQUEMENT
    (products de l'heure précédente restent intacts dans scraped_site_data)

Variables d'environnement requises :
  SUPABASE_URL              — URL du projet Supabase
  SUPABASE_SERVICE_ROLE_KEY — Clé service role (bypass RLS)
"""

import os
import sys
import signal
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone, timedelta
from pathlib import Path
from threading import Lock

import requests as http_requests
from supabase import create_client

SCRIPT_DIR = Path(__file__).parent
PROJECT_ROOT = SCRIPT_DIR.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from scraper_ai.dedicated_scrapers.registry import DedicatedScraperRegistry

LARGE_SITE_THRESHOLD = 300   # >300 produits connus = gros site (paire de 2)
SMALL_BATCH_SIZE = 5         # petits sites en parallèle par 5
STALE_THRESHOLD_MINUTES = 50
MAX_RETRY_ROUNDS = 2
print_lock = Lock()


def _log(msg: str):
    with print_lock:
        ts = datetime.now(timezone.utc).strftime('%H:%M:%S')
        print(f"[{ts}] {msg}", flush=True)


def _scrape_single_site(slug: str, site_url: str, site_domain: str) -> dict:
    """Scrape un site via son scraper dédié. Thread-safe."""
    try:
        scraper = DedicatedScraperRegistry.get_by_slug(slug)
        if not scraper:
            return {"success": False, "error": f"Scraper '{slug}' introuvable dans le registre"}

        _log(f"   🔄 Scraping {site_domain}...")
        start = time.time()
        result = scraper.scrape(
            categories=['inventaire', 'occasion', 'catalogue'],
            inventory_only=False,
        )
        elapsed = time.time() - start
        products = result.get('products', [])

        if not products:
            _log(f"   ⚠️  {site_domain}: 0 produits en {elapsed:.0f}s")
            return {"success": False, "error": "0 produits extraits", "elapsed": elapsed}

        _log(f"   ✅ {site_domain}: {len(products)} produits en {elapsed:.0f}s")
        return {
            "success": True,
            "products": products,
            "metadata": result.get('metadata', {}),
            "elapsed": elapsed,
        }

    except Exception as e:
        _log(f"   ❌ {site_domain}: Erreur — {e}")
        return {"success": False, "error": str(e)}


def _save_site_data(supabase_url: str, supabase_key: str, site: dict, scrape_result: dict):
    """Upsert les produits dans scraped_site_data.

    Succès → écrase tout. Erreur → ne touche PAS products/product_count.
    """
    headers = {
        "apikey": supabase_key,
        "Authorization": f"Bearer {supabase_key}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=representation",
    }

    now = datetime.now(timezone.utc).isoformat()

    if scrape_result["success"]:
        row = {
            "site_url": site["site_url"],
            "site_domain": site["site_domain"],
            "shared_scraper_id": site["id"],
            "products": scrape_result["products"],
            "product_count": len(scrape_result["products"]),
            "metadata": scrape_result.get("metadata", {}),
            "scraped_at": now,
            "scrape_duration_seconds": round(scrape_result.get("elapsed", 0), 1),
            "status": "success",
            "error_message": None,
            "updated_at": now,
        }
    else:
        row = {
            "site_url": site["site_url"],
            "site_domain": site["site_domain"],
            "shared_scraper_id": site["id"],
            "status": "error",
            "error_message": scrape_result.get("error", "Unknown error")[:500],
            "updated_at": now,
        }

    try:
        resp = http_requests.post(
            f"{supabase_url}/rest/v1/scraped_site_data",
            json=row,
            headers=headers,
            params={"on_conflict": "site_domain"},
            timeout=30,
        )
        if resp.status_code in (200, 201):
            status = "✅" if scrape_result["success"] else "⚠️  (erreur, ancien cache conservé)"
            _log(f"   {status} {site['site_domain']}")
        else:
            _log(f"   ⚠️  {site['site_domain']}: erreur PostgREST ({resp.status_code}): {resp.text[:200]}")
    except Exception as e:
        _log(f"   ⚠️  {site['site_domain']}: erreur sauvegarde — {e}")


def _get_stale_sites(supabase, sites: list) -> list:
    """Filtre les sites dont le cache est vieux de >STALE_THRESHOLD_MINUTES ou inexistant."""
    threshold = datetime.now(timezone.utc) - timedelta(minutes=STALE_THRESHOLD_MINUTES)
    threshold_iso = threshold.isoformat()

    domains = [s["site_domain"] for s in sites]

    # Lire l'état actuel de scraped_site_data pour tous les domaines
    try:
        result = (
            supabase.table("scraped_site_data")
            .select("site_domain, scraped_at, status")
            .in_("site_domain", domains)
            .execute()
        )
        cached = {row["site_domain"]: row for row in (result.data or [])}
    except Exception as e:
        _log(f"⚠️  Erreur lecture scraped_site_data: {e} — on scrape tout")
        return sites

    stale = []
    fresh = []
    for site in sites:
        domain = site["site_domain"]
        row = cached.get(domain)
        if not row:
            stale.append(site)
        elif row.get("status") != "success":
            stale.append(site)
        elif row.get("scraped_at", "") < threshold_iso:
            stale.append(site)
        else:
            fresh.append(site)

    if fresh:
        _log(f"   ✅ {len(fresh)} site(s) frais (<{STALE_THRESHOLD_MINUTES} min), skippés")
    return stale


def main():
    supabase_url = os.environ.get("SUPABASE_URL")
    supabase_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

    if not supabase_url or not supabase_key:
        print("❌ SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont requis")
        sys.exit(1)

    supabase = create_client(supabase_url, supabase_key)

    print(f"\n{'='*70}")
    print(f"🔄 SCRAPER CRON — {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}")
    print(f"   Double couverture : toutes les 30 min, scrape si stale >{STALE_THRESHOLD_MINUTES} min")
    print(f"   Gros sites (>{LARGE_SITE_THRESHOLD} produits) par 2, petits par {SMALL_BATCH_SIZE}")
    print(f"{'='*70}")

    # ── 1. Lire tous les shared_scrapers actifs ──
    result = (
        supabase.table("shared_scrapers")
        .select("id, site_name, site_slug, site_url, site_domain, scraper_module")
        .eq("is_active", True)
        .order("site_slug")
        .execute()
    )
    all_sites = result.data or []

    if not all_sites:
        print("✅ Aucun scraper universel actif trouvé")
        return

    print(f"\n📋 {len(all_sites)} sites universels actifs")

    # ── 2. Filtrer : ne garder que les sites "stale" (>50 min ou en erreur) ──
    sites = _get_stale_sites(supabase, all_sites)

    if not sites:
        print(f"✅ Tous les {len(all_sites)} sites sont à jour — rien à scraper")
        return

    print(f"🔧 {len(sites)}/{len(all_sites)} sites à scraper (stale ou manquants)\n")

    # ── 3. Grouper dynamiquement : gros sites par 2, petits sites par 5 ──
    # Les sites sont déjà triés par taille décroissante (gros en premier)
    large = [s for s in sites if s.get("_known_product_count", 0) >= LARGE_SITE_THRESHOLD]
    small = [s for s in sites if s.get("_known_product_count", 0) < LARGE_SITE_THRESHOLD]

    batches: list[list[dict]] = []
    for i in range(0, len(large), 2):
        batches.append(large[i:i + 2])
    for i in range(0, len(small), SMALL_BATCH_SIZE):
        batches.append(small[i:i + SMALL_BATCH_SIZE])

    spacing_seconds = 30

    print(f"   {len(large)} gros site(s) (par 2) + {len(small)} petit(s) (par {SMALL_BATCH_SIZE})")
    print(f"   → {len(batches)} batches, {spacing_seconds}s entre chaque\n")

    for i, batch in enumerate(batches):
        names = " + ".join(f"{s['site_name']} ({s.get('_known_product_count', '?')})" for s in batch)
        print(f"   Batch {i}: {names}")

    print()

    shutdown = False

    def _on_sigterm(signum, frame):
        nonlocal shutdown
        print("\n⚠️  SIGTERM reçu — arrêt après le batch en cours...")
        shutdown = True

    signal.signal(signal.SIGTERM, _on_sigterm)
    signal.signal(signal.SIGINT, _on_sigterm)

    # ── 4. Exécuter les batches ──
    total_success = 0
    total_failed = 0
    failed_sites: list[dict] = []
    cron_start = time.time()

    for i, batch in enumerate(batches):
        if shutdown:
            _log(f"⚠️  Arrêt demandé — {len(batches) - i} batch(es) restant(es) ignorée(s)")
            break

        names = " + ".join(s["site_name"] for s in batch)
        _log(f"\n{'─'*50}")
        _log(f"📦 BATCH {i}/{len(batches) - 1}: {names}")
        _log(f"{'─'*50}")

        with ThreadPoolExecutor(max_workers=len(batch)) as executor:
            futures = {
                executor.submit(
                    _scrape_single_site,
                    site["site_slug"],
                    site["site_url"],
                    site["site_domain"],
                ): site
                for site in batch
            }

            # 1200s (20 min) : certains sites ont 1000+ pages (ex: Nadon Sport ~16 min)
            for future in as_completed(futures, timeout=1200):
                site = futures[future]
                try:
                    result = future.result(timeout=1200)
                    _save_site_data(supabase_url, supabase_key, site, result)
                    if result["success"]:
                        total_success += 1
                    else:
                        total_failed += 1
                        failed_sites.append(site)
                except Exception as e:
                    _log(f"   ❌ {site['site_domain']}: exception — {e}")
                    _save_site_data(supabase_url, supabase_key, site, {
                        "success": False, "error": str(e)
                    })
                    total_failed += 1
                    failed_sites.append(site)

        if i < len(batches) - 1 and not shutdown:
            wait = spacing_seconds
            _log(f"   💤 Pause de {wait / 60:.1f} min...")
            sleep_start = time.time()
            while time.time() - sleep_start < wait:
                if shutdown:
                    break
                time.sleep(min(5, wait - (time.time() - sleep_start)))

    # ── 5. RETRY : 2 rounds pour les sites échoués ──
    still_failed = list(failed_sites)
    for retry_round in range(1, MAX_RETRY_ROUNDS + 1):
        if not still_failed or shutdown:
            break

        _log(f"\n{'─'*50}")
        _log(f"🔄 RETRY #{retry_round}: {len(still_failed)} site(s)")
        _log(f"{'─'*50}")
        time.sleep(5 * retry_round)

        next_failed = []
        for site in still_failed:
            if shutdown:
                break
            result = _scrape_single_site(site["site_slug"], site["site_url"], site["site_domain"])
            _save_site_data(supabase_url, supabase_key, site, result)
            if result["success"]:
                total_success += 1
                total_failed -= 1
            else:
                next_failed.append(site)

        recovered = len(still_failed) - len(next_failed)
        _log(f"   🔄 Retry #{retry_round}: {recovered}/{len(still_failed)} récupéré(s)")
        still_failed = next_failed

    elapsed_total = time.time() - cron_start

    print(f"\n{'='*70}")
    print(f"✅ SCRAPER CRON TERMINÉ")
    print(f"   {total_success}/{len(sites)} OK, {total_failed} échoué(s)")
    if still_failed:
        print(f"   ⚠️  Sites encore en erreur (ancien cache conservé): "
              f"{', '.join(s['site_domain'] for s in still_failed)}")
        print(f"   → Sera re-tenté dans 30 min par le prochain cron")
    print(f"   Durée: {elapsed_total / 60:.1f} min")
    print(f"{'='*70}\n")


if __name__ == "__main__":
    main()
