#!/usr/bin/env python3
"""
Diagnostic de GAP par scraper — pourquoi un scraper est incomplet.

Calcule le set-difference exact :
    manquant = (URLs produit du sitemap déclaré, filtrées comme le scraper) − (sourceUrl extraits)
puis classe les URLs manquantes par motif (neuf/usage, type de véhicule, catégorie)
pour transformer « −125 » en cause actionnable (« les usagés sont ignorés »,
« la catégorie motoneige manque », « seulement la page 1 »).

Lecture seule. Prolonge `completeness_audit.py` (Count Oracle) vers le composant 4
(boucle d'escalade) décrit dans `../scraper_ai/scraper_usine/PLAN_COMPLETUDE.md`.

Usage :
    python completeness_gap.py [slug ...]        # défaut : les incomplets connus
    python completeness_gap.py --all             # tous les non-marketplace
"""
import json, os, sys, re, gzip
import urllib.request
from urllib.parse import urlparse
from collections import Counter
from xml.etree import ElementTree as ET

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")
TIMEOUT = 15
DEFAULT_ENV = os.path.join(os.path.dirname(__file__), "..",
                           "dashboard_web", ".env.local")
DEFAULT_SLUGS = ["motoplex", "motoplex-mirabel", "motopro-granby",
                 "motos-illimitees", "picotte-motosport", "gregoire-sport",
                 "morin-sports", "motosport4saisons", "joliette-recreatif"]


def load_env():
    url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if url and key:
        return url, key
    env = {}
    with open(DEFAULT_ENV) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip().strip('"').strip("'")
    return env["NEXT_PUBLIC_SUPABASE_URL"], env["SUPABASE_SERVICE_ROLE_KEY"]


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


def norm_path(u):
    """Clé de comparaison : path minuscule sans slash final ni query (host-agnostique)."""
    try:
        p = urlparse(u)
    except Exception:
        return u
    path = (p.path or "").rstrip("/").lower()
    return path or u.lower()


def _strip_ns(tag):
    return tag.split("}")[-1] if "}" in tag else tag


def parse_locs(xml_text):
    try:
        root = ET.fromstring(xml_text.encode("utf-8", "replace"))
    except ET.ParseError:
        return False, []
    is_index = _strip_ns(root.tag) == "sitemapindex"
    return is_index, [el.text.strip() for el in root.iter()
                      if _strip_ns(el.tag) == "loc" and el.text]


PRODUCT_HINTS = ("/inventaire/", "/inventory/", "/vehicle", "/vehicule", "/neuf/",
                 "/usage/", "/occasion/", "/produit", "/product", "/moto/", "/vtt/",
                 "/detail", "-p-", "stock")


def sitemap_urls(scraper):
    """Ensemble d'URLs produit du sitemap, filtrées comme le scraper les prendrait."""
    sel = scraper.get("selectors") or {}
    disc = (sel.get("discovery") or {}) if isinstance(sel, dict) else {}
    site_url = scraper.get("site_url") or f"https://{scraper.get('site_domain', '')}"
    m = re.match(r"https?://[^/]+", site_url)
    base = m.group(0) if m else site_url.rstrip("/")

    cands = []
    if disc.get("sitemap_url"):
        cands.append(disc["sitemap_url"])
    for lu in (scraper.get("listing_urls") or []):
        if isinstance(lu, dict) and lu.get("type") == "sitemap" and lu.get("url"):
            cands.append(lu["url"])
    cands += [base + "/sitemap_index.xml", base + "/sitemap.xml"]
    seen = set()
    cands = [c for c in cands if not (c in seen or seen.add(c))]

    filter_path, filter_lang = disc.get("filter_path"), disc.get("filter_lang")
    neuf, occ = disc.get("neuf_pattern"), disc.get("occasion_pattern")
    declared = bool(disc.get("sitemap_url"))

    def keep(u):
        if filter_lang and filter_lang not in u:
            return False
        pats = [p for p in (filter_path, neuf, occ) if p]
        if pats:
            return any(p in u for p in pats)
        return any(h in u.lower() for h in PRODUCT_HINTS)

    for cand in cands:
        try:
            is_index, locs = parse_locs(http_get(cand))
        except Exception:
            continue
        if not locs:
            continue
        if is_index:
            kids = sorted(locs, key=lambda u: (0 if any(
                k in u.lower() for k in ("inventaire", "inventory", "vehicle",
                                         "vehicule", "detail", "product", "produit"))
                else 1))
            locs = []
            for ch in kids[:12]:
                try:
                    _, sub = parse_locs(http_get(ch))
                    locs += sub
                except Exception:
                    continue
        kept = [u for u in locs if keep(u)]
        if not kept and declared and cand == cands[0]:
            kept = locs
        if kept:
            return set(kept), cand
    return set(), None


def classify(urls):
    """Répartition des URLs manquantes par motif."""
    etat = Counter()
    vtype = Counter()
    for u in urls:
        low = u.lower()
        if "/usage/" in low or "/occasion/" in low or "/used/" in low:
            etat["usagé"] += 1
        elif "/neuf/" in low or "/new/" in low:
            etat["neuf"] += 1
        else:
            etat["?"] += 1
        # segment type de véhicule : après /neuf/ ou /usage/
        m = re.search(r"/(?:neuf|usage|occasion|new|used)/([a-z0-9\-]+)/", low)
        if m:
            vtype[m.group(1)] += 1
    return etat, vtype


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    url, key = load_env()
    if "--all" in sys.argv:
        rows = sb_get(url, key, "shared_scrapers?select=*")
        targets = [r for r in rows if not r["site_slug"].startswith("marketplace-")]
    else:
        slugs = args or DEFAULT_SLUGS
        rows = sb_get(url, key, "shared_scrapers?select=*&site_slug=in.("
                      + ",".join(slugs) + ")")
        targets = rows

    for sc in sorted(targets, key=lambda r: r["site_slug"]):
        slug = sc["site_slug"]
        sid = sc["id"]
        latest = sb_get(url, key, f"scraped_site_data?shared_scraper_id=eq.{sid}"
                        f"&select=products&order=scraped_at.desc&limit=1")
        products = latest[0]["products"] if latest and latest[0].get("products") else []
        extracted = {norm_path(p.get("sourceUrl", "")) for p in products if p.get("sourceUrl")}

        smap, src = sitemap_urls(sc)
        smap_norm = {norm_path(u): u for u in smap}

        missing_keys = set(smap_norm) - extracted
        extra = extracted - set(smap_norm)
        missing_urls = [smap_norm[k] for k in missing_keys]

        print(f"\n=== {slug} ===")
        print(f"  extrait={len(extracted)}  sitemap={len(smap_norm)}  "
              f"manquant={len(missing_urls)}  extra(hors-sitemap)={len(extra)}")
        if src:
            print(f"  source cible: {src}")
        if not smap_norm:
            print("  (pas de cible sitemap exploitable — cas SANS_CIBLE)")
            continue
        if missing_urls:
            etat, vtype = classify(missing_urls)
            print(f"  manquant par état : {dict(etat)}")
            if vtype:
                print(f"  manquant par type : {dict(vtype.most_common(8))}")
            print("  exemples manquants :")
            for u in sorted(missing_urls)[:5]:
                print(f"    - {u}")
        if extra:
            print(f"  ⚠ {len(extra)} URLs extraites ABSENTES du sitemap "
                  f"(sur-extraction / doublons / URLs mortes) — ex :")
            for k in list(extra)[:3]:
                print(f"    - {k}")


if __name__ == "__main__":
    main()
