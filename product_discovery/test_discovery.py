"""
Test du système de découverte de produits.
Recherche : Ford F-150 2026 près de Trois-Rivières, QC

Sources: Kijiji, LesPAC, Facebook Marketplace, AutoTrader.ca
"""
from __future__ import annotations

import json
import os
import re
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from playwright.sync_api import sync_playwright, Page, Browser
from product_discovery.matching.normalizer import ProductNormalizer
from product_discovery.models.product import CanonicalProduct, Condition, ProductListing

normalizer = ProductNormalizer()

TARGET = {
    "make": "Ford",
    "model": "F-150",
    "year": 2026,
    "location": "Trois-Rivières, QC",
    "postal_code": "G9A",
    "radius_km": 150,
}

YEAR_MIN = 2025
YEAR_MAX = 2026


def extract_price_from_text(text: str) -> float | None:
    """Extraire un prix d'un texte quelconque."""
    patterns = [
        r"([\d\s]{2,3}[\s,.]?\d{3})\s*\$",     # 72 551 $ ou 72,551$
        r"\$\s*([\d,\s]+(?:\.\d{2})?)",          # $72,551.00
        r"([\d]{2,3}[\s,]\d{3})",                # 72 551 ou 72,551
    ]
    for pattern in patterns:
        match = re.search(pattern, text)
        if match:
            raw = match.group(1).replace(" ", "").replace(",", "")
            try:
                price = float(raw)
                if 10_000 < price < 250_000:
                    return price
            except ValueError:
                continue
    return normalizer.normalize_price(text)


def is_target_year(title: str) -> bool:
    """Vérifie si le titre contient une année 2025-2026."""
    year = normalizer.extract_year(title)
    return year is not None and YEAR_MIN <= year <= YEAR_MAX


# ─────────────────────────────────────────────────────────────────
# SOURCE 1: KIJIJI
# ─────────────────────────────────────────────────────────────────
def search_kijiji(page: Page) -> list[dict]:
    print("\n🔍 [1/4] Kijiji.ca...")
    results = []

    urls = [
        "https://www.kijiji.ca/b-autos-camions/trois-rivieres/2026-ford-f-150/k0c174l1700219?rb=true&carYearFrom=2026&carYearTo=2026",
        "https://www.kijiji.ca/b-autos-camions/ville-de-quebec/2026-ford-f-150/k0c174l1700124?rb=true&carYearFrom=2025&carYearTo=2026",
        "https://www.kijiji.ca/b-autos-camions/grand-montreal/2026-ford-f-150/k0c174l80002?rb=true&carYearFrom=2025&carYearTo=2026",
        "https://www.kijiji.ca/b-autos-camions/sherbrooke-qc/2026-ford-f-150/k0c174l1700188?rb=true&carYearFrom=2025&carYearTo=2026",
    ]

    seen_urls = set()

    for search_url in urls:
        try:
            page.goto(search_url, timeout=15000, wait_until="domcontentloaded")
            page.wait_for_timeout(2000)

            # Extraire les liens de listings
            links = page.eval_on_selector_all(
                "a[href*='/v-']",
                """els => els.map(el => ({
                    href: el.href,
                    text: el.textContent.trim()
                })).filter(l => l.href.includes('f-150') || l.href.includes('f150'))"""
            )

            for link in links:
                href = link["href"].split("?")[0]
                if href in seen_urls:
                    continue
                if not ("2026" in href or "2025" in href):
                    continue
                seen_urls.add(href)

                if len(results) >= 12:
                    break

        except Exception as e:
            print(f"  Kijiji search error: {e}")

    # Fetch detail pages
    for url in list(seen_urls)[:15]:
        if len(results) >= 12:
            break
        detail = _kijiji_detail(page, url)
        if detail and is_target_year(detail["title"]):
            results.append(detail)

    print(f"  Kijiji: {len(results)} résultats")
    return results


