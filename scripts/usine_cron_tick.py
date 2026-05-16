#!/usr/bin/env python3
"""Cron tick scraper_usine — exécuté toutes les 2h par GitHub Actions.

Tâches d'un tick :
    1. Acquérir un verrou Supabase (`usine_queue.url='__cron_lock__'`) qui
       expire dans 110 min.
    2. Étape A — health-check rolling : pour chaque scraper approuvé dont le
       dernier healthcheck est le plus ancien, lance `validator.health_check`,
       insère dans `usine_healthchecks`, alerte si chute > 15 points.
    3. Étape B — vider la queue : prendre jusqu'à 3 URLs `pending` ordonnées
       par priorité, lancer `python -m scraper_ai.scraper_usine.main URL`,
       insérer le résultat dans `usine_runs`.
    4. Relâcher le verrou.

Tout résultat est persisté en SQL — plus rien en RAM côté FastAPI.

Bornes (configurable via env) :
    USINE_CRON_MAX_HEALTHCHECKS   défaut 5
    USINE_CRON_MAX_QUEUE          défaut 3
    USINE_CRON_LOCK_MINUTES       défaut 110
    USINE_CRON_HEALTHCHECK_DROP   défaut 15   (alerting threshold)
    USINE_CRON_TIMEOUT_USINE      défaut 1500 (25 min par run usine)
    USINE_CRON_TIMEOUT_CHECK      défaut 240  (4 min par healthcheck)

Variables d'env obligatoires :
    SUPABASE_URL
    SUPABASE_SERVICE_ROLE_KEY
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlparse

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent
REPORTS_DIR = PROJECT_ROOT / "scraper_cache" / "reports"
SUPERVISION_DIR = PROJECT_ROOT / "scraper_cache" / "supervision"
STRATEGIES_DIR = PROJECT_ROOT / "scraper_cache" / "strategies"

if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

# Imports tardifs pour ne pas charger Playwright/Supabase si le module est
# importé pour des tests unitaires.

# ---------------------------------------------------------------------------
# Helpers config
# ---------------------------------------------------------------------------

LOCK_DOMAIN = "__cron_lock__"

DEFAULTS = {
    "MAX_HEALTHCHECKS": 5,
    "MAX_QUEUE": 3,
    "LOCK_MINUTES": 110,
    "HEALTHCHECK_DROP": 15,
    "TIMEOUT_USINE": 1500,
    "TIMEOUT_CHECK": 240,
}


def _cfg(name: str) -> int:
    raw = os.environ.get(f"USINE_CRON_{name}")
    if raw is None or raw == "":
        return DEFAULTS[name]
    try:
        return int(raw)
    except ValueError:
        return DEFAULTS[name]


def _log(msg: str) -> None:
    ts = datetime.now(timezone.utc).strftime("%H:%M:%S")
    print(f"[{ts}] {msg}", flush=True)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _slug_from_url(url: str) -> str:
    domain = urlparse(url).netloc.replace("www.", "")
    base = re.sub(r"\.(com|ca|net|org|fr|qc\.ca)$", "", domain)
    return re.sub(r"[^a-z0-9]+", "-", base.lower()).strip("-")


# ---------------------------------------------------------------------------
# Verrou via usine_queue (pseudo row id=lock_domain)
# ---------------------------------------------------------------------------

def _acquire_lock(supabase, lock_minutes: int) -> bool:
    """Pose un verrou row pendant lock_minutes. Refuse si un verrou frais existe."""
    deadline_iso = (datetime.now(timezone.utc) - timedelta(minutes=lock_minutes)).isoformat()
    try:
        existing = (
            supabase.table("usine_queue")
            .select("id, url, status, picked_at, finished_at")
            .eq("url", LOCK_DOMAIN)
            .limit(1)
            .execute()
        )
    except Exception as e:
        _log(f"WARN lecture verrou KO : {e}")
        existing = type("X", (), {"data": []})()

    rows = existing.data or []
    if rows:
        row = rows[0]
        picked_at = row.get("picked_at") or ""
        if row.get("status") == "running" and picked_at > deadline_iso:
            _log(f"Verrou actif depuis {picked_at} — skip tick.")
            return False
        # Verrou périmé ou idle → on l'écrase
        try:
            supabase.table("usine_queue").update({
                "status": "running",
                "picked_at": _now_iso(),
                "finished_at": None,
                "last_error": None,
            }).eq("id", row["id"]).execute()
            return True
        except Exception as e:
            _log(f"WARN reprise verrou KO : {e}")
            return False

    try:
        supabase.table("usine_queue").insert({
            "url": LOCK_DOMAIN,
            "domain": LOCK_DOMAIN,
            "status": "running",
            "priority": 0,
            "options": {"internal": True, "kind": "cron_lock"},
            "picked_at": _now_iso(),
        }).execute()
        return True
    except Exception as e:
        _log(f"WARN insert verrou KO : {e}")
        return False


def _release_lock(supabase) -> None:
    try:
        supabase.table("usine_queue").update({
            "status": "done",
            "finished_at": _now_iso(),
        }).eq("url", LOCK_DOMAIN).execute()
    except Exception as e:
        _log(f"WARN release verrou KO : {e}")


# ---------------------------------------------------------------------------
# Étape A — Health-check rolling
# ---------------------------------------------------------------------------

def _pick_slugs_for_healthcheck(supabase, limit: int) -> List[str]:
    """Sélectionne les scrapers approuvés dont le dernier healthcheck est le
    plus ancien (round-robin).
    """
    try:
        approved = (
            supabase.table("shared_scrapers")
            .select("site_slug, validation_status")
            .eq("validation_status", "approved")
            .execute()
        )
    except Exception as e:
        _log(f"WARN lecture shared_scrapers : {e}")
        return []

    slugs = [r["site_slug"] for r in (approved.data or []) if r.get("site_slug")]
    if not slugs:
        return []

    # Récupère le ran_at max par slug
    last_ran: Dict[str, str] = {}
    try:
        rows = (
            supabase.table("usine_healthchecks")
            .select("slug, ran_at")
            .in_("slug", slugs)
            .order("ran_at", desc=True)
            .execute()
        )
        for r in (rows.data or []):
            slug = r["slug"]
            ran = r.get("ran_at") or ""
            if slug not in last_ran:
                last_ran[slug] = ran
    except Exception as e:
        _log(f"WARN lecture usine_healthchecks : {e}")

    # On trie par (ran_at ASC puis slug) : ceux jamais checkés en tête
    def _key(slug: str) -> Tuple[int, str, str]:
        ts = last_ran.get(slug) or ""
        return (1 if ts else 0, ts, slug)

    sorted_slugs = sorted(slugs, key=_key)
    return sorted_slugs[:limit]


def _run_health_check(slug: str, timeout: int) -> Dict[str, Any]:
    """Exécute `python -m scraper_ai.scraper_usine.main --check <slug>` et
    parse le rapport JSON.
    """
    result: Dict[str, Any] = {
        "slug": slug, "score": None, "grade": None,
        "duration_ms": None, "products_found": None,
        "error": None,
    }
    args = [
        sys.executable, "-u", "-m", "scraper_ai.scraper_usine.main",
        "--check", slug, "--quiet",
    ]
    started = time.time()
    try:
        proc = subprocess.run(
            args, cwd=str(PROJECT_ROOT),
            env={**os.environ, "PYTHONUNBUFFERED": "1"},
            capture_output=True, text=True, timeout=timeout,
        )
    except subprocess.TimeoutExpired:
        result["error"] = f"timeout > {timeout}s"
        result["duration_ms"] = int((time.time() - started) * 1000)
        return result
    except Exception as e:
        result["error"] = f"{type(e).__name__}: {e}"
        result["duration_ms"] = int((time.time() - started) * 1000)
        return result

    result["duration_ms"] = int((time.time() - started) * 1000)
    if proc.returncode != 0 and not (proc.stdout or "").strip():
        result["error"] = (proc.stderr or "")[-500:].strip() or f"exit {proc.returncode}"

    # Le rapport JSON est écrit par ScraperValidator
    path = REPORTS_DIR / f"{slug}_report.json"
    if path.exists():
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
            result["score"] = float(payload.get("score") or 0)
            result["grade"] = payload.get("grade") or None
            result["products_found"] = int(payload.get("products_tested") or 0)
        except Exception as e:
            result["error"] = result["error"] or f"parse report KO: {e}"
    elif not result["error"]:
        result["error"] = "rapport introuvable après --check"
    return result


def _previous_score(supabase, slug: str) -> Optional[float]:
    try:
        rows = (
            supabase.table("usine_healthchecks")
            .select("score, ran_at")
            .eq("slug", slug)
            .order("ran_at", desc=True)
            .limit(1)
            .execute()
        )
        data = rows.data or []
        if data and data[0].get("score") is not None:
            return float(data[0]["score"])
    except Exception:
        pass
    return None


def _insert_healthcheck(supabase, result: Dict[str, Any], drop_threshold: int) -> bool:
    """Insère un healthcheck. Retourne True si en état alerting."""
    previous = _previous_score(supabase, result["slug"])
    delta = None
    alerting = False
    if result["score"] is not None and previous is not None:
        delta = round(result["score"] - previous, 2)
        if delta < -drop_threshold:
            alerting = True

    payload = {
        "slug": result["slug"],
        "ran_at": _now_iso(),
        "score": result["score"],
        "grade": result["grade"],
        "duration_ms": result["duration_ms"],
        "products_found": result["products_found"],
        "delta_vs_previous": delta,
        "alerting": alerting,
        "error": (result["error"] or None),
    }
    try:
        supabase.table("usine_healthchecks").insert(payload).execute()
    except Exception as e:
        _log(f"WARN insert healthcheck {result['slug']} : {e}")
    return alerting


def _maybe_notify_alert(slug: str, previous: Optional[float], current: Optional[float]) -> None:
    """Hook discret. Si RESEND_API_KEY + ADMIN_EMAIL fournis, envoie un mail.
    Sinon, log uniquement (l'admin verra l'alerte dans /admin/usine).
    """
    msg = (
        f"[USINE] Dégradation détectée pour {slug}: "
        f"score {previous} -> {current}."
    )
    _log(msg)
    api_key = os.environ.get("RESEND_API_KEY")
    to = os.environ.get("ADMIN_ALERT_EMAIL") or os.environ.get("DEV_ADMIN_EMAIL")
    if not api_key or not to:
        return
    try:
        import requests
        requests.post(
            "https://api.resend.com/emails",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json={
                "from": os.environ.get("RESEND_FROM", "alerts@go-data.app"),
                "to": [to],
                "subject": f"[Usine] Dégradation scraper {slug}",
                "text": msg,
            },
            timeout=15,
        )
    except Exception as e:
        _log(f"WARN envoi mail alerte KO : {e}")


def _do_healthchecks(supabase, limit: int, timeout: int, drop_threshold: int) -> int:
    slugs = _pick_slugs_for_healthcheck(supabase, limit)
    if not slugs:
        _log("Aucun scraper approuvé à health-checker.")
        return 0
    _log(f"Health-check rolling : {len(slugs)} slugs ({', '.join(slugs)})")
    alerts = 0
    for slug in slugs:
        result = _run_health_check(slug, timeout)
        score_str = f"{result['score']:.0f}" if result["score"] is not None else "—"
        err = f" err={result['error']}" if result["error"] else ""
        _log(f"  - {slug}: score={score_str} dur={result['duration_ms']}ms{err}")
        previous = _previous_score(supabase, slug)
        if _insert_healthcheck(supabase, result, drop_threshold):
            _maybe_notify_alert(slug, previous, result["score"])
            alerts += 1
    return alerts


# ---------------------------------------------------------------------------
# Étape B — Vider la queue
# ---------------------------------------------------------------------------

def _pop_queue(supabase, limit: int) -> List[Dict[str, Any]]:
    try:
        rows = (
            supabase.table("usine_queue")
            .select("id, url, domain, options, priority, attempts, max_attempts")
            .eq("status", "pending")
            .neq("url", LOCK_DOMAIN)
            .order("priority")
            .order("created_at")
            .limit(limit)
            .execute()
        )
        return rows.data or []
    except Exception as e:
        _log(f"WARN lecture queue : {e}")
        return []


def _mark_queue_status(supabase, queue_id: str, status: str,
                       error: Optional[str] = None,
                       increment_attempts: bool = False) -> None:
    update: Dict[str, Any] = {"status": status}
    if status == "running":
        update["picked_at"] = _now_iso()
    if status in ("done", "failed"):
        update["finished_at"] = _now_iso()
    if error is not None:
        update["last_error"] = error[:1000]
    if increment_attempts:
        # PostgREST ne supporte pas l'increment direct ; on lit puis on écrit
        try:
            cur = (
                supabase.table("usine_queue")
                .select("attempts")
                .eq("id", queue_id)
                .limit(1).execute()
            )
            attempts = ((cur.data or [{}])[0]).get("attempts") or 0
            update["attempts"] = attempts + 1
        except Exception:
            pass
    try:
        supabase.table("usine_queue").update(update).eq("id", queue_id).execute()
    except Exception as e:
        _log(f"WARN update queue {queue_id} : {e}")


def _run_usine(url: str, options: Dict[str, Any], timeout: int) -> Tuple[Dict[str, Any], str]:
    """Lance le pipeline. Retourne (info, log_excerpt)."""
    args = [
        sys.executable, "-u", "-m", "scraper_ai.scraper_usine.main",
        url,
        "--publish-threshold", str(options.get("publishThreshold", 95)),
        "--quiet",
    ]
    if options.get("dryRun"):
        args.append("--dry-run")
    if options.get("forcePlaywright"):
        args.append("--force-playwright")
    if options.get("noClaude"):
        args.append("--no-claude")
    if options.get("noPublish"):
        args.append("--no-publish")
    if options.get("profile"):
        args.extend(["--profile", str(options["profile"])])

    started = time.time()
    info: Dict[str, Any] = {
        "url": url, "slug": _slug_from_url(url),
        "started_at_iso": _now_iso(), "duration_ms": 0,
        "status": "failed", "score": None, "grade": None,
        "platform": None, "products": None,
        "claude_supervisor_used": False, "claude_agent_used": False,
        "published": False, "error": None,
    }
    log_excerpt = ""
    try:
        proc = subprocess.run(
            args, cwd=str(PROJECT_ROOT),
            env={**os.environ, "PYTHONUNBUFFERED": "1"},
            capture_output=True, text=True, timeout=timeout,
        )
    except subprocess.TimeoutExpired as e:
        info["status"] = "timeout"
        info["error"] = f"timeout > {timeout}s"
        info["duration_ms"] = int((time.time() - started) * 1000)
        log_excerpt = ((e.stdout or "") + "\n[stderr]\n" + (e.stderr or ""))[-8000:]
        return info, log_excerpt
    except Exception as e:
        info["status"] = "failed"
        info["error"] = f"{type(e).__name__}: {e}"
        info["duration_ms"] = int((time.time() - started) * 1000)
        return info, ""

    info["duration_ms"] = int((time.time() - started) * 1000)
    stdout = proc.stdout or ""
    stderr = proc.stderr or ""
    log_excerpt = (stdout + ("\n[stderr]\n" + stderr if stderr.strip() else ""))[-8000:]

    # Détecte via logs
    info["claude_supervisor_used"] = bool(
        re.search(r"Claude review|Auto-correction Claude|supervisor.correct_scraper", stdout)
    )
    info["claude_agent_used"] = "Phase 4.5" in stdout or "AI Agent Claude" in stdout
    info["published"] = "PENDING" in stdout or "publié" in stdout.lower()

    slug = info["slug"]
    report_path = REPORTS_DIR / f"{slug}_report.json"
    if report_path.exists():
        try:
            payload = json.loads(report_path.read_text(encoding="utf-8"))
            info["score"] = float(payload.get("score") or 0)
            info["grade"] = payload.get("grade") or None
            info["platform"] = payload.get("platform_detected") or None
            info["products"] = int(payload.get("products_tested") or 0)
            if info["score"] is not None:
                if info["score"] >= 80:
                    info["status"] = "success"
                elif info["score"] >= 50:
                    info["status"] = "partial"
                else:
                    info["status"] = "failed"
        except Exception as e:
            info["error"] = f"parse report KO: {e}"
    else:
        info["error"] = info["error"] or (
            f"rapport introuvable (exit={proc.returncode})"
        )
    return info, log_excerpt


def _insert_run(supabase, info: Dict[str, Any], queue_id: Optional[str],
                trigger: str, log_excerpt: str) -> None:
    artifact_paths: Dict[str, str] = {}
    slug = info.get("slug")
    if slug:
        for kind, p in (
            ("analysis", PROJECT_ROOT / "scraper_cache" / "analysis" / f"{slug}_analysis.json"),
            ("strategy", STRATEGIES_DIR / f"{slug}_strategy.json"),
            ("report", REPORTS_DIR / f"{slug}_report.json"),
            ("audit", SUPERVISION_DIR / f"{slug}_audit.json"),
            ("agent_trace", SUPERVISION_DIR / f"{slug}_agent_trace.jsonl"),
        ):
            if p.exists():
                try:
                    artifact_paths[kind] = str(p.relative_to(PROJECT_ROOT))
                except ValueError:
                    artifact_paths[kind] = str(p)

    payload = {
        "queue_id": queue_id,
        "url": info["url"],
        "slug": slug,
        "trigger": trigger,
        "started_at": info["started_at_iso"],
        "finished_at": _now_iso(),
        "duration_ms": info["duration_ms"],
        "status": info["status"],
        "validation_score": info["score"],
        "validation_grade": info["grade"],
        "platform": info["platform"],
        "claude_supervisor_used": info["claude_supervisor_used"],
        "claude_agent_used": info["claude_agent_used"],
        "total_products": info["products"],
        "published": info["published"],
        "log_excerpt": log_excerpt,
        "artifact_paths": artifact_paths,
    }
    try:
        supabase.table("usine_runs").insert(payload).execute()
    except Exception as e:
        _log(f"WARN insert usine_run : {e}")


def _do_queue(supabase, limit: int, timeout: int) -> int:
    items = _pop_queue(supabase, limit)
    if not items:
        _log("Queue vide.")
        return 0
    _log(f"Queue : {len(items)} URL(s) à usiner.")
    n_success = 0
    for item in items:
        queue_id = item["id"]
        url = item["url"]
        options = item.get("options") or {}
        attempts = item.get("attempts") or 0
        max_attempts = item.get("max_attempts") or 2

        _log(f"  -> {url}  (attempts={attempts}/{max_attempts})")
        _mark_queue_status(supabase, queue_id, "running", increment_attempts=True)

        info, log_excerpt = _run_usine(url, options, timeout)
        _insert_run(supabase, info, queue_id=queue_id, trigger="cron",
                    log_excerpt=log_excerpt)

        if info["status"] == "success":
            _mark_queue_status(supabase, queue_id, "done")
            n_success += 1
            _log(f"     OK score={info['score']} produits={info['products']}")
        else:
            new_attempts = attempts + 1
            err = info.get("error") or info["status"]
            if new_attempts >= max_attempts:
                _mark_queue_status(supabase, queue_id, "failed", error=err)
                _log(f"     FAIL ({new_attempts}/{max_attempts}) — {err}")
            else:
                # Remettre en pending pour retry
                try:
                    supabase.table("usine_queue").update({
                        "status": "pending",
                        "last_error": (err or "")[:1000],
                        "finished_at": None,
                    }).eq("id", queue_id).execute()
                except Exception as e:
                    _log(f"WARN reset pending {queue_id} : {e}")
                _log(f"     RETRY ({new_attempts}/{max_attempts}) — {err}")
    return n_success


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> int:
    supabase_url = os.environ.get("SUPABASE_URL")
    supabase_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not supabase_url or not supabase_key:
        _log("ERREUR : SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY requis.")
        return 2

    try:
        from supabase import create_client
    except ImportError:
        _log("ERREUR : pip install supabase requis.")
        return 2

    supabase = create_client(supabase_url, supabase_key)

    lock_minutes = _cfg("LOCK_MINUTES")
    max_hc = _cfg("MAX_HEALTHCHECKS")
    max_q = _cfg("MAX_QUEUE")
    drop = _cfg("HEALTHCHECK_DROP")
    to_usine = _cfg("TIMEOUT_USINE")
    to_check = _cfg("TIMEOUT_CHECK")

    _log(
        f"USINE CRON TICK — max_hc={max_hc} max_queue={max_q} "
        f"lock={lock_minutes}min drop={drop} "
        f"timeouts(usine={to_usine}s check={to_check}s)"
    )

    if not _acquire_lock(supabase, lock_minutes):
        return 0

    alerts = 0
    successes = 0
    try:
        alerts = _do_healthchecks(supabase, max_hc, to_check, drop)
        successes = _do_queue(supabase, max_q, to_usine)
    finally:
        _release_lock(supabase)

    _log(f"FIN TICK : alerts={alerts} queue_ok={successes}")
    return 0


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
