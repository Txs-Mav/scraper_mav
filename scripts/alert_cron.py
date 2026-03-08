"""
Orchestrateur d'alertes automatisées — exécuté par GitHub Actions chaque heure.

Flow :
  1. Query Supabase : alertes actives éligibles (interval OU daily)
  2. Pour chaque alerte : utiliser reference_url + competitor_urls de l'alerte, lancer le scraping Python
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
from datetime import datetime, timedelta, timezone

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

    # ── 1. Récupérer les alertes actives éligibles ──
    # (a) Alertes « interval » dont le délai est écoulé depuis last_run_at
    # (b) Alertes « daily » dont l'heure UTC correspond
    result = (
        supabase.table("scraper_alerts")
        .select("id, user_id, reference_url, competitor_urls, categories, schedule_type, schedule_hour, schedule_interval_hours, last_run_at, scraper_cache_id, scraper_cache(site_url)")
        .eq("is_active", True)
        .execute()
    )
    all_alerts = result.data or []

    now = datetime.now(timezone.utc)
    alerts = []
    for a in all_alerts:
        stype = a.get("schedule_type", "daily")
        if stype == "interval":
            interval_h = a.get("schedule_interval_hours") or 1
            last_run = a.get("last_run_at")
            if not last_run:
                alerts.append(a)
            else:
                last_run_dt = datetime.fromisoformat(last_run.replace("Z", "+00:00"))
                if now >= last_run_dt + timedelta(hours=interval_h):
                    alerts.append(a)
        else:
            if a.get("schedule_hour") == current_hour:
                alerts.append(a)

    if not alerts:
        print(f"✅ Aucune alerte éligible (vérifié {len(all_alerts)} alerte(s) actives)")
        return

    # Grouper par user_id
    users: dict[str, list] = {}
    for alert in alerts:
        uid = alert["user_id"]
        users.setdefault(uid, []).append(alert)

    print(f"📋 {len(alerts)} alerte(s) pour {len(users)} utilisateur(s)\n")

    # ── 2. Pour chaque alerte, lancer le scraping avec ses propres URLs ──
    scraping_success = 0
    scraping_failed = 0

    for user_id, user_alerts in users.items():
        short_id = user_id[:8]

        for alert in user_alerts:
            alert_id = alert["id"][:8]
            reference_url = alert.get("reference_url")
            if not reference_url:
                site_url = (alert.get("scraper_cache") or {}).get("site_url")
                reference_url = site_url

            if not reference_url:
                print(f"⚠️  Alerte {alert_id} (user {short_id}): pas d'URL de référence, skip")
                scraping_failed += 1
                continue

            competitor_urls = alert.get("competitor_urls") or []
            categories = alert.get("categories") or ["inventaire", "occasion", "catalogue"]

            print(f"🔄 Alerte {alert_id} (user {short_id}) — {reference_url}")
            print(f"   Concurrents : {len(competitor_urls)} | Catégories : {categories}")

            all_urls = [reference_url]
            if isinstance(competitor_urls, list):
                all_urls.extend(u for u in competitor_urls if u != reference_url)

            cmd = [
                sys.executable, "-m", "scraper_ai.main",
                "--reference", reference_url,
                "--user-id", user_id,
            ]
            if categories:
                cat_str = ",".join(categories) if isinstance(categories, list) else str(categories)
                cmd.extend(["--categories", cat_str])
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
                    timeout=900,
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
