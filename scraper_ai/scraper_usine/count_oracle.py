"""
Count Oracle — estime le VRAI nombre de produits N d'un site en **triangulant
plusieurs sources indépendantes, EN PARALLÈLE**.

C'est une MESURE, pas un sélecteur de chemin. Le résultat (`CountTarget`) sert :
  - de **seuil à la barrière** (validator : ne publie que si extrait/N ≥ seuil) ;
  - de **cible à la boucle d'escalade** (« 340/1200 → il manque une catégorie/la pagination ») ;
  - de **fixture de non-régression** (détection de drift dans le cron).

Sources sondées en parallèle (chacune indépendante, aveugle aux autres) :
  - `sitemap`       : nb d'URLs produit du sitemap (filtré comme le scraper les prendrait)
  - `results_text`  : « 1 240 résultats / véhicules / results » en tête de listing
  - `pagination`    : n° de dernière page × items par page

Réconciliation honnête : si les sources s'accordent → N confiant ; si elles se
contredisent → `disagreement=True` (à faire remonter, pas à trancher en silence).

Dépendances : requests + bs4 uniquement (thread-safe, pas de navigateur).
"""
from __future__ import annotations

import re
import statistics
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from typing import Dict, List, Optional
from urllib.parse import urlparse
from xml.etree import ElementTree as ET

import requests
from bs4 import BeautifulSoup

TIMEOUT = 15
_UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
       "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")
_PRODUCT_HINTS = ("/inventaire/", "/inventory/", "/vehicle", "/vehicule", "/neuf/",
                  "/usage/", "/occasion/", "/produit", "/product", "/moto/", "/vtt/",
                  "/detail", "-p-", "stock")
# « 1 240 résultats », « 1240 results », « 340 véhicules », « 87 annonces »
_RESULTS_RE = re.compile(
    r"([\d][\d\s .,]{0,8})\s*"
    r"(r[ée]sultats?|results?|v[ée]hicules?|vehicles?|annonces?|produits?|listings?|items?)",
    re.IGNORECASE)


@dataclass
class CountSignal:
    source: str          # 'sitemap' | 'results_text' | 'pagination'
    count: int
    confidence: float    # 0-1, fiabilité intrinsèque de la source
    detail: str = ""


@dataclass
class CountTarget:
    n: Optional[int]                       # meilleure estimation réconciliée
    confidence: float                      # 0-1
    signals: List[CountSignal] = field(default_factory=list)
    disagreement: bool = False             # les sources se contredisent
    reason: str = ""

    def coverage(self, extracted: int) -> Optional[float]:
        if not self.n:
            return None
        return extracted / self.n

    def as_dict(self) -> Dict:
        return {
            "n": self.n, "confidence": round(self.confidence, 2),
            "disagreement": self.disagreement, "reason": self.reason,
            "signals": [{"source": s.source, "count": s.count,
                         "confidence": s.confidence, "detail": s.detail}
                        for s in self.signals],
        }


def _session(sess: Optional[requests.Session]) -> requests.Session:
    if sess is not None:
        return sess
    s = requests.Session()
    s.headers.update({"User-Agent": _UA})
    return s


def _get(sess: requests.Session, url: str) -> Optional[requests.Response]:
    try:
        r = sess.get(url, timeout=TIMEOUT, allow_redirects=True)
        return r if r.status_code == 200 else None
    except Exception:
        return None


def _strip_ns(tag: str) -> str:
    return tag.split("}")[-1] if "}" in tag else tag


def _parse_locs(xml_text: str):
    try:
        root = ET.fromstring(xml_text.encode("utf-8", "replace"))
    except ET.ParseError:
        return False, []
    is_index = _strip_ns(root.tag) == "sitemapindex"
    return is_index, [el.text.strip() for el in root.iter()
                      if _strip_ns(el.tag) == "loc" and el.text]


def _parse_number(raw: str) -> Optional[int]:
    digits = re.sub(r"[^\d]", "", raw)
    return int(digits) if digits else None


# --------------------------------------------------------------------------
# Sondes (chacune renvoie un CountSignal ou None) — exécutées en parallèle
# --------------------------------------------------------------------------

def probe_sitemap(sess, base_url, sitemap_url=None, filters=None) -> Optional[CountSignal]:
    """Compte les URLs produit du sitemap, filtrées comme le scraper les prendrait."""
    filters = filters or {}
    m = re.match(r"https?://[^/]+", base_url)
    base = m.group(0) if m else base_url.rstrip("/")
    cands = [c for c in [sitemap_url, base + "/sitemap_index.xml",
                         base + "/sitemap.xml"] if c]

    flt_path, flt_lang = filters.get("filter_path"), filters.get("filter_lang")
    neuf, occ = filters.get("neuf_pattern"), filters.get("occasion_pattern")
    declared = bool(sitemap_url)

    def keep(u: str) -> bool:
        if flt_lang and flt_lang not in u:
            return False
        pats = [p for p in (flt_path, neuf, occ) if p]
        if pats:
            return any(p in u for p in pats)
        return any(h in u.lower() for h in _PRODUCT_HINTS)

    for cand in cands:
        r = _get(sess, cand)
        if not r:
            continue
        is_index, locs = _parse_locs(r.text)
        if not locs:
            continue
        if is_index:
            kids = sorted(locs, key=lambda u: (0 if any(
                k in u.lower() for k in ("inventaire", "inventory", "vehicle",
                                         "vehicule", "detail", "product", "produit"))
                else 1))
            locs = []
            for ch in kids[:15]:
                rr = _get(sess, ch)
                if rr:
                    _, sub = _parse_locs(rr.text)
                    locs += sub
        kept = [u for u in locs if keep(u)]
        if not kept and declared and cand == cands[0]:
            kept = locs
        if kept:
            conf = 0.85 if declared else 0.6
            return CountSignal("sitemap", len(set(kept)), conf, f"via {cand}")
    return None


