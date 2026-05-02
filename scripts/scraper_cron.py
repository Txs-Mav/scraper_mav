"""
Scraping automatique — exécuté toutes les heures par le backend.

Stratégie :
  - Le cron tourne toutes les heures
  - Ne scrape QUE les sites dont les données sont vieilles de >55 min
  - TOUS les sites scrapés en parallèle (8 workers max)
  - Durée totale ≈ durée du site le plus lent (~16 min) au lieu de la somme
  - 2 rounds de retry en parallèle après le scraping principal

Sharding (batches de 20 par défaut) :
  - Sans flag, le script tourne en mode ORCHESTRATEUR : il lit tous les
    `shared_scrapers` actifs triés par site_slug et, si on a > BATCH_SIZE
    sites, il spawn un sous-processus de lui-même par tranche de 20 sites
    (--batch-index 0, 1, 2 ...) et attend qu'ils terminent.
  - Avec --batch-index N, il tourne en mode WORKER : il scrape uniquement
    la tranche [N*BATCH_SIZE : (N+1)*BATCH_SIZE] des sites triés et n'écrit
    PAS le cron lock ni les comparaisons utilisateurs (ces deux étapes sont
    gérées une seule fois par l'orchestrateur).

Règle de persistance :
  - Succès  → UPSERT complet (products, product_count, status, scraped_at)
  - Erreur  → UPSERT status + error_message UNIQUEMENT
    (products de l'heure précédente restent intacts dans scraped_site_data)

Variables d'environnement requises :
  SUPABASE_URL              — URL du projet Supabase
  SUPABASE_SERVICE_ROLE_KEY — Clé service role (bypass RLS)
"""

import argparse
import math
import os
import subprocess
import sys
import signal
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone, timedelta
from pathlib import Path
from threading import Lock

from supabase import create_client

SCRIPT_DIR = Path(__file__).parent
PROJECT_ROOT = SCRIPT_DIR.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from _http_helpers import post_with_retry

from scraper_ai.dedicated_scrapers.registry import DedicatedScraperRegistry

STALE_THRESHOLD_MINUTES = 55
CRON_LOCK_DOMAIN = '__cron_lock__'
CRON_LOCK_TIMEOUT_MINUTES = 45

DEFAULT_BATCH_SIZE = 20
BATCH_WORKER_TIMEOUT_SECONDS = 60 * 60

KNOWN_LARGE_DOMAINS = {
    'motosillimitees.com',    # ~1900 produits, ~15 min
    'nadonsport.com',         # ~1000 produits, ~16 min
    'motoducharme.com',       # ~850 produits, ~10 min
    'gregoiresport.com',      # ~500 produits, ~5 min
    'mathiassports.com',      # ~400 produits, ~4 min
    'mvmmotosport.com',       # ~300 produits, ~3 min
}

MAX_CONCURRENT_SITES = 8
LARGE_SITE_TIMEOUT = 1200   # 20 min
SMALL_SITE_TIMEOUT = 600    # 10 min
MAX_RETRY_ROUNDS = 2
print_lock = Lock()


def _log(msg: str):
    with print_lock:
        ts = datetime.now(timezone.utc).strftime('%H:%M:%S')
        print(f"[{ts}] {msg}", flush=True)


