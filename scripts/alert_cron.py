"""
Orchestrateur d'alertes automatisées — exécuté par GitHub Actions toutes les 20 min.

Flow :
  1. Query Supabase : alertes actives éligibles (interval OU daily)
  2. Scraping PARALLÈLE (max 3 workers) de chaque alerte
  3. last_run_at mis à jour APRÈS scraping réussi (pas avant)
  4. Appeler l'API Vercel /api/alerts/check pour détecter les changements

Variables d'environnement requises :
  SUPABASE_URL              — URL du projet Supabase
  SUPABASE_SERVICE_ROLE_KEY — Clé service role (bypass RLS)
  GEMINI_API_KEY            — Clé API Google Gemini
  APP_URL                   — URL de l'app Vercel (ex: https://go-data-dashboard.vercel.app)
  CRON_SECRET               — Secret partagé avec le endpoint /api/alerts/check
"""

import os
import sys
import signal
import subprocess
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from threading import Lock

import requests
from supabase import create_client

MAX_WORKERS = 3
SUBPROCESS_TIMEOUT = 1800  # 30 min per alert

print_lock = Lock()


def _log(msg: str):
    with print_lock:
        print(msg, flush=True)


def _scrape_alert(alert: dict, *, gemini_key: str, app_url: str) -> dict:
    """Scrape a single alert. Returns a result dict. Thread-safe."""
    alert_id = alert["id"]
    short_id = alert_id[:8]
    user_id = alert["user_id"]
    user_short = user_id[:8]

    reference_url = alert.get("reference_url")
    if not reference_url:
        reference_url = (alert.get("scraper_cache") or {}).get("site_url")

    if not reference_url:
        _log(f"   ⚠️  Alerte {short_id} (user {user_short}): pas d'URL de référence, skip")
        return {"alert_id": alert_id, "success": False, "reason": "no_url"}

    competitor_urls = alert.get("competitor_urls") or []
    categories = alert.get("categories") or ["inventaire", "occasion", "catalogue"]

    _log(f"\n🔄 Alerte {short_id} (user {user_short}) — {reference_url}")
    _log(f"   Concurrents : {len(competitor_urls)} | Catégories : {categories}")

    def _domain(u: str) -> str:
        try:
            from urllib.parse import urlparse
            return urlparse(u).netloc.replace('www.', '').lower()
        except Exception:
            return u.lower()

    ref_domain = _domain(reference_url)
    seen = {ref_domain}
    all_urls = [reference_url]
    if isinstance(competitor_urls, list):
        for u in competitor_urls:
            d = _domain(u)
            if d not in seen:
                seen.add(d)
                all_urls.append(u)

    _log(f"   📋 Total URLs à scraper : {len(all_urls)} (dédupliqué par domaine)")

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
        proc = subprocess.run(cmd, env=env, timeout=SUBPROCESS_TIMEOUT, text=True)
        elapsed = time.time() - start

        if proc.returncode == 0:
            _log(f"   ✅ Alerte {short_id}: Scraping OK ({elapsed:.0f}s)")
            return {"alert_id": alert_id, "success": True, "elapsed": elapsed}
        else:
            _log(f"   ❌ Alerte {short_id}: Scraping échoué (code {proc.returncode}, {elapsed:.0f}s)")
            return {"alert_id": alert_id, "success": False, "reason": f"exit_{proc.returncode}"}
    except subprocess.TimeoutExpired:
        elapsed = time.time() - start
        _log(f"   ❌ Alerte {short_id}: Timeout après {elapsed:.0f}s ({len(all_urls)} URLs)")
        return {"alert_id": alert_id, "success": False, "reason": "timeout"}
    except Exception as e:
        _log(f"   ❌ Alerte {short_id}: Erreur — {e}")
        return {"alert_id": alert_id, "success": False, "reason": str(e)}


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
    result = (
        supabase.table("scraper_alerts")
        .select("id, user_id, reference_url, competitor_urls, categories, schedule_type, schedule_hour, schedule_interval_hours, schedule_interval_minutes, last_run_at, scraper_cache_id, scraper_cache(site_url)")
        .eq("is_active", True)
        .execute()
    )
    all_alerts = result.data or []

    now = datetime.now(timezone.utc)
    tolerance = timedelta(minutes=5)
    alerts = []
    for a in all_alerts:
        stype = a.get("schedule_type", "daily")
        if stype == "interval":
            interval_min = a.get("schedule_interval_minutes")
            if not interval_min:
                interval_h = a.get("schedule_interval_hours") or 1
                interval_min = interval_h * 60
            last_run = a.get("last_run_at")
            if not last_run:
                alerts.append(a)
            else:
                last_run_dt = datetime.fromisoformat(last_run.replace("Z", "+00:00"))
                if now >= last_run_dt + timedelta(minutes=interval_min) - tolerance:
                    alerts.append(a)
        else:
            if a.get("schedule_hour") == current_hour:
                alerts.append(a)

    if not alerts:
        print(f"✅ Aucune alerte éligible (vérifié {len(all_alerts)} alerte(s) actives)")
        return

    print(f"📋 {len(alerts)} alerte(s) éligibles — scraping parallèle (max {MAX_WORKERS} workers)\n")

    # ── 2. Scraping PARALLÈLE ──
    succeeded_ids: list[str] = []
    failed_count = 0
    cron_timestamp = now.replace(second=0, microsecond=0).isoformat()

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        future_to_alert = {
            executor.submit(
                _scrape_alert, alert, gemini_key=gemini_key, app_url=app_url
            ): alert
            for alert in alerts
        }

        # SIGTERM handler: cancel pending futures gracefully
        def _on_sigterm(signum, frame):
            print("\n⚠️  SIGTERM reçu — annulation des tâches en cours...")
            executor.shutdown(wait=False, cancel_futures=True)
            sys.exit(1)

        signal.signal(signal.SIGTERM, _on_sigterm)
        signal.signal(signal.SIGINT, _on_sigterm)

        for future in as_completed(future_to_alert):
            result = future.result()
            aid = result["alert_id"]

            if result["success"]:
                succeeded_ids.append(aid)
                # Verrouiller last_run_at APRÈS succès
                try:
                    supabase.table("scraper_alerts") \
                        .update({"last_run_at": cron_timestamp}) \
                        .eq("id", aid) \
                        .execute()
                except Exception as e:
                    _log(f"   ⚠️  last_run_at non mis à jour pour {aid[:8]}: {e}")
            else:
                failed_count += 1

    print(f"\n📊 Scraping terminé : {len(succeeded_ids)} OK, {failed_count} échoué(s)")

    # ── 3. Appeler POST /api/alerts/check pour les alertes réussies ──
    if not succeeded_ids:
        print("\n⚠️  Aucun scraping réussi — pas d'analyse à effectuer")
        print(f"\n{'='*60}\n✅ ALERT CRON TERMINÉ\n{'='*60}\n")
        return

    check_url = f"{app_url}/api/alerts/check"
    check_headers = {
        "Authorization": f"Bearer {cron_secret}",
        "Content-Type": "application/json",
    }

    print(f"\n📡 Analyse de {len(succeeded_ids)} alerte(s) via {check_url}...")

    check_ok = 0
    check_failed = 0
    total_changes = 0

    for alert_id in succeeded_ids:
        short_id = alert_id[:8]
        try:
            resp = requests.post(
                check_url,
                headers=check_headers,
                json={
                    "alert_id": alert_id,
                    "trigger_scraping": False,
                    "skip_schedule_update": True,
                },
                timeout=120,
            )

            if resp.status_code == 200:
                data = resp.json()
                changes = data.get("changes_detected", 0)
                total_changes += changes
                status = f"{changes} changement(s)" if changes else "aucun changement"
                print(f"   ✅ Alerte {short_id}: {status}")
                check_ok += 1
            else:
                print(f"   ❌ Alerte {short_id}: erreur {resp.status_code} — {resp.text[:200]}")
                check_failed += 1
        except Exception as e:
            print(f"   ❌ Alerte {short_id}: erreur — {e}")
            check_failed += 1

    print(f"\n📊 Analyse terminée : {check_ok} OK, {check_failed} échoué(s), {total_changes} changement(s) total")
    print(f"\n{'='*60}")
    print(f"✅ ALERT CRON TERMINÉ")
    print(f"{'='*60}\n")


if __name__ == "__main__":
    main()