def _kijiji_detail(page: Page, url: str) -> dict | None:
    try:
        page.goto(url, timeout=12000, wait_until="domcontentloaded")
        page.wait_for_timeout(1500)

        title = page.text_content("h1") or ""
        title = title.strip()
        if not title:
            return None

        # Prix
        price = None
        for selector in ['[class*="price-"]', '[class*="Price"]', 'span[content]']:
            try:
                el = page.query_selector(selector)
                if el:
                    price_text = el.get_attribute("content") or el.text_content() or ""
                    price = extract_price_from_text(price_text)
                    if price and price > 10000:
                        break
                    price = None
            except Exception:
                continue

        if not price:
            body_text = page.text_content("body") or ""
            price_matches = re.findall(r"\$\s*([\d,]+)", body_text)
            for pm in price_matches:
                p = normalizer.normalize_price(pm)
                if p and 10_000 < p < 250_000:
                    price = p
                    break

        # Dealer
        dealer = "Kijiji"
        for sel in ['[class*="profile"]', '[class*="dealer"]', '[class*="seller"]']:
            try:
                el = page.query_selector(sel)
                if el:
                    name = el.text_content().strip()[:60]
                    if name and len(name) > 2:
                        dealer = name
                        break
            except Exception:
                continue

        # Location
        location = ""
        for sel in ['[class*="location"]', '[class*="address"]']:
            try:
                el = page.query_selector(sel)
                if el:
                    location = el.text_content().strip()[:50]
                    break
            except Exception:
                continue

        return {
            "title": title,
            "price": price,
            "dealer": dealer,
            "location": location,
            "source": "Kijiji.ca",
            "url": url,
        }
    except Exception:
        return None


# ─────────────────────────────────────────────────────────────────
# SOURCE 2: LESPAC
# ─────────────────────────────────────────────────────────────────
def search_lespac(page: Page) -> list[dict]:
    print("\n🔍 [2/4] LesPAC.com...")
    results = []

    urls = [
        "https://www.lespac.com/recherche?search=ford+f-150+2026&category=vehicules",
        "https://www.lespac.com/recherche?search=ford+f-150+2025+2026&category=vehicules",
        "https://www.lespac.com/recherche?search=ford+f150+2026",
    ]

    seen = set()

    for search_url in urls:
        try:
            page.goto(search_url, timeout=15000, wait_until="domcontentloaded")
            page.wait_for_timeout(2000)

            # Chercher les cartes de résultats
            cards = page.query_selector_all(
                '[class*="listing"], [class*="result"], [class*="card"], '
                '[class*="annonce"], article, .item'
            )

            for card in cards:
                try:
                    title_el = card.query_selector("h2, h3, h4, a[class*='title'], [class*='title']")
                    price_el = card.query_selector("[class*='price'], [class*='prix']")
                    link_el = card.query_selector("a[href]")

                    title = title_el.text_content().strip() if title_el else ""
                    if not title or not is_target_year(title):
                        continue
                    if "f-150" not in title.lower() and "f150" not in title.lower():
                        continue

                    href = link_el.get_attribute("href") if link_el else ""
                    if href and not href.startswith("http"):
                        href = "https://www.lespac.com" + href
                    if href in seen:
                        continue
                    seen.add(href)

                    price_text = price_el.text_content().strip() if price_el else ""
                    price = extract_price_from_text(price_text)

                    results.append({
                        "title": title,
                        "price": price,
                        "dealer": "LesPAC",
                        "location": "Québec",
                        "source": "LesPAC.com",
                        "url": href,
                    })
                except Exception:
                    continue

            # Aussi parser JSON-LD si dispo
            if not results:
                scripts = page.query_selector_all('script[type="application/ld+json"]')
                for script in scripts:
                    try:
                        data = json.loads(script.text_content())
                        items = data if isinstance(data, list) else [data]
                        for item in items:
                            name = item.get("name", "")
                            if is_target_year(name) and ("f-150" in name.lower() or "f150" in name.lower()):
                                p = item.get("offers", {}).get("price")
                                url = item.get("url", "")
                                if url not in seen:
                                    seen.add(url)
                                    results.append({
                                        "title": name,
                                        "price": normalizer.normalize_price(p),
                                        "dealer": "LesPAC",
                                        "location": "Québec",
                                        "source": "LesPAC.com",
                                        "url": url,
                                    })
                    except Exception:
                        continue

        except Exception as e:
            print(f"  LesPAC erreur: {e}")

    print(f"  LesPAC: {len(results)} résultats")
    return results


