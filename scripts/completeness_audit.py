#!/usr/bin/env python3
"""
Audit LECTURE SEULE de complétude des scrapers en prod — Oracle de comptage v0 (sitemap).

Pour chaque scraper de `shared_scrapers` :
  - extrait    = product_count du dernier `scraped_site_data`
  - cible      = nb d'URLs produit du sitemap que le scraper DÉCLARE utiliser
                 (`selectors.discovery.sitemap_url`), sinon sitemap probé
  - couverture = extrait / cible

Aucune écriture (GET Supabase via clé service + GET sitemaps publics).

Usage :
    python completeness_audit.py [chemin/vers/.env.local]
    # ou en fournissant SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY dans l'environnement

Ce script est le point de départ (v0) du "Count Oracle" décrit dans
`../scraper_usine/PLAN_COMPLETUDE.md`. Il ne trianguler que le sitemap ; la v1
ajoutera le texte « X résultats », le champ `total` des APIs et la pagination.
"""
import json, os, sys, re, gzip
import urllib.request
from datetime import datetime, timezone
from xml.etree import ElementTree as ET

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")
TIMEOUT = 12
STALE_DAYS = 3
DEFAULT_ENV = os.path.join(os.path.dirname(__file__), "..",
                           "dashboard_web", ".env.local")


def load_env(argv):
    """Priorité à l'environnement, sinon parse un .env.local."""
    url = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if url and key:
        return url, key
    path = argv[1] if len(argv) > 1 else DEFAULT_ENV
    env = {}
    with open(path) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip().strip('"').strip("'")
    return (env["NEXT_PUBLIC_SUPABASE_URL"], env["SUPABASE_SERVICE_ROLE_KEY"])


