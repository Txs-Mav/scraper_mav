import os
import sys
import uuid
import time
import threading
import subprocess
from pathlib import Path
from dataclasses import dataclass, field

from fastapi import FastAPI, HTTPException, Request, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel

PROJECT_ROOT = Path(__file__).parent.parent

sys.path.insert(0, str(PROJECT_ROOT))

app = FastAPI(title="Scraper Backend")

BACKEND_SECRET = os.environ.get("BACKEND_SECRET", "")

# ---------------------------------------------------------------------------
# Auth middleware
# ---------------------------------------------------------------------------

async def verify_secret(request: Request):
    if not BACKEND_SECRET:
        return
    token = request.headers.get("X-Backend-Secret", "")
    if token != BACKEND_SECRET:
        raise HTTPException(status_code=403, detail="Invalid backend secret")


# ---------------------------------------------------------------------------
# In-memory job storage
# ---------------------------------------------------------------------------

@dataclass
class JobState:
    job_id: str
    pid: int | None = None
    log_lines: list[str] = field(default_factory=list)
    is_complete: bool = False
    has_error: bool = False
    start_time: float = field(default_factory=time.time)

jobs: dict[str, JobState] = {}

COMPLETION_PATTERNS = [
    "✅ SCRAPING TERMINÉ!",
    "☁️  Données dans:",
    "💾 Sauvegardé localement:",
    "💾 Backup local:",
]

ERROR_PATTERNS = [
    "erreur fatale",
    "erreur critique",
    "AUTHENTIFICATION REQUISE",
    "❌ Aucun site de référence configuré",
    "Traceback (most recent call last)",
    "TypeError:",
    "AttributeError:",
    "KeyError:",
    "ImportError:",
    "ModuleNotFoundError:",
    "fatal error",
    "exception:",
]


def _stream_output(proc: subprocess.Popen, job: JobState):
    """Read subprocess stdout line by line and populate the job log."""
    try:
        assert proc.stdout is not None
        for raw_line in proc.stdout:
            line = raw_line.rstrip("\n")
            job.log_lines.append(line)

            line_lower = line.lower()
            combined = "\n".join(job.log_lines)
            combined_lower = combined.lower()

            if any(p in combined for p in COMPLETION_PATTERNS):
                if "⭐ Site de référence:" in combined:
                    job.is_complete = True
            if any(p.lower() in combined_lower for p in ERROR_PATTERNS):
                job.has_error = True
                job.is_complete = True
    except Exception:
        pass
    finally:
        proc.wait()
        job.is_complete = True
        if proc.returncode and proc.returncode != 0:
            job.has_error = True


def _cleanup_old_jobs():
    """Remove jobs older than 6 hours."""
    cutoff = time.time() - 6 * 3600
    to_remove = [jid for jid, j in jobs.items() if j.start_time < cutoff and j.is_complete]
    for jid in to_remove:
        del jobs[jid]


# ---------------------------------------------------------------------------
# Request / response models
# ---------------------------------------------------------------------------

class ScraperRunRequest(BaseModel):
    userId: str
    referenceUrl: str
    urls: list[str] = []
    forceRefresh: bool = False
    ignoreColors: bool = False
    inventoryOnly: bool = False
    matchMode: str = 'exact'

class ScraperAIRunRequest(BaseModel):
    userId: str
    url: str
    urls: list[str] = []
    referenceUrl: str | None = None
    forceRefresh: bool = False
    categories: list[str] | None = None