# ─────────────────────────────────────────────────────────────────
# SOURCE 3: FACEBOOK MARKETPLACE
# ─────────────────────────────────────────────────────────────────
def search_facebook_marketplace(page: Page) -> list[dict]:
    print("\n🔍 [3/4] Facebook Marketplace...")
    results = []

    # Facebook Marketplace — pas besoin de login pour voir les recherches
    search_url = (
        "https://www.facebook.com/marketplace/trois-rivieres/search?"
        "query=ford%20f-150%202026"
        "&exact=false"
    )

    try:
        page.goto(search_url, timeout=20000, wait_until="domcontentloaded")
        page.wait_for_timeout(3000)

        # Scroll pour charger plus de résultats
        for _ in range(3):
            page.mouse.wheel(0, 1000)
            page.wait_for_timeout(1500)

        # Facebook Marketplace utilise des liens avec /marketplace/item/
        links = page.eval_on_selector_all(
            "a[href*='/marketplace/item/']",
            """els => els.map(el => {
                const spans = el.querySelectorAll('span');
                let title = '', price = '';
                spans.forEach(s => {
                    const text = s.textContent.trim();
                    if (text.length > 15 && !text.startsWith('$')) title = text;
                    if (text.startsWith('$') || text.includes('$')) price = price || text;
                });
                return {
                    href: el.href,
                    title: title,
                    price: price
                };
            }).filter(l => l.title.length > 5)"""
        )

        seen = set()
        for link in links:
            title = link.get("title", "")
            href = link.get("href", "").split("?")[0]

            if href in seen:
                continue
            seen.add(href)

            if not is_target_year(title):
                if "f-150" not in title.lower() and "f150" not in title.lower():
                    continue

            price = extract_price_from_text(link.get("price", ""))

            results.append({
                "title": title if title else f"Ford F-150 2026 (FB #{len(results)+1})",
                "price": price,
                "dealer": "Facebook Marketplace",
                "location": "Trois-Rivières",
                "source": "Facebook Marketplace",
                "url": href,
            })

            if len(results) >= 10:
                break

        # Fallback: extraire du contenu de page directement
        if not results:
            all_text = page.content()
            # Chercher des patterns de prix dans le HTML
            items = re.findall(
                r'marketplace/item/(\d+).*?(\$[\d,]+).*?((?:Ford|ford).*?F.?150.*?(?:20\d{2}))',
                all_text, re.DOTALL | re.IGNORECASE
            )
            for item_id, price_text, title in items[:10]:
                results.append({
                    "title": title.strip()[:100],
                    "price": extract_price_from_text(price_text),
                    "dealer": "Facebook Marketplace",
                    "location": "Trois-Rivières",
                    "source": "Facebook Marketplace",
                    "url": f"https://www.facebook.com/marketplace/item/{item_id}",
                })

    except Exception as e:
        print(f"  Facebook Marketplace erreur: {e}")

    print(f"  Facebook Marketplace: {len(results)} résultats")
    return results


