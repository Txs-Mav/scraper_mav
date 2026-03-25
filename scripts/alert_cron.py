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


def _rollback_last_run(supabase, alert_id: str, previous_value):
    """Restore last_run_at to its previous value so the cron retries next cycle."""
    try:
        update_val = previous_value if previous_value else None
        supabase.table("scraper_alerts") \
            .update({"last_run_at": update_val}) \
            .eq("id", alert_id) \
            .execute()
        print(f"   🔄 last_run_at restauré → le cron réessaiera au prochain cycle")
    except Exception as e:
        print(f"   ⚠️  Impossible de restaurer last_run_at: {e}")


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

    # Grouper par user_id
    users: dict[str, list] = {}
    for alert in alerts:
        uid = alert["user_id"]
        users.setdefault(uid, []).append(alert)

    print(f"📋 {len(alerts)} alerte(s) pour {len(users)} utilisateur(s)\n")

    # ── 2. Verrouiller last_run_at AVANT le scraping ──
    # On utilise l'heure réelle du run pour supporter les intervalles sub-horaires.
    # Ex: run à 10:25 → last_run_at = 10:25 → prochain check à 10:25 + 40min = 11:05
    cron_start_time = now.replace(second=0, microsecond=0)

    for alert in alerts:
        try:
            supabase.table("scraper_alerts") \
                .update({"last_run_at": cron_start_time.isoformat()}) \
                .eq("id", alert["id"]) \
                .execute()
        except Exception as e:
            print(f"⚠️  Impossible de verrouiller last_run_at pour {alert['id'][:8]}: {e}")

    # ── 3. Pour chaque alerte, lancer le scraping avec ses propres URLs ──
    scraping_success = 0
    scraping_failed = 0

    for user_id, user_alerts in users.items():
        short_id = user_id[:8]

        for alert in user_alerts:
            alert_id = alert["id"][:8]
            full_alert_id = alert["id"]
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

            print(f"\n🔄 Alerte {alert_id} (user {short_id}) — {reference_url}")
            print(f"   Concurrents : {len(competitor_urls)} | Catégories : {categories}")
            for i, comp_url in enumerate(competitor_urls, 1):
                print(f"   {i}. {comp_url}")

            # Snapshot du dernier scraping AVANT le run (pour vérifier si un nouveau est créé)
            last_scraping_before = None
            try:
                res = supabase.table("scrapings") \
                    .select("id, created_at") \
                    .eq("user_id", user_id) \
                    .eq("reference_url", reference_url) \
                    .order("created_at", desc=True) \
                    .limit(1) \
                    .execute()
                if res.data:
                    last_scraping_before = res.data[0]["created_at"]
            except Exception:
                pass

            all_urls = [reference_url]
            if isinstance(competitor_urls, list):
                all_urls.extend(u for u in competitor_urls if u != reference_url)

            print(f"   📋 Total URLs à scraper : {len(all_urls)}")

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
            subprocess_timeout = 1500  # 25 min (was 15 min — needed with 10+ competitor sites)
            try:
                proc = subprocess.run(
                    cmd,
                    env=env,
                    timeout=subprocess_timeout,
                    text=True,
                )
                elapsed = time.time() - start

                if proc.returncode == 0:
                    print(f"   ✅ Scraping OK ({elapsed:.0f}s)")
                    scraping_success += 1
                else:
                    print(f"   ❌ Scraping échoué (code {proc.returncode}, {elapsed:.0f}s)")
                    scraping_failed += 1
                    # Rollback last_run_at so cron retries next cycle
                    _rollback_last_run(supabase, full_alert_id, alert.get("last_run_at"))
                    continue
            except subprocess.TimeoutExpired:
                elapsed = time.time() - start
                print(f"   ❌ Timeout après {elapsed:.0f}s (limite {subprocess_timeout}s, {len(all_urls)} URLs)")
                scraping_failed += 1
                _rollback_last_run(supabase, full_alert_id, alert.get("last_run_at"))
                continue
            except Exception as e:
                print(f"   ❌ Erreur: {e}")
                scraping_failed += 1
                _rollback_last_run(supabase, full_alert_id, alert.get("last_run_at"))
                continue

            # Vérifier qu'un nouveau scraping a bien été enregistré dans Supabase
            time.sleep(2)
            try:
                res = supabase.table("scrapings") \
                    .select("id, created_at") \
                    .eq("user_id", user_id) \
                    .eq("reference_url", reference_url) \
                    .order("created_at", desc=True) \
                    .limit(1) \
                    .execute()
                if res.data:
                    latest = res.data[0]["created_at"]
                    if latest != last_scraping_before:
                        print(f"   💾 Nouveau scraping confirmé dans Supabase ({latest})")
                    else:
                        print(f"   ⚠️  ATTENTION: Scraping OK mais aucun nouvel enregistrement dans Supabase!")
                        print(f"   ⚠️  Dernier scraping toujours à: {latest}")
                        print(f"   ⚠️  La sauvegarde vers Supabase a probablement échoué")
                else:
                    print(f"   ⚠️  ATTENTION: Aucun scraping trouvé dans Supabase pour cette alerte!")
            except Exception as e:
                print(f"   ⚠️  Impossible de vérifier le scraping: {e}")

    print(f"\n📊 Scraping terminé : {scraping_success} OK, {scraping_failed} échoué(s)")

    # ── 4. Pour chaque alerte scrapée, appeler POST /api/alerts/check ──
    # skip_schedule_update=True car last_run_at est déjà verrouillé à l'étape 2
    check_url = f"{app_url}/api/alerts/check"
    check_headers = {
        "Authorization": f"Bearer {cron_secret}",
        "Content-Type": "application/json",
    }

    check_ok = 0
    check_failed = 0
    total_changes = 0

    scraped_alert_ids = [
        a["id"] for a in alerts
        if (a.get("reference_url") or (a.get("scraper_cache") or {}).get("site_url"))
    ]

    if scraped_alert_ids:
        print(f"\n📡 Analyse de {len(scraped_alert_ids)} alerte(s) via {check_url}...")

        for alert_id in scraped_alert_ids:
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
    else:
        print("\n⚠️  Aucune alerte avec URL valide à analyser")

    print(f"\n{'='*60}")
    print(f"✅ ALERT CRON TERMINÉ")
    print(f"{'='*60}\n")


if __name__ == "__main__":
    main()
