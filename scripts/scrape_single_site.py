"""
Scraping ciblé d'un seul site — utilisé par les workflows GitHub Actions
qui veulent un cron horaire dédié à un site spécifique (au lieu de
passer par l'orchestrateur global ``scraper_cron.py``).

Usage :
    python scripts/scrape_single_site.py --slug morin-sports
    python scripts/scrape_single_site.py --slug morin-sports --force

Comportement :
  1. Lit la ligne ``shared_scrapers`` correspondant au slug.
  2. Si --force absent, skip le scraping si le cache est frais (<55 min).
  3. Lookup le scraper dédié via ``DedicatedScraperRegistry``.
  4. Exécute ``scraper.scrape(categories=['inventaire','occasion','catalogue'])``.
  5. Upsert le résultat dans ``scraped_site_data`` (succès ou erreur).
  6. Code de sortie 0 si succès, 1 sinon.

Variables d'environnement requises :
    SUPABASE_URL              — URL du projet Supabase
    SUPABASE_SERVICE_ROLE_KEY — Clé service role (bypass RLS)
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from datetime import datetime, timezone, timedelta
from pathlib import Path

import requests
from supabase import create_client

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from scraper_ai.dedicated_scrapers.registry import DedicatedScraperRegistry  # noqa: E402

STALE_THRESHOLD_MINUTES = 55
HTTP_TIMEOUT = 60


def _log(msg: str) -> None:
    ts = datetime.now(timezone.utc).strftime('%H:%M:%S')
    print(f"[{ts}] {msg}", flush=True)


def _read_shared_scraper(supabase, slug: str) -> dict | None:
    result = (
        supabase.table("shared_scrapers")
        .select("id, site_name, site_slug, site_url, site_domain, "
                "scraper_module, is_active")
        .eq("site_slug", slug)
        .limit(1)
        .execute()
    )
    rows = result.data or []
    return rows[0] if rows else None


def _is_stale(supabase, site_domain: str, threshold_min: int) -> bool:
    """Retourne True si le cache est plus vieux que ``threshold_min`` minutes
    (ou inexistant / en erreur)."""
    try:
        result = (
            supabase.table("scraped_site_data")
            .select("scraped_at, status")
            .eq("site_domain", site_domain)
            .limit(1)
            .execute()
        )
        rows = result.data or []
    except Exception as e:
        _log(f"⚠️  Lecture cache impossible ({e}) — on scrape par sécurité")
        return True

    if not rows:
        return True

    row = rows[0]
    if row.get("status") != "success":
        return True

    threshold = datetime.now(timezone.utc) - timedelta(minutes=threshold_min)
    scraped_at = row.get("scraped_at", "")
    try:
        scraped_dt = datetime.fromisoformat(scraped_at.replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        return True

    return scraped_dt < threshold


def _save_result(
    supabase_url: str,
    supabase_key: str,
    site: dict,
    products: list,
    metadata: dict,
    elapsed: float,
) -> bool:
    headers = {
        "apikey": supabase_key,
        "Authorization": f"Bearer {supabase_key}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=representation",
    }
    now = datetime.now(timezone.utc).isoformat()

    if products:
        meta = {**metadata, "temporarily_hidden": False}
        row = {
            "site_url": site["site_url"],
            "site_domain": site["site_domain"],
            "shared_scraper_id": site["id"],
            "products": products,
            "product_count": len(products),
            "metadata": meta,
            "scraped_at": now,
            "scrape_duration_seconds": round(elapsed, 1),
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
            "error_message": "0 produits extraits",
            "updated_at": now,
        }

    resp = requests.post(
        f"{supabase_url}/rest/v1/scraped_site_data",
        headers=headers,
        params={"on_conflict": "site_domain"},
        data=json.dumps(row, default=str),
        timeout=HTTP_TIMEOUT,
    )

    if resp.status_code in (200, 201):
        _log(f"✅ Sauvegarde Supabase OK ({len(products)} produits)")
        return True

    _log(f"⚠️  Erreur sauvegarde Supabase {resp.status_code}: {resp.text[:300]}")
    return False


def _save_error(
    supabase_url: str,
    supabase_key: str,
    site: dict,
    error: str,
) -> None:
    headers = {
        "apikey": supabase_key,
        "Authorization": f"Bearer {supabase_key}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates",
    }
    now = datetime.now(timezone.utc).isoformat()
    row = {
        "site_url": site["site_url"],
        "site_domain": site["site_domain"],
        "shared_scraper_id": site["id"],
        "status": "error",
        "error_message": error[:500],
        "updated_at": now,
    }
    try:
        requests.post(
            f"{supabase_url}/rest/v1/scraped_site_data",
            headers=headers,
            params={"on_conflict": "site_domain"},
            data=json.dumps(row),
            timeout=30,
        )
    except Exception as e:
        _log(f"⚠️  Impossible de logger l'erreur dans Supabase: {e}")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Scraping ciblé d'un seul site via son slug."
    )
    parser.add_argument(
        "--slug",
        required=True,
        help="Slug du scraper (ex: morin-sports). Doit exister dans "
             "shared_scrapers ET être enregistré dans le registry.",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Ignorer le cache de fraîcheur et scraper inconditionnellement.",
    )
    parser.add_argument(
        "--categories",
        nargs="+",
        default=["inventaire", "occasion", "catalogue"],
        help="Catégories à scraper (par défaut: inventaire occasion catalogue).",
    )
    parser.add_argument(
        "--inventory-only",
        action="store_true",
        help="Filtrer pour ne garder que les produits avec un SKU réel "
             "(exclut le catalogue showroom).",
    )
    args = parser.parse_args()

    supabase_url = os.environ.get("SUPABASE_URL")
    supabase_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not supabase_url or not supabase_key:
        print("❌ SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont requis",
              file=sys.stderr)
        return 1

    supabase = create_client(supabase_url, supabase_key)

    print(f"\n{'='*70}")
    print(f"🎯 SCRAPE CIBLÉ — slug='{args.slug}'")
    print(f"   {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}")
    print(f"{'='*70}\n")

    # 1. Lookup shared_scrapers
    site = _read_shared_scraper(supabase, args.slug)
    if not site:
        _log(f"❌ Slug '{args.slug}' introuvable dans shared_scrapers")
        return 1

    if not site.get("is_active"):
        _log(f"⏸️  '{args.slug}' est inactif (is_active=false) — skip")
        return 0

    _log(f"📋 Site: {site['site_name']} ({site['site_domain']})")
    _log(f"   URL: {site['site_url']}")
    _log(f"   Module: {site['scraper_module']}")

    # 2. Vérification fraîcheur (sauf --force)
    if not args.force:
        if not _is_stale(supabase, site["site_domain"], STALE_THRESHOLD_MINUTES):
            _log(f"✅ Cache frais (<{STALE_THRESHOLD_MINUTES} min) — skip")
            return 0
        _log(f"🔄 Cache stale ou inexistant — scraping en cours...")
    else:
        _log(f"⚡ Mode --force activé — scraping inconditionnel")

    # 3. Lookup registry
    scraper = DedicatedScraperRegistry.get_by_slug(args.slug)
    if not scraper:
        err = f"Scraper '{args.slug}' introuvable dans le DedicatedScraperRegistry"
        _log(f"❌ {err}")
        _save_error(supabase_url, supabase_key, site, err)
        return 1

    # 4. Exécution
    start = time.time()
    try:
        result = scraper.scrape(
            categories=args.categories,
            inventory_only=args.inventory_only,
        )
    except Exception as e:
        elapsed = time.time() - start
        err = f"Exception scraper: {type(e).__name__}: {e}"
        _log(f"❌ {err} (après {elapsed:.1f}s)")
        _save_error(supabase_url, supabase_key, site, err)
        return 1

    elapsed = time.time() - start
    products = result.get("products", [])
    metadata = result.get("metadata", {})

    if not products:
        _log(f"⚠️  0 produits extraits en {elapsed:.1f}s")
        _save_error(supabase_url, supabase_key, site, "0 produits extraits")
        return 1

    _log(f"✅ {len(products)} produits en {elapsed:.1f}s")

    # 5. Upsert Supabase
    ok = _save_result(supabase_url, supabase_key, site, products, metadata, elapsed)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