# ─────────────────────────────────────────────────────────────────
# SOURCE 4: AUTOTRADER.CA (via Playwright pour le JS)
# ─────────────────────────────────────────────────────────────────
def search_autotrader(page: Page) -> list[dict]:
    print("\n🔍 [4/4] AutoTrader.ca...")
    results = []

    search_url = (
        "https://www.autotrader.ca/cars/ford/f-150/qc/"
        "?rcp=15&rcs=0&srt=35"
        "&yRng=2025%2C2026"
        "&prx=150&prv=Quebec"
        "&loc=Trois-Rivi%C3%A8res%2C%20QC"
        "&hprc=True&wcp=True&iosp=True"
        "&sts=New-Used&inMarket=advancedSearch"
    )

    try:
        page.goto(search_url, timeout=20000, wait_until="networkidle")
        page.wait_for_timeout(3000)

        # AutoTrader utilise des result-items
        cards = page.query_selector_all(
            '[class*="result-item"], [id*="result"], '
            '[class*="listing-details"], [class*="vehicle-card"]'
        )

        if not cards:
            # Essayer de parser le JSON dans les scripts
            scripts = page.query_selector_all('script[type="application/ld+json"]')
            for script in scripts:
                try:
                    data = json.loads(script.text_content())
                    items = data if isinstance(data, list) else [data]
                    for item in items:
                        if item.get("@type") in ("Car", "Vehicle", "Product"):
                            title = item.get("name", "")
                            if is_target_year(title):
                                offers = item.get("offers", {})
                                results.append({
                                    "title": title,
                                    "price": normalizer.normalize_price(offers.get("price")),
                                    "dealer": offers.get("seller", {}).get("name", "AutoTrader"),
                                    "location": "",
                                    "source": "AutoTrader.ca",
                                    "url": item.get("url", ""),
                                })
                except Exception:
                    continue

        # Extraire via les selectors JavaScript (plus fiable pour SPA)
        if not cards and not results:
            listings_data = page.evaluate("""() => {
                const results = [];
                // Chercher les éléments de listing dans le DOM rendu
                document.querySelectorAll('[class*="result"], [class*="listing"], [class*="vehicle"], article').forEach(el => {
                    const titleEl = el.querySelector('h2, h3, [class*="title"], a[class*="name"]');
                    const priceEl = el.querySelector('[class*="price"], [class*="Price"]');
                    const linkEl = el.querySelector('a[href*="/a/"]') || el.querySelector('a[href*="autotrader"]');
                    const dealerEl = el.querySelector('[class*="dealer"], [class*="seller"]');

                    if (titleEl) {
                        results.push({
                            title: titleEl.textContent.trim(),
                            price: priceEl ? priceEl.textContent.trim() : '',
                            url: linkEl ? linkEl.href : '',
                            dealer: dealerEl ? dealerEl.textContent.trim() : 'AutoTrader.ca'
                        });
                    }
                });
                return results;
            }""")

            for item in (listings_data or []):
                title = item.get("title", "")
                if title and is_target_year(title):
                    results.append({
                        "title": title,
                        "price": extract_price_from_text(item.get("price", "")),
                        "dealer": item.get("dealer", "AutoTrader.ca"),
                        "location": "Québec",
                        "source": "AutoTrader.ca",
                        "url": item.get("url", ""),
                    })

        for card in cards:
            try:
                title_el = card.query_selector("h2 a, h3 a, [class*='title'] a, a[class*='name']")
                price_el = card.query_selector("[class*='price'], [class*='Price']")
                dealer_el = card.query_selector("[class*='dealer'], [class*='seller']")

                title = title_el.text_content().strip() if title_el else ""
                if not title or not is_target_year(title):
                    continue

                href = title_el.get_attribute("href") if title_el else ""
                if href and not href.startswith("http"):
                    href = "https://www.autotrader.ca" + href

                price = extract_price_from_text(price_el.text_content() if price_el else "")
                dealer = dealer_el.text_content().strip()[:60] if dealer_el else "AutoTrader.ca"

                results.append({
                    "title": title,
                    "price": price,
                    "dealer": dealer,
                    "location": "Québec",
                    "source": "AutoTrader.ca",
                    "url": href,
                })
            except Exception:
                continue

    except Exception as e:
        print(f"  AutoTrader erreur: {e}")

    print(f"  AutoTrader: {len(results)} résultats")
    return results


# ─────────────────────────────────────────────────────────────────
# PRODUCT GRAPH
# ─────────────────────────────────────────────────────────────────
def build_product_graph(
    all_results: list[dict],
) -> tuple[CanonicalProduct, list[ProductListing]]:
    canonical = CanonicalProduct(
        name="Ford F-150 2026",
        brand="Ford",
        model="F-150",
        year=2026,
        category="camion",
        subcategory="pickup pleine grandeur",
        confidence=1.0,
    )

    listings: list[ProductListing] = []
    prices: list[float] = []

    # Dédupliquer par URL
    seen_urls = set()

    for result in all_results:
        url = result.get("url", "")
        if url in seen_urls and url:
            continue
        seen_urls.add(url)

        price = result.get("price")
        if price and isinstance(price, (int, float)) and price > 10000:
            prices.append(price)

        listing = ProductListing(
            raw_title=result["title"],
            retailer_name=result.get("dealer", "Inconnu"),
            data_source_id="test-discovery",
            canonical_product_id=canonical.id,
            source_url=url,
            retailer_url=url,
            retailer_location=result.get("location", ""),
            raw_brand="Ford",
            raw_model="F-150",
            raw_year=normalizer.extract_year(result["title"]) or 2026,
            raw_category="camion",
            price=price if price and price > 10000 else None,
            condition=Condition.NEUF,
            match_method="brand_model_year",
            match_confidence=0.95,
        )
        listings.append(listing)

    if prices:
        canonical.avg_price = round(sum(prices) / len(prices), 2)
        canonical.min_price = min(prices)
        canonical.max_price = max(prices)

    canonical.listing_count = len(listings)
    return canonical, listings