def probe_results_text(sess, listing_urls) -> Optional[CountSignal]:
    """Cherche « X résultats/véhicules/results » sur les pages de listing."""
    best = None
    for url in (listing_urls or [])[:3]:
        r = _get(sess, url)
        if not r:
            continue
        soup = BeautifulSoup(r.text, "html.parser")
        text = soup.get_text(" ", strip=True)
        for m in _RESULTS_RE.finditer(text):
            n = _parse_number(m.group(1))
            if n and 3 <= n <= 100000:
                if best is None or n > best[0]:
                    best = (n, m.group(0).strip(), url)
    if best:
        return CountSignal("results_text", best[0], 0.7,
                           f"'{best[1]}' @ {best[2]}")
    return None


def probe_pagination(sess, listing_urls) -> Optional[CountSignal]:
    """Estime N via (dernière page) × (items sur la page 1). Best-effort, faible confiance."""
    for url in (listing_urls or [])[:2]:
        r = _get(sess, url)
        if not r:
            continue
        soup = BeautifulSoup(r.text, "html.parser")
        pages = []
        for a in soup.find_all("a", href=True):
            mp = re.search(r"[?&](?:page|p|pg)=(\d+)", a["href"])
            if mp:
                pages.append(int(mp.group(1)))
            elif a.get_text(strip=True).isdigit():
                pages.append(int(a.get_text(strip=True)))
        pages = [p for p in pages if 1 <= p <= 2000]
        if not pages:
            continue
        last = max(pages)
        if last < 2:
            continue
        # items par page ≈ nb de liens produit distincts sur la page 1
        prod_links = {a["href"] for a in soup.find_all("a", href=True)
                      if any(h in a["href"].lower() for h in _PRODUCT_HINTS)}
        per_page = len(prod_links)
        if per_page >= 4:
            return CountSignal("pagination", last * per_page, 0.4,
                               f"{last} pages × ~{per_page}/page @ {url}")
    return None


# --------------------------------------------------------------------------
# Orchestration parallèle + réconciliation
# --------------------------------------------------------------------------

def estimate_count(url: str, *, sitemap_url: Optional[str] = None,
                   listing_urls: Optional[List[str]] = None,
                   filters: Optional[dict] = None,
                   session: Optional[requests.Session] = None) -> CountTarget:
    """Lance toutes les sondes EN PARALLÈLE et réconcilie en un CountTarget."""
    sess = _session(session)
    base = f"{urlparse(url).scheme or 'https'}://{urlparse(url).netloc}"
    listing_urls = listing_urls or [url]

    probes = {
        "sitemap": lambda: probe_sitemap(sess, base, sitemap_url, filters),
        "results_text": lambda: probe_results_text(sess, listing_urls),
        "pagination": lambda: probe_pagination(sess, listing_urls),
    }
    signals: List[CountSignal] = []
    with ThreadPoolExecutor(max_workers=len(probes)) as ex:
        futs = {ex.submit(fn): name for name, fn in probes.items()}
        for fut in as_completed(futs):
            try:
                sig = fut.result()
            except Exception:
                sig = None
            if sig and sig.count > 0:
                signals.append(sig)

    return _reconcile(signals)


def _reconcile(signals: List[CountSignal]) -> CountTarget:
    if not signals:
        return CountTarget(n=None, confidence=0.0, signals=[],
                           reason="aucune source de comptage exploitable")
    credible = [s for s in signals if s.confidence >= 0.5] or signals
    counts = sorted(s.count for s in credible)
    n = int(statistics.median(counts))
    spread = counts[-1] / counts[0] if counts[0] else float("inf")
    disagreement = spread > 1.25
    if disagreement:
        confidence = 0.5
        reason = (f"sources en désaccord (spread ×{spread:.1f}) — "
                  f"à faire remonter avant de publier")
    else:
        confidence = 0.9 if len(credible) >= 2 else 0.7
        reason = f"{len(credible)} source(s) concordante(s)"
    return CountTarget(n=n, confidence=confidence, signals=signals,
                       disagreement=disagreement, reason=reason)


if __name__ == "__main__":
    import sys, json
    tgt = estimate_count(sys.argv[1] if len(sys.argv) > 1 else "https://www.motoplex.ca/fr/",
                         sitemap_url=sys.argv[2] if len(sys.argv) > 2 else None)
    print(json.dumps(tgt.as_dict(), indent=2, ensure_ascii=False))