class AnalyzeRequest(BaseModel):
    userId: str
    url: str
    forceRefresh: bool = False


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.post("/scraper/run", dependencies=[Depends(verify_secret)])
async def scraper_run(body: ScraperRunRequest):
    """Start the main scraper as a background process and return a job ID."""
    _cleanup_old_jobs()

    all_urls = [u for u in body.urls if u and u.strip()]
    if body.referenceUrl not in all_urls:
        all_urls.insert(0, body.referenceUrl)

    if not all_urls:
        raise HTTPException(400, "At least one valid URL is required")

    args = [sys.executable, "-u", "-m", "scraper_ai.main"]
    args.extend(["--user-id", body.userId])
    if body.referenceUrl:
        args.extend(["--reference", body.referenceUrl])
    if body.forceRefresh:
        args.append("--force-refresh")
    if body.ignoreColors:
        args.append("--ignore-colors")
    if body.inventoryOnly:
        args.append("--inventory-only")
    if body.matchMode and body.matchMode != 'exact':
        args.extend(["--match-mode", body.matchMode])
    args.extend(all_urls)

    job_id = str(uuid.uuid4())
    job = JobState(job_id=job_id)
    jobs[job_id] = job

    env = {
        **os.environ,
        "PYTHONUNBUFFERED": "1",
        "PYTHONDONTWRITEBYTECODE": "1",
        "NEXTJS_API_URL": os.environ.get("NEXTJS_API_URL", ""),
        "GEMINI_API_KEY": os.environ.get("GEMINI_API_KEY", ""),
        "SUPABASE_URL": os.environ.get("SUPABASE_URL", os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "")),
        "SUPABASE_SERVICE_ROLE_KEY": os.environ.get("SUPABASE_SERVICE_ROLE_KEY", ""),
    }

    proc = subprocess.Popen(
        args,
        cwd=str(PROJECT_ROOT),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        env=env,
    )
    job.pid = proc.pid

    thread = threading.Thread(target=_stream_output, args=(proc, job), daemon=True)
    thread.start()

    return {
        "success": True,
        "message": f"Scraping lancé pour {len(all_urls)} site(s)",
        "jobId": job_id,
        "pid": proc.pid,
        "timestamp": int(job.start_time * 1000),
        "urls": all_urls,
        "referenceUrl": body.referenceUrl,
    }


@app.get("/scraper/logs", dependencies=[Depends(verify_secret)])
async def scraper_logs(jobId: str, lastLine: int = 0):
    """Return log lines for a running/completed job."""
    job = jobs.get(jobId)
    if not job:
        return {
            "lines": [],
            "totalLines": 0,
            "isComplete": True,
            "hasError": True,
            "error": "Job not found",
        }

    all_lines = job.log_lines
    new_lines = all_lines[lastLine:]
    content = "\n".join(all_lines) if lastLine == 0 else None

    return {
        "lines": new_lines,
        "totalLines": len(all_lines),
        "isComplete": job.is_complete,
        "hasError": job.has_error,
        **({"content": content} if content is not None else {}),
    }


@app.post("/scraper-ai/run", dependencies=[Depends(verify_secret)])
async def scraper_ai_run(body: ScraperAIRunRequest):
    """Run the scraper synchronously for one or many URLs."""
    all_urls = [u for u in body.urls if u and u.strip()]
    if body.url and body.url.strip() and body.url not in all_urls:
        all_urls.append(body.url)
    if body.referenceUrl and body.referenceUrl not in all_urls:
        all_urls.insert(0, body.referenceUrl)
    if not all_urls:
        raise HTTPException(400, detail={"error": "URL is required"})

    args = [sys.executable, "-u", "-m", "scraper_ai.main"]
    args.extend(["--user-id", body.userId])
    if body.referenceUrl:
        args.extend(["--reference", body.referenceUrl])
    if body.forceRefresh:
        args.append("--force-refresh")
    if body.categories:
        args.extend(["--categories", ",".join(body.categories)])
    args.extend(all_urls)

    env = {
        **os.environ,
        "PYTHONUNBUFFERED": "1",
        "GEMINI_API_KEY": os.environ.get("GEMINI_API_KEY", ""),
        "NEXTJS_API_URL": os.environ.get("NEXTJS_API_URL", ""),
        "SUPABASE_URL": os.environ.get("SUPABASE_URL", os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "")),
        "SUPABASE_SERVICE_ROLE_KEY": os.environ.get("SUPABASE_SERVICE_ROLE_KEY", ""),
    }

    try:
        proc = subprocess.run(
            args,
            cwd=str(PROJECT_ROOT),
            capture_output=True,
            text=True,
            timeout=30 * 60,
            env=env,
        )

        if proc.returncode == 0:
            return {
                "success": True,
                "message": f"Scraping terminé pour {len(all_urls)} site(s)",
                "stdout": proc.stdout[-5000:] if proc.stdout else "",
            }
        else:
            raise HTTPException(500, detail={
                "error": "Scraping failed",
                "message": proc.stderr or proc.stdout or "Erreur inconnue",
                "code": proc.returncode,
                "stdout": (proc.stdout or "")[-2000:],
                "stderr": (proc.stderr or "")[-2000:],
            })
    except subprocess.TimeoutExpired:
        raise HTTPException(500, detail={
            "error": "Scraping timeout",
            "message": "Le scraping a pris trop de temps",
        })