def _set_cron_lock(supabase_url: str, supabase_key: str, status: str):
    """Upsert un verrou dans scraped_site_data pour signaler que le cron tourne.

    compare_from_cache.py vérifie ce verrou pour éviter de lancer des
    fallback scrapes pendant que le cron est en cours.
    """
    headers = {
        "apikey": supabase_key,
        "Authorization": f"Bearer {supabase_key}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates",
    }
    now = datetime.now(timezone.utc).isoformat()
    row = {
        "site_domain": CRON_LOCK_DOMAIN,
        "site_url": "internal://cron-lock",
        "status": status,
        "scraped_at": now,
        "updated_at": now,
        "product_count": 0,
        "products": [],
    }
    resp = post_with_retry(
        f"{supabase_url}/rest/v1/scraped_site_data",
        json=row,
        headers=headers,
        params={"on_conflict": "site_domain"},
        timeout=30,
        max_attempts=4,
        base_backoff=5.0,
        logger=_log,
    )
    if resp is None:
        _log(f"⚠️  Cron lock ({status}): Supabase injoignable")
        return
    if resp.status_code in (200, 201):
        _log(f"🔒 Cron lock → {status}")
    else:
        _log(f"⚠️  Cron lock ({status}): PostgREST {resp.status_code}")


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

    Succès → écrase tout + efface le flag hidden. Erreur → ne touche PAS products/product_count.
    """
    headers = {
        "apikey": supabase_key,
        "Authorization": f"Bearer {supabase_key}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=representation",
    }

    now = datetime.now(timezone.utc).isoformat()

    if scrape_result["success"]:
        metadata = {**scrape_result.get("metadata", {}), "temporarily_hidden": False}
        row = {
            "site_url": site["site_url"],
            "site_domain": site["site_domain"],
            "shared_scraper_id": site["id"],
            "products": scrape_result["products"],
            "product_count": len(scrape_result["products"]),
            "metadata": metadata,
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
        resp = post_with_retry(
            f"{supabase_url}/rest/v1/scraped_site_data",
            json=row,
            headers=headers,
            params={"on_conflict": "site_domain"},
            timeout=45,
            max_attempts=5,
            base_backoff=3.0,
            logger=_log,
        )
        if resp is None:
            _log(f"   ⚠️  {site['site_domain']}: Supabase injoignable — sauvegarde perdue")
        elif resp.status_code in (200, 201):
            status = "✅" if scrape_result["success"] else "⚠️  (erreur, ancien cache conservé)"
            _log(f"   {status} {site['site_domain']}")
        else:
            _log(f"   ⚠️  {site['site_domain']}: erreur PostgREST ({resp.status_code}): {resp.text[:200]}")
    except Exception as e:
        _log(f"   ⚠️  {site['site_domain']}: erreur sauvegarde — {e}")


def _hide_failing_sites(supabase_url: str, supabase_key: str, sites: list[dict]):
    """Marque les sites en échec répété comme temporarily_hidden dans scraped_site_data.

    Le dashboard exclut ces sites de la barre de recherche jusqu'au prochain
    scraping réussi (qui remet temporarily_hidden à false).
    """
    if not sites:
        return

    headers = {
        "apikey": supabase_key,
        "Authorization": f"Bearer {supabase_key}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates",
    }
    now = datetime.now(timezone.utc).isoformat()

    for site in sites:
        domain = site["site_domain"]
        row = {
            "site_url": site["site_url"],
            "site_domain": domain,
            "shared_scraper_id": site["id"],
            "metadata": {"temporarily_hidden": True, "hidden_at": now},
            "updated_at": now,
        }
        try:
            resp = post_with_retry(
                f"{supabase_url}/rest/v1/scraped_site_data",
                json=row,
                headers=headers,
                params={"on_conflict": "site_domain"},
                timeout=20,
                max_attempts=3,
                logger=_log,
            )
            if resp is None:
                _log(f"   ⚠️  {domain}: Supabase injoignable — impossible de cacher")
            elif resp.status_code in (200, 201):
                _log(f"   🙈 {domain}: caché de la recherche (échec après {MAX_RETRY_ROUNDS} retries)")
            else:
                _log(f"   ⚠️  {domain}: erreur hide ({resp.status_code})")
        except Exception as e:
            _log(f"   ⚠️  {domain}: erreur hide — {e}")


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


def _run_user_comparisons(supabase, supabase_url: str, supabase_key: str):
    """Après le scraping, lance compare_from_cache pour chaque utilisateur avec des alertes actives."""
    import subprocess

    try:
        result = (
            supabase.table("scraper_alerts")
            .select("user_id, reference_url, competitor_urls")
            .eq("is_active", True)
            .neq("reference_url", "null")
            .execute()
        )
        alerts = result.data or []
        alerts = [a for a in alerts if a.get("reference_url")]
    except Exception as e:
        _log(f"⚠️  Erreur lecture scraper_alerts: {e}")
        return

    if not alerts:
        _log("ℹ️  Aucune alerte active — pas de comparaison à lancer")
        return

    users_seen = set()
    unique_alerts = []
    for alert in alerts:
        uid = alert["user_id"]
        if uid not in users_seen:
            users_seen.add(uid)
            unique_alerts.append(alert)

    _log(f"\n{'─'*50}")
    _log(f"📊 COMPARAISONS : {len(unique_alerts)} utilisateur(s)")
    _log(f"{'─'*50}")

    compare_script = str(SCRIPT_DIR / "compare_from_cache.py")

    for alert in unique_alerts:
        uid = alert["user_id"]
        ref_url = alert.get("reference_url", "")
        competitors = alert.get("competitor_urls") or []

        if not ref_url:
            continue

        cmd = [sys.executable, compare_script, "--user-id", uid, "--reference", ref_url]
        if competitors:
            cmd.extend(["--competitors", ",".join(competitors)])

        _log(f"   🔄 User {uid[:8]}... — ref={ref_url}")
        try:
            proc = subprocess.run(
                cmd,
                cwd=str(PROJECT_ROOT),
                capture_output=True,
                text=True,
                timeout=120,
                env={**os.environ, "SUPABASE_URL": supabase_url, "SUPABASE_SERVICE_ROLE_KEY": supabase_key},
            )
            if proc.returncode == 0:
                _log(f"   ✅ User {uid[:8]}... — comparaison OK")
            else:
                last_lines = (proc.stdout or proc.stderr or "").strip().split("\n")[-3:]
                _log(f"   ⚠️  User {uid[:8]}... — code {proc.returncode}: {' | '.join(last_lines)}")
        except subprocess.TimeoutExpired:
            _log(f"   ⏰ User {uid[:8]}... — timeout (>2 min)")
        except Exception as e:
            _log(f"   ❌ User {uid[:8]}... — {e}")


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Cron de scraping centralisé")
    parser.add_argument(
        "--batch-index",
        type=int,
        default=None,
        help=(
            "Index de la tranche à scraper (0-based). Si fourni, le script "
            "tourne en mode worker : pas de cron lock, pas de comparaisons."
        ),
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=DEFAULT_BATCH_SIZE,
        help=f"Nombre maximal de sites par batch (défaut : {DEFAULT_BATCH_SIZE}).",
    )
    return parser.parse_args()


def _read_active_sites(supabase) -> list:
    """Lit tous les shared_scrapers actifs, triés par site_slug (ordre stable).

    Le tri par site_slug garantit qu'un même site retombe toujours dans le
    même batch tant que la liste ne change pas — utile pour le debug et
    pour limiter le « churn » entre runs successifs.
    """
    for attempt in range(3):
        try:
            result = (
                supabase.table("shared_scrapers")
                .select("id, site_name, site_slug, site_url, site_domain, scraper_module")
                .eq("is_active", True)
                .order("site_slug")
                .execute()
            )
            return result.data or []
        except Exception as e:
            if attempt < 2:
                _log(f"⚠️  Supabase pas prêt (tentative {attempt+1}/3): {e}")
                time.sleep(10 * (attempt + 1))
            else:
                raise
    return []


def _enrich_with_product_count(supabase, sites: list) -> None:
    """Enrichit chaque site avec son product_count cache pour le tri par taille."""
    if not sites:
        return
    try:
        domains = [s["site_domain"] for s in sites]
        cached = (
            supabase.table("scraped_site_data")
            .select("site_domain, product_count")
            .in_("site_domain", domains)
            .execute()
        )
        pc_map = {r["site_domain"]: r.get("product_count", 0) or 0 for r in (cached.data or [])}
        for site in sites:
            site["_known_product_count"] = pc_map.get(site["site_domain"], 0)
    except Exception as e:
        _log(f"⚠️  Erreur lecture product_count: {e}")


def _scrape_sites(
    supabase,
    supabase_url: str,
    supabase_key: str,
    sites_subset: list,
    batch_label: str,
) -> bool:
    """Pipeline de scraping pour une liste de sites (filtrage stale + scrape)."""
    _enrich_with_product_count(supabase, sites_subset)
    sites_subset.sort(key=lambda s: s.get("_known_product_count", 0), reverse=True)

    print(f"\n📋 {batch_label} : {len(sites_subset)} sites à examiner")

    sites = _get_stale_sites(supabase, sites_subset)
    if not sites:
        print(f"✅ {batch_label} : tous les {len(sites_subset)} sites sont à jour")
        return True

    print(f"🔧 {batch_label} : {len(sites)}/{len(sites_subset)} sites à scraper\n")
    return _run_scraping(supabase_url, supabase_key, sites)


def _spawn_batch_workers(num_batches: int, batch_size: int) -> bool:
    """Lance N sous-processus du script (mode worker) en parallèle.

    Chaque worker lit lui-même la liste des sites actifs et ne traite que sa
    tranche. Les workers héritent de stdout/stderr → leurs logs apparaissent
    dans la sortie de l'orchestrateur.
    Retourne True si au moins un worker s'est terminé proprement (rc==0).
    """
    procs: list[tuple[int, subprocess.Popen]] = []
    for i in range(num_batches):
        cmd = [
            sys.executable, "-u", str(Path(__file__).resolve()),
            "--batch-index", str(i),
            "--batch-size", str(batch_size),
        ]
        _log(f"🧵 Spawn batch worker #{i} (size={batch_size})")
        proc = subprocess.Popen(cmd, env=os.environ.copy())
        procs.append((i, proc))

    any_success = False
    deadline = time.time() + BATCH_WORKER_TIMEOUT_SECONDS
    for idx, proc in procs:
        remaining = max(1, int(deadline - time.time()))
        try:
            rc = proc.wait(timeout=remaining)
        except subprocess.TimeoutExpired:
            _log(f"⏰ Batch worker #{idx} timeout — kill")
            proc.kill()
            try:
                rc = proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                rc = -1
        if rc == 0:
            any_success = True
            _log(f"✅ Batch worker #{idx} terminé proprement")
        else:
            _log(f"⚠️  Batch worker #{idx} terminé avec rc={rc}")
    return any_success


def main():
    args = _parse_args()

    supabase_url = os.environ.get("SUPABASE_URL")
    supabase_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

    if not supabase_url or not supabase_key:
        print("❌ SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont requis")
        sys.exit(1)

    supabase = create_client(supabase_url, supabase_key)

    if args.batch_index is not None:
        _run_batch_worker(supabase, supabase_url, supabase_key, args.batch_index, args.batch_size)
    else:
        _run_orchestrator(supabase, supabase_url, supabase_key, args.batch_size)


def _run_batch_worker(
    supabase, supabase_url: str, supabase_key: str,
    batch_index: int, batch_size: int,
):
    """Mode worker : ne traite que la tranche [batch_index] de la liste triée.

    N'écrit PAS le cron lock et ne lance PAS les comparaisons : ces deux
    étapes sont du ressort de l'orchestrateur qui a spawn ce worker.
    """
    label = f"BATCH #{batch_index}"
    print(f"\n{'='*70}")
    print(f"🔄 {label} — {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}")
    print(f"{'='*70}")

    all_sites = _read_active_sites(supabase)
    start = batch_index * batch_size
    end = start + batch_size
    my_sites = all_sites[start:end]

    if not my_sites:
        print(f"✅ {label} : tranche vide ({start}:{end} sur {len(all_sites)} sites)")
        return

    had_success = _scrape_sites(supabase, supabase_url, supabase_key, my_sites, label)
    sys.exit(0 if had_success else 1)


def _run_orchestrator(
    supabase, supabase_url: str, supabase_key: str, batch_size: int,
):
    """Mode orchestrateur : pose le lock, dispatche, lance les comparaisons."""
    print(f"\n{'='*70}")
    print(f"🔄 SCRAPER CRON — {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}")
    print(f"   Intervalle : toutes les heures, scrape si stale >{STALE_THRESHOLD_MINUTES} min")
    print(f"   Batch size : {batch_size} sites/action")
    print(f"{'='*70}")

    _set_cron_lock(supabase_url, supabase_key, "running")

    should_compare = False
    try:
        all_sites = _read_active_sites(supabase)
        if not all_sites:
            print("✅ Aucun scraper universel actif trouvé")
            should_compare = False
            return

        total = len(all_sites)
        num_batches = math.ceil(total / batch_size)
        print(f"\n📋 {total} scrapers actifs → {num_batches} batch(es) de ≤{batch_size}")

        if num_batches <= 1:
            had_success = _scrape_sites(
                supabase, supabase_url, supabase_key, all_sites, "BATCH #0",
            )
            should_compare = had_success
        else:
            print(f"🚀 Spawn de {num_batches} workers parallèles (chacun avec ses {MAX_CONCURRENT_SITES} threads)\n")
            should_compare = _spawn_batch_workers(num_batches, batch_size)

    finally:
        _set_cron_lock(supabase_url, supabase_key, "idle")
        if should_compare:
            _run_user_comparisons(supabase, supabase_url, supabase_key)


def _run_scraping(supabase_url: str, supabase_key: str, sites: list) -> bool:
    """Exécute TOUS les sites en parallèle. Retourne True si au moins 1 a réussi."""
    large = [s for s in sites if s["site_domain"] in KNOWN_LARGE_DOMAINS]
    small = [s for s in sites if s["site_domain"] not in KNOWN_LARGE_DOMAINS]

    workers = min(MAX_CONCURRENT_SITES, len(sites))
    print(f"   {len(large)} gros site(s) + {len(small)} petit(s)")
    print(f"   → {workers} workers parallèles (tous les sites en même temps)\n")

    for s in sites:
        kind = "🔴 gros" if s["site_domain"] in KNOWN_LARGE_DOMAINS else "🟢 petit"
        pc = s.get('_known_product_count', '?')
        timeout = LARGE_SITE_TIMEOUT if s["site_domain"] in KNOWN_LARGE_DOMAINS else SMALL_SITE_TIMEOUT
        print(f"   {kind}: {s['site_name']} ({pc} produits, timeout {timeout // 60} min)")
    print()

    shutdown = False

    def _on_sigterm(signum, frame):
        nonlocal shutdown
        print("\n⚠️  SIGTERM reçu — arrêt en cours...")
        shutdown = True

    signal.signal(signal.SIGTERM, _on_sigterm)
    signal.signal(signal.SIGINT, _on_sigterm)

    total_success = 0
    total_failed = 0
    failed_sites: list[dict] = []
    timed_out_domains: set = set()
    cron_start = time.time()

    _log(f"{'─'*50}")
    _log(f"🚀 Lancement de {len(sites)} sites en parallèle ({workers} workers)")
    _log(f"{'─'*50}")

    site_timeouts: dict[str, int] = {}
    for s in sites:
        site_timeouts[s["site_domain"]] = (
            LARGE_SITE_TIMEOUT if s["site_domain"] in KNOWN_LARGE_DOMAINS
            else SMALL_SITE_TIMEOUT
        )

    global_timeout = max(site_timeouts.values()) + 120

    with ThreadPoolExecutor(max_workers=workers) as executor:
        futures = {
            executor.submit(
                _scrape_single_site,
                site["site_slug"],
                site["site_url"],
                site["site_domain"],
            ): site
            for site in sites
        }

        try:
            for future in as_completed(futures, timeout=global_timeout):
                if shutdown:
                    break
                site = futures[future]
                domain = site["site_domain"]
                per_site_to = min(30, site_timeouts.get(domain, SMALL_SITE_TIMEOUT))
                try:
                    result = future.result(timeout=per_site_to)
                    _save_site_data(supabase_url, supabase_key, site, result)
                    if result["success"]:
                        total_success += 1
                    else:
                        total_failed += 1
                        failed_sites.append(site)
                except Exception as e:
                    _log(f"   ❌ {domain}: exception — {e}")
                    _save_site_data(supabase_url, supabase_key, site, {
                        "success": False, "error": str(e)
                    })
                    total_failed += 1
                    failed_sites.append(site)
        except TimeoutError:
            for future, site in futures.items():
                if not future.done():
                    timeout_min = site_timeouts.get(site["site_domain"], SMALL_SITE_TIMEOUT) // 60
                    _log(f"   ⏰ {site['site_domain']}: timeout global (>{timeout_min} min) — annulé")
                    future.cancel()
                    _save_site_data(supabase_url, supabase_key, site, {
                        "success": False,
                        "error": f"Timeout: scraping exceeded {timeout_min} minutes",
                    })
                    total_failed += 1
                    failed_sites.append(site)
                    timed_out_domains.add(site["site_domain"])

    if shutdown:
        _log("⚠️  Arrêt demandé — retry ignoré")
    else:
        retryable = [s for s in failed_sites if s["site_domain"] not in timed_out_domains]
        skipped = [s for s in failed_sites if s["site_domain"] in timed_out_domains]
        if skipped:
            _log(f"\n   ⏭️  {len(skipped)} site(s) timeout — pas de retry immédiat "
                 f"({', '.join(s['site_domain'] for s in skipped)})")

        still_failed = list(retryable)
        for retry_round in range(1, MAX_RETRY_ROUNDS + 1):
            if not still_failed:
                break

            _log(f"\n{'─'*50}")
            _log(f"🔄 RETRY #{retry_round}: {len(still_failed)} site(s) en parallèle")
            _log(f"{'─'*50}")
            time.sleep(5 * retry_round)

            next_failed = []
            retry_workers = min(MAX_CONCURRENT_SITES, len(still_failed))

            with ThreadPoolExecutor(max_workers=retry_workers) as executor:
                retry_futures = {
                    executor.submit(
                        _scrape_single_site,
                        site["site_slug"],
                        site["site_url"],
                        site["site_domain"],
                    ): site
                    for site in still_failed
                }

                try:
                    for future in as_completed(retry_futures, timeout=LARGE_SITE_TIMEOUT):
                        site = retry_futures[future]
                        try:
                            result = future.result(timeout=30)
                            _save_site_data(supabase_url, supabase_key, site, result)
                            if result["success"]:
                                total_success += 1
                                total_failed -= 1
                            else:
                                next_failed.append(site)
                        except Exception:
                            next_failed.append(site)
                except TimeoutError:
                    for f, s in retry_futures.items():
                        if not f.done():
                            next_failed.append(s)

            recovered = len(still_failed) - len(next_failed)
            _log(f"   🔄 Retry #{retry_round}: {recovered}/{len(still_failed)} récupéré(s)")
            still_failed = next_failed

        still_failed.extend(skipped)
        if still_failed:
            _hide_failing_sites(supabase_url, supabase_key, still_failed)

        failed_sites = still_failed

    elapsed_total = time.time() - cron_start

    print(f"\n{'='*70}")
    print(f"✅ SCRAPER CRON TERMINÉ")
    print(f"   {total_success}/{len(sites)} OK, {total_failed} échoué(s)")
    if failed_sites:
        print(f"   ⚠️  Sites encore en erreur (ancien cache conservé): "
              f"{', '.join(s['site_domain'] for s in failed_sites)}")
        print(f"   → Sera re-tenté dans 1h par le prochain cron")
    print(f"   Durée: {elapsed_total / 60:.1f} min")
    print(f"{'='*70}\n")

    return total_success > 0 and not shutdown


if __name__ == "__main__":
    main()