def http_get(url, headers=None):
    req = urllib.request.Request(url, headers=headers or {"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
        data = r.read()
    if data[:2] == b"\x1f\x8b":
        data = gzip.decompress(data)
    return data.decode("utf-8", "replace")


def sb_get(url, key, path):
    return json.loads(http_get(f"{url}/rest/v1/{path}",
                               {"User-Agent": UA, "apikey": key,
                                "Authorization": f"Bearer {key}"}))


def _strip_ns(tag):
    return tag.split("}")[-1] if "}" in tag else tag


def parse_locs(xml_text):
    try:
        root = ET.fromstring(xml_text.encode("utf-8", "replace"))
    except ET.ParseError:
        return False, []
    is_index = _strip_ns(root.tag) == "sitemapindex"
    locs = [el.text.strip() for el in root.iter()
            if _strip_ns(el.tag) == "loc" and el.text]
    return is_index, locs


PRODUCT_HINTS = ("/inventaire/", "/inventory/", "/vehicle", "/vehicule", "/neuf/",
                 "/usage/", "/occasion/", "/produit", "/product", "/moto/", "/vtt/",
                 "/detail", "-p-", "stock")


def count_target(scraper):
    """(count, source_url, method) ou (None, reason, '')."""
    sel = scraper.get("selectors") or {}
    disc = (sel.get("discovery") or {}) if isinstance(sel, dict) else {}
    site_url = scraper.get("site_url") or f"https://{scraper.get('site_domain', '')}"
    m = re.match(r"https?://[^/]+", site_url)
    base = m.group(0) if m else site_url.rstrip("/")

    candidates = []
    if disc.get("sitemap_url"):
        candidates.append(disc["sitemap_url"])
    for lu in (scraper.get("listing_urls") or []):
        if isinstance(lu, dict) and lu.get("type") == "sitemap" and lu.get("url"):
            candidates.append(lu["url"])
    candidates += [base + "/sitemap_index.xml", base + "/sitemap.xml"]
    seen = set()
    candidates = [c for c in candidates if not (c in seen or seen.add(c))]

    filter_path = disc.get("filter_path")
    neuf, occ = disc.get("neuf_pattern"), disc.get("occasion_pattern")
    declared = bool(disc.get("sitemap_url") or any(
        isinstance(lu, dict) and lu.get("type") == "sitemap"
        for lu in (scraper.get("listing_urls") or [])))

    def is_product(u):
        pats = [p for p in (filter_path, neuf, occ) if p]
        if pats:
            return any(p in u for p in pats)
        return any(h in u.lower() for h in PRODUCT_HINTS)

    for cand in candidates:
        try:
            xml = http_get(cand)
        except Exception:
            continue
        is_index, locs = parse_locs(xml)
        if not locs:
            continue
        if is_index:
            children = sorted(locs, key=lambda u: (0 if any(
                k in u.lower() for k in ("inventaire", "inventory", "vehicle",
                                         "vehicule", "detail", "product", "produit"))
                else 1))
            all_locs = []
            for ch in children[:12]:
                try:
                    _, sub = parse_locs(http_get(ch))
                    all_locs += sub
                except Exception:
                    continue
            locs = all_locs
        prod = [u for u in locs if is_product(u)]
        if not prod and declared and cand == candidates[0]:
            prod = locs  # sitemap déclaré : on lui fait confiance
        if prod:
            method = "declared" if declared and cand in candidates[:2] else "probed"
            return len(set(prod)), cand, method
    return None, "aucun sitemap exploitable", ""


def main():
    url, key = load_env(sys.argv)
    scrapers = sb_get(url, key, "shared_scrapers?select=*&order=site_slug")
    now = datetime.now(timezone.utc)
    print(f"# Audit complétude — {len(scrapers)} scrapers approuvés\n")

    rows = []
    summary = {"OK": 0, "INCOMPLET": 0, "VIDE": 0, "SANS_CIBLE": 0,
               "MARKETPLACE": 0, "STALE": 0}
    header = f"{'slug':26}{'extrait':>8}{'cible':>8}{'couv.':>7}  {'âge':>5}  verdict"
    print(header)
    print("-" * len(header))

    for sc in scrapers:
        slug = sc.get("site_slug", "?")
        sid = sc.get("id")
        extracted = scraped_at = run_status = None
        try:
            latest = sb_get(url, key,
                            f"scraped_site_data?shared_scraper_id=eq.{sid}"
                            f"&select=product_count,scraped_at,status"
                            f"&order=scraped_at.desc&limit=1")
            if latest:
                extracted = latest[0].get("product_count")
                scraped_at = latest[0].get("scraped_at")
                run_status = latest[0].get("status")
        except Exception as e:
            run_status = f"err:{type(e).__name__}"

        age_days = ""
        if scraped_at:
            try:
                dt = datetime.fromisoformat(scraped_at.replace("Z", "+00:00"))
                age = (now - dt).days
                age_days = f"{age}j"
                if age > STALE_DAYS:
                    summary["STALE"] += 1
            except Exception:
                pass

        if slug.startswith("marketplace-"):
            summary["MARKETPLACE"] += 1
            tgt, verdict, cov = None, "MARKETPLACE (cible sitemap n/a)", ""
        else:
            tgt, src, method = count_target(sc)
            if extracted in (None, 0):
                summary["VIDE"] += 1
                verdict, cov = f"VIDE (0 produit, status={run_status})", ""
            elif tgt is None:
                summary["SANS_CIBLE"] += 1
                verdict, cov = f"SANS_CIBLE ({src})", ""
            else:
                ratio = extracted / tgt if tgt else 0
                cov = f"{ratio:5.0%}"
                if ratio >= 0.90:
                    summary["OK"] += 1
                    verdict = f"OK [{method}]"
                else:
                    summary["INCOMPLET"] += 1
                    verdict = (f"INCOMPLET — manque {tgt - extracted} "
                               f"({100 - ratio * 100:.0f}%) [{method}] {src}")

        ex = "-" if extracted is None else str(extracted)
        tg = "-" if tgt is None else str(tgt)
        print(f"{slug:26}{ex:>8}{tg:>8}{cov:>7}  {age_days:>5}  {verdict}")
        rows.append({"slug": slug, "extracted": extracted, "target": tgt,
                     "coverage": (extracted / tgt) if (tgt and extracted) else None,
                     "verdict": verdict.split(" ")[0], "scraped_at": scraped_at})

    print("\n## Résumé")
    for k, v in summary.items():
        print(f"  {k:12} {v}")
    print("\n<<<JSON>>>")
    print(json.dumps({"summary": summary, "rows": rows}, ensure_ascii=False))


if __name__ == "__main__":
    main()