@app.post("/scraper-ai/analyze", dependencies=[Depends(verify_secret)])
async def scraper_ai_analyze(body: AnalyzeRequest):
    """Analyze a site using the HTML analyzer."""
    import json as _json

    script = f"""
import sys, json
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
try:
    from scraper_ai.html_analyzer import HTMLAnalyzer
    import requests
except ImportError as e:
    print(json.dumps({{"success": False, "error": f"Import error: {{str(e)}}", "errorType": "ImportError"}}))
    sys.exit(1)

url = {body.url!r}
force_refresh = {body.forceRefresh!r}
user_id = {body.userId!r}

try:
    analyzer = HTMLAnalyzer(user_id=user_id)
    session = requests.Session()
    session.headers.update({{"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}})
    response = session.get(url, timeout=30)
    response.raise_for_status()
    result = analyzer.analyze_and_generate_scraper(url=url, html_content=response.text, force_refresh=force_refresh)
    print(json.dumps({{"success": True, "scraperData": result, "metadata": result.get("metadata", {{}})}}))
except Exception as e:
    import traceback
    print(json.dumps({{"success": False, "error": str(e), "errorType": type(e).__name__, "traceback": traceback.format_exc()}}))
    sys.exit(1)
"""

    env = {
        **os.environ,
        "PYTHONUNBUFFERED": "1",
        "GEMINI_API_KEY": os.environ.get("GEMINI_API_KEY", ""),
        "NEXTJS_API_URL": os.environ.get("NEXTJS_API_URL", ""),
        "SUPABASE_URL": os.environ.get("SUPABASE_URL", os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "")),
        "SUPABASE_SERVICE_ROLE_KEY": os.environ.get("SUPABASE_SERVICE_ROLE_KEY", ""),
    }

    try:
        proc = subprocess.run(
            [sys.executable, "-c", script],
            cwd=str(PROJECT_ROOT),
            capture_output=True,
            text=True,
            timeout=5 * 60,
            env=env,
        )

        if proc.returncode == 0:
            lines = proc.stdout.strip().split("\n")
            last_line = lines[-1] if lines else "{}"
            try:
                result = _json.loads(last_line)
                if result.get("success"):
                    return result
                raise HTTPException(500, detail={"error": result.get("error", "Unknown error")})
            except _json.JSONDecodeError:
                raise HTTPException(500, detail={
                    "error": "Failed to parse result",
                    "message": proc.stdout[-1000:] or proc.stderr[-1000:],
                })
        else:
            raise HTTPException(500, detail={
                "error": "Analysis failed",
                "message": proc.stderr or proc.stdout or "Erreur inconnue",
                "code": proc.returncode,
            })
    except subprocess.TimeoutExpired:
        raise HTTPException(500, detail={
            "error": "Analysis timeout",
            "message": "L'analyse a pris trop de temps",
        })


@app.get("/health")
async def health():
    active_jobs = sum(1 for j in jobs.values() if not j.is_complete)
    return {"status": "ok", "active_jobs": active_jobs, "total_jobs": len(jobs)}
