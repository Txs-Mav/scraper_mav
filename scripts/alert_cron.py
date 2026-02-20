"""
Orchestrateur d'alertes automatisées — exécuté par GitHub Actions chaque heure.

Flow :
  1. Query Supabase : alertes actives programmées pour l'heure UTC courante
  2. Pour chaque utilisateur : récupérer la config scraper, lancer le scraping Python
  3. Appeler l'API Vercel /api/alerts/check pour détecter les changements et envoyer les emails

Variables d'environnement requises :
  SUPABASE_URL              — URL du projet Supabase
  SUPABASE_SERVICE_ROLE_KEY — Clé service role (bypass RLS)
  GEMINI_API_KEY            — Clé API Google Gemini
  APP_URL                   — URL de l'app Vercel (ex: https://go-data-dashboard.vercel.app)
  CRON_SECRET               — Secret partagé avec le endpoint /api/alerts/check
"""

import os
import sys
import subprocess
import time
from datetime import datetime, timezone

import requests
from supabase import create_client


def main():
    supabase_url = os.environ.get("SUPABASE_URL")
    supabase_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    app_url = os.environ.get("APP_URL", "").rstrip("/")
    cron_secret = os.environ.get("CRON_SECRET", "")
    gemini_key = os.environ.get("GEMINI_API_KEY", "")

    if not supabase_url or not supabase_key:
        print("❌ SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont requis")
        sys.exit(1)

    if not app_url:
        print("❌ APP_URL est requis (URL Vercel)")
        sys.exit(1)

    supabase = create_client(supabase_url, supabase_key)
    current_hour = datetime.now(timezone.utc).hour

    print(f"\n{'='*60}")
    print(f"🔔 ALERT CRON — {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}")
    print(f"{'='*60}")
    print(f"🕐 Heure UTC : {current_hour}:00")

    # ── 1. Récupérer les alertes actives pour cette heure ──
    result = (
        supabase.table("scraper_alerts")
        .select("id, user_id, scraper_cache_id, scraper_cache(site_url)")
        .eq("is_active", True)
        .eq("schedule_hour", current_hour)
        .execute()
    )
    alerts = result.data or []

    if not alerts:
        print("✅ Aucune alerte programmée pour cette heure")
        return

    # Grouper par user_id
    users: dict[str, list] = {}
    for alert in alerts:
        uid = alert["user_id"]
        users.setdefault(uid, []).append(alert)

    print(f"📋 {len(alerts)} alerte(s) pour {len(users)} utilisateur(s)\n")

    # ── 2. Pour chaque utilisateur, récupérer config et lancer le scraping ──
    scraping_success = 0
    scraping_failed = 0

    for user_id, user_alerts in users.items():
        short_id = user_id[:8]

        try:
            config_result = (
                supabase.table("scraper_config")
                .select("reference_url, competitor_urls, categories, ignore_colors")
                .eq("user_id", user_id)
                .single()
                .execute()
            )
            config = config_result.data
        except Exception:
            config = None

        if not config or not config.get("reference_url"):
            print(f"⚠️  User {short_id}: pas de config scraper, skip")
            scraping_failed += 1
            continue

        reference_url = config["reference_url"]
        competitor_urls = config.get("competitor_urls") or []
        categories = config.get("categories") or []
        ignore_colors = config.get("ignore_colors", False)

        print(f"🔄 User {short_id} — {reference_url}")
        print(f"   Concurrents : {len(competitor_urls)} | Catégories : {categories}")

        # Construire la commande
        all_urls = [reference_url] + (competitor_urls if isinstance(competitor_urls, list) else [])

        cmd = [
            sys.executable, "-m", "scraper_ai.main",
            "--reference", reference_url,
            "--user-id", user_id,
        ]
        if categories:
            cat_str = ",".join(categories) if isinstance(categories, list) else str(categories)
            cmd.extend(["--categories", cat_str])
        if ignore_colors:
            cmd.append("--ignore-colors")
        cmd.extend(all_urls)

        env = {
            **os.environ,
            "PYTHONUNBUFFERED": "1",
            "GEMINI_API_KEY": gemini_key,
            "NEXTJS_API_URL": app_url,
            "SCRAPER_USER_ID": user_id,
        }

        start = time.time()
        try:
            proc = subprocess.run(
                cmd,
                env=env,
                timeout=900,  # 15 minutes max
                capture_output=True,
                text=True,
            )
            elapsed = time.time() - start

            if proc.returncode == 0:
                print(f"   ✅ Scraping OK ({elapsed:.0f}s)")
                scraping_success += 1
            else:
                print(f"   ❌ Scraping échoué (code {proc.returncode}, {elapsed:.0f}s)")
                stderr_tail = proc.stderr[-300:] if proc.stderr else ""
                if stderr_tail:
                    print(f"   stderr: {stderr_tail}")
                scraping_failed += 1
        except subprocess.TimeoutExpired:
            print(f"   ❌ Timeout (15 min)")
            scraping_failed += 1
        except Exception as e:
            print(f"   ❌ Erreur: {e}")
            scraping_failed += 1

    print(f"\n📊 Scraping terminé : {scraping_success} OK, {scraping_failed} échoué(s)")

    # ── 3. Appeler le endpoint check de Vercel pour détecter les changements ──
    check_url = f"{app_url}/api/alerts/check"
    print(f"\n📡 Appel à {check_url}...")

    try:
        resp = requests.get(
            check_url,
            headers={"Authorization": f"Bearer {cron_secret}"},
            timeout=120,
        )

        if resp.status_code == 200:
            data = resp.json()
            print(f"   ✅ Check OK — {data.get('checked', 0)} vérifié(s), {data.get('changes_detected', 0)} changement(s)")
        else:
            print(f"   ❌ Erreur {resp.status_code}: {resp.text[:200]}")
    except Exception as e:
        print(f"   ❌ Erreur appel check: {e}")

    print(f"\n{'='*60}")
    print(f"✅ ALERT CRON TERMINÉ")
    print(f"{'='*60}\n")


if __name__ == "__main__":
    main()
