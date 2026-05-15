"""Test d'isolation de l'adapteur AutoTrader.

Usage :
    source venv/bin/activate
    AUTOTRADER_DEBUG_DUMP=1 python -u _test_autotrader.py "ford f250 2025"

Le flag AUTOTRADER_DEBUG_DUMP=1 fait dumper le HTML dans /tmp/at_debug_*.html
quand toutes les stratégies de parsing échouent.
"""
from __future__ import annotations

import os
import sys
import traceback

sys.path.insert(0, ".")

# Activer le dump debug par défaut quand on lance ce script
os.environ.setdefault("AUTOTRADER_DEBUG_DUMP", "1")

from scraper_ai.scraper_search.adapters.autotrader import AutoTraderAdapter  # noqa: E402
from scraper_ai.scraper_search.query_parser import parse_query  # noqa: E402


def main() -> int:
    raw = " ".join(sys.argv[1:]).strip() or "ford f250 2025"
    print(f"Query brute: {raw!r}", flush=True)

    q = parse_query(raw)
    q.min_score = 0.0
    print(
        f"Parsed: marque={q.marque!r} modele={q.modele!r} "
        f"annee={q.annee} annee_min={q.annee_min} annee_max={q.annee_max} "
        f"keywords={q.keywords}",
        flush=True,
    )

    adapter = AutoTraderAdapter()
    url = adapter._build_url(q, q.search_text(), page=1)
    print(f"URL: {url}", flush=True)

    try:
        from scraper_ai.scraper_usine.browser_agent import BrowserAgent

        print("Démarrage BrowserAgent (Playwright)...", flush=True)
        with BrowserAgent(block_assets=True, locale="fr-CA") as agent:
            print("BrowserAgent prêt, rendu de la SERP...", flush=True)
            result = agent.render(
                url,
                timeout_ms=adapter.default_timeout_ms,
                networkidle_ms=adapter.networkidle_ms,
                scroll=True,
                max_scrolls=adapter.max_scrolls,
                dismiss_cookies=True,
                post_load_wait_ms=adapter.post_load_wait_ms,
            )
            html = result.html or ""
            print(f"HTTP status: {result.status}", flush=True)
            print(f"HTML len:    {len(html)}", flush=True)
            print(f"Final URL:   {result.final_url}", flush=True)
            print(f"Error:       {result.error!r}", flush=True)

            if not html:
                print("ABORT — aucun HTML rendu.", flush=True)
                return 2

            with open("/tmp/autotrader.html", "w", encoding="utf-8") as f:
                f.write(html)
            print("HTML brut sauvé → /tmp/autotrader.html", flush=True)

            print("\n--- Parsing via AutoTraderAdapter ---", flush=True)
            products = adapter._parse_listing(html, base_url=url)
            print(f"\nProduits parsés : {len(products)}", flush=True)
            for i, p in enumerate(products[:5], 1):
                print(
                    f"  {i}. {p.get('name')!r} | {p.get('prix')!r} | "
                    f"{p.get('kilometrage')!r} km | {p.get('sourceUrl')}",
                    flush=True,
                )
            return 0 if products else 1
    except Exception:
        traceback.print_exc()
        return 3


if __name__ == "__main__":
    sys.exit(main())
