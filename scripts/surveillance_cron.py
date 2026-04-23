"""
Surveillance du marché — exécuté par GitHub Actions toutes les heures (à :30).

Rafraîchit les comparaisons de prix pour tous les utilisateurs configurés
en utilisant les données déjà scrapées dans scraped_site_data.

Ce workflow est complémentaire au scraper_cron.py (qui tourne à :00) :
  - scraper_cron.py  → scrape les sites et met à jour scraped_site_data
  - surveillance_cron.py → lit scraped_site_data et met à jour les comparaisons
    dans la table scrapings pour chaque utilisateur

Variables d'environnement requises :
  SUPABASE_URL              — URL du projet Supabase
  SUPABASE_SERVICE_ROLE_KEY — Clé service role (bypass RLS)
"""

import os
import sys
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent
PROJECT_ROOT = SCRIPT_DIR.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from _http_helpers import get_with_retry

COMPARE_SCRIPT = str(SCRIPT_DIR / "compare_from_cache.py")
MAX_USERS = 50
USER_TIMEOUT = 120


def _headers(key: str) -> dict:
    return {
        "apikey": key,
        "Authorization": f"Bearer {key}",
    }


def main():
    supabase_url = os.environ.get("SUPABASE_URL")
    supabase_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

    if not supabase_url or not supabase_key:
        print("❌ SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont requis")
        sys.exit(1)

    print(f"\n{'='*60}")
    print(f"📊 SURVEILLANCE DU MARCHÉ — {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}")
    print(f"   Rafraîchissement des comparaisons depuis scraped_site_data")
    print(f"{'='*60}")

    resp = get_with_retry(
        f"{supabase_url}/rest/v1/scraper_config",
        params={
            "select": "user_id,reference_url,competitor_urls",
            "reference_url": "not.is.null",
        },
        headers=_headers(supabase_key),
        timeout=30,
        max_attempts=5,
        base_backoff=3.0,
        logger=print,
    )

    if resp is None:
        print("❌ Supabase injoignable après plusieurs tentatives — abandon")
        sys.exit(1)

    if resp.status_code != 200:
        print(f"❌ Erreur lecture scraper_config: {resp.status_code} — {resp.text[:300]}")
        sys.exit(1)

    configs = resp.json() or []
    configs = [c for c in configs if c.get("reference_url")]

    if not configs:
        print("✅ Aucun utilisateur avec une config de surveillance")
        return

    seen_users = set()
    unique_configs = []
    for c in configs:
        uid = c["user_id"]
        if uid not in seen_users:
            seen_users.add(uid)
            unique_configs.append(c)

    unique_configs = unique_configs[:MAX_USERS]

    print(f"\n📋 {len(unique_configs)} utilisateur(s) à traiter\n")

    success = 0
    failed = 0
    start_total = time.time()

    for config in unique_configs:
        uid = config["user_id"]
        ref_url = config.get("reference_url", "")
        competitors = config.get("competitor_urls") or []

        if not ref_url:
            continue

        cmd = [
            sys.executable, COMPARE_SCRIPT,
            "--user-id", uid,
            "--reference", ref_url,
        ]
        if competitors:
            cmd.extend(["--competitors", ",".join(competitors)])

        uid_short = uid[:8]
        print(f"   🔄 User {uid_short}... — ref={ref_url}")

        try:
            proc = subprocess.run(
                cmd,
                cwd=str(PROJECT_ROOT),
                capture_output=True,
                text=True,
                timeout=USER_TIMEOUT,
                env={
                    **os.environ,
                    "SUPABASE_URL": supabase_url,
                    "SUPABASE_SERVICE_ROLE_KEY": supabase_key,
                },
            )
            if proc.returncode == 0:
                success += 1
                print(f"   ✅ User {uid_short}... — OK")
            else:
                failed += 1
                last_lines = (proc.stdout or proc.stderr or "").strip().split("\n")[-3:]
                print(f"   ⚠️  User {uid_short}... — code {proc.returncode}: {' | '.join(last_lines)}")
        except subprocess.TimeoutExpired:
            failed += 1
            print(f"   ⏰ User {uid_short}... — timeout (>{USER_TIMEOUT}s)")
        except Exception as e:
            failed += 1
            print(f"   ❌ User {uid_short}... — {e}")

    elapsed = time.time() - start_total

    print(f"\n{'='*60}")
    print(f"✅ SURVEILLANCE TERMINÉE")
    print(f"   {success}/{len(unique_configs)} OK, {failed} échoué(s)")
    print(f"   Durée: {elapsed:.1f}s")
    print(f"{'='*60}\n")


if __name__ == "__main__":
    main()
