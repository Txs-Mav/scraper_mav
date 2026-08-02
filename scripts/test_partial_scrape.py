"""Test de régression : détection de scrape partiel dans scraper_cron.py.

Stubbe les dépendances lourdes (supabase, registre de scrapers, HTTP) puis
vérifie chaque scénario de la validation de complétude introduite pour
éliminer les faux « retirés/nouveaux » dans les alertes.

Usage : python3 scripts/test_partial_scrape.py
"""
import sys
import types
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent

# ── Stubs des dépendances avant l'import du module ──
supabase_stub = types.ModuleType("supabase")
supabase_stub.create_client = lambda *a, **k: None
sys.modules["supabase"] = supabase_stub

captured_rows = []
http_stub = types.ModuleType("_http_helpers")


class _FakeResp:
    status_code = 200
    text = ""


def _fake_post(url, json=None, **kwargs):
    captured_rows.append(json)
    return _FakeResp()


http_stub.post_with_retry = _fake_post
sys.modules["_http_helpers"] = http_stub

registry_mod = types.ModuleType("scraper_ai.dedicated_scrapers.registry")


class FakeScraper:
    """Renvoie `count` produits factices."""

    def __init__(self, count):
        self.count = count

    def scrape(self, **kwargs):
        return {
            "products": [{"name": f"p{i}", "prix": 1000 + i} for i in range(self.count)],
            "metadata": {},
        }


class DedicatedScraperRegistry:
    next_count = 0

    @classmethod
    def get_by_slug(cls, slug):
        return FakeScraper(cls.next_count)


registry_mod.DedicatedScraperRegistry = DedicatedScraperRegistry
sys.modules["scraper_ai"] = types.ModuleType("scraper_ai")
sys.modules["scraper_ai.dedicated_scrapers"] = types.ModuleType("scraper_ai.dedicated_scrapers")
sys.modules["scraper_ai.dedicated_scrapers.registry"] = registry_mod

sys.path.insert(0, str(SCRIPT_DIR))
import scraper_cron  # noqa: E402

FAILS = []


def check(label, cond, detail=""):
    status = "OK " if cond else "ÉCHEC"
    print(f"  [{status}] {label} {detail}")
    if not cond:
        FAILS.append(label)


print("── Scénarios _scrape_single_site ──")

# A. Scrape partiel (80/200, premier passage) → rejeté + flag partial
DedicatedScraperRegistry.next_count = 80
r = scraper_cron._scrape_single_site("slug", "https://x.com", "x.com", known_count=200, prev_status=None)
check("A: 80/200 premier passage → rejeté", r["success"] is False and r.get("partial") is True)

# B. Même baisse au 2e passage consécutif → acceptée comme nouvelle réalité
r = scraper_cron._scrape_single_site("slug", "https://x.com", "x.com", known_count=200, prev_status="partial")
check("B: 80/200 confirmé (2e passage) → accepté", r["success"] is True and len(r["products"]) == 80)

# C. Scrape à 75 % (150/200, au-dessus du seuil 60 %) → accepté
DedicatedScraperRegistry.next_count = 150
r = scraper_cron._scrape_single_site("slug", "https://x.com", "x.com", known_count=200, prev_status=None)
check("C: 150/200 (>60 %) → accepté", r["success"] is True)

# D. Petit site (8 connus < seuil de 10) → jamais bloqué
DedicatedScraperRegistry.next_count = 2
r = scraper_cron._scrape_single_site("slug", "https://x.com", "x.com", known_count=8, prev_status=None)
check("D: petit site 2/8 → accepté (exempté)", r["success"] is True)

# E. Nouveau site (0 connu) → accepté
DedicatedScraperRegistry.next_count = 40
r = scraper_cron._scrape_single_site("slug", "https://x.com", "x.com", known_count=0, prev_status=None)
check("E: nouveau site (0 connu) → accepté", r["success"] is True)

# F. 0 produit → échec dur (comportement historique conservé)
DedicatedScraperRegistry.next_count = 0
r = scraper_cron._scrape_single_site("slug", "https://x.com", "x.com", known_count=200, prev_status=None)
check("F: 0 produit → échec dur, pas partial", r["success"] is False and not r.get("partial"))

print("── Scénarios _save_site_data ──")
site = {"site_url": "https://x.com", "site_domain": "x.com", "id": "s1"}

captured_rows.clear()
scraper_cron._save_site_data("http://sb", "key", site, {"success": False, "partial": True, "error": "Scrape partiel: 80 vs 200"})
row = captured_rows[-1]
check("G: résultat partiel → status='partial'", row["status"] == "partial")
check("G2: partiel → products PAS écrasés", "products" not in row)

captured_rows.clear()
scraper_cron._save_site_data("http://sb", "key", site, {"success": False, "error": "boom"})
check("H: échec dur → status='error'", captured_rows[-1]["status"] == "error")

captured_rows.clear()
scraper_cron._save_site_data("http://sb", "key", site, {"success": True, "products": [{"name": "p"}], "metadata": {}, "elapsed": 3})
row = captured_rows[-1]
check("I: succès → status='success' + products écrits", row["status"] == "success" and row["product_count"] == 1)

print()
if FAILS:
    print(f"❌ {len(FAILS)} échec(s): {FAILS}")
    sys.exit(1)
print("✅ Tous les scénarios passent — la détection de scrape partiel fonctionne.")