def print_results(canonical: CanonicalProduct, listings: list[ProductListing]):
    print("\n" + "=" * 72)
    print("  PRODUCT GRAPH — RÉSULTAT DU TEST")
    print("=" * 72)

    print(f"\n📦 PRODUIT CANONIQUE")
    print(f"   Nom:       {canonical.name}")
    print(f"   Marque:    {canonical.brand}")
    print(f"   Modèle:    {canonical.model}")
    print(f"   Année:     {canonical.year}")
    print(f"   Catégorie: {canonical.category}")
    print(f"   Listings:  {canonical.listing_count}")
    if canonical.avg_price:
        print(f"   Prix moyen: {canonical.avg_price:>10,.0f} $")
        print(f"   Prix min:   {canonical.min_price:>10,.0f} $")
        print(f"   Prix max:   {canonical.max_price:>10,.0f} $")
    else:
        print(f"   Prix:      Aucun prix trouvé")

    # Grouper par source
    by_source: dict[str, list] = {}
    for l in listings:
        src = next(
            (r["source"] for r in [{"source": "?"}]
             if False),
            "Inconnu"
        )
    by_source = {}
    for listing in listings:
        # On va regrouper par le nom du retailer
        source_key = "Kijiji" if "kijiji" in (listing.source_url or "").lower() else \
                     "LesPAC" if "lespac" in (listing.source_url or "").lower() else \
                     "Facebook" if "facebook" in (listing.source_url or "").lower() else \
                     "AutoTrader" if "autotrader" in (listing.source_url or "").lower() else \
                     listing.retailer_name
        by_source.setdefault(source_key, []).append(listing)

    print(f"\n📊 RÉPARTITION PAR SOURCE")
    for source, items in by_source.items():
        prices_src = [l.price for l in items if l.price]
        avg = f"{sum(prices_src)/len(prices_src):,.0f} $" if prices_src else "N/D"
        print(f"   {source:25s} {len(items):3d} listings  |  prix moyen: {avg}")

    print(f"\n📋 TOUS LES LISTINGS ({len(listings)})")
    print("-" * 72)

    for i, listing in enumerate(listings, 1):
        price_str = f"{listing.price:>10,.0f} $" if listing.price else "       N/D"
        year = listing.raw_year or "????"
        source_tag = listing.retailer_name[:20]

        print(f"\n  {i:2d}. [{source_tag}] {listing.raw_title[:60]}")
        print(f"      💰 {price_str}   📍 {listing.retailer_location or 'N/D'}")
        if listing.source_url:
            print(f"      🔗 {listing.source_url[:75]}")

    print("\n" + "=" * 72)
    print(f"  📍 Localisation: {TARGET['location']}")
    print(f"  📏 Rayon: {TARGET['radius_km']} km")
    print("=" * 72)


# ─────────────────────────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────────────────────────
def main():
    print("=" * 72)
    print(f"  TEST — Découverte de produits multi-sources")
    print(f"  Recherche: {TARGET['make']} {TARGET['model']} {TARGET['year']}")
    print(f"  Localisation: {TARGET['location']} (rayon {TARGET['radius_km']} km)")
    print(f"  Sources: Kijiji, LesPAC, Facebook Marketplace, AutoTrader")
    print("=" * 72)

    start = time.time()
    all_results = []

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        context = browser.new_context(
            user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
            locale="fr-CA",
            viewport={"width": 1280, "height": 800},
        )
        page = context.new_page()

        # Lancer chaque source séquentiellement (même browser)
        all_results.extend(search_kijiji(page))
        all_results.extend(search_lespac(page))
        all_results.extend(search_facebook_marketplace(page))
        all_results.extend(search_autotrader(page))

        browser.close()

    elapsed = time.time() - start
    print(f"\n⏱️  Temps total: {elapsed:.1f}s")

    if not all_results:
        print("\n⚠️  Aucun résultat trouvé sur aucune source.")
        return

    canonical, listings = build_product_graph(all_results)
    print_results(canonical, listings)


if __name__ == "__main__":
    main()
