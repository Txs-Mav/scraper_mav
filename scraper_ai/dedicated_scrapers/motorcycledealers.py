"""
Scraper dédié pour MotorcycleDealers.ca (réseau MyDealers.ca).

Site agrégateur d'annonces moto au Canada. Structure :
  - Listings : /motorcycles-for-sale (paginé via ?page=N)
  - Détail   : /motorcycles-for-sale/<id>/<make-model-year-location>

Stratégie :
  1. discover_product_urls() parcourt quelques pages de listing pour
     collecter les URLs détaillées.
  2. extract_from_detail_page() lit chaque page produit.

Le site est derrière une protection (souvent Cloudflare). On utilise les
headers stealth de DedicatedScraper (UA réaliste + Accept-Language), et on
limite la pagination à un nombre raisonnable (~5 pages × 30 listings = 150
URLs max) pour rester sous 5 min de scrape par run.
"""
from __future__ import annotations

import re
from typing import Dict, List, Optional
from urllib.parse import urljoin

from bs4 import BeautifulSoup

from .base import DedicatedScraper

LISTING_URL_RE = re.compile(
    r"/motorcycles-for-sale/(\d+)/[a-z0-9\-]+", re.IGNORECASE
)
MAX_LISTING_PAGES = 5
PER_PAGE_TIMEOUT = 20


class MotorcycleDealersScraper(DedicatedScraper):
    """Scraper pour motorcycledealers.ca."""

    SITE_NAME = "MotorcycleDealers.ca"
    SITE_SLUG = "motorcycledealers-ca"
    SITE_URL = "https://www.motorcycledealers.ca"
    SITE_DOMAIN = "motorcycledealers.ca"

    MAX_WORKERS = 4
    HTTP_TIMEOUT = 25

    def discover_product_urls(self, categories: Optional[List[str]] = None) -> List[str]:
        """Récupère les URLs détaillées via les pages de listing paginées."""
        all_urls: List[str] = []
        seen: set[str] = set()

        for page in range(1, MAX_LISTING_PAGES + 1):
            page_url = (
                f"{self.SITE_URL}/motorcycles-for-sale"
                if page == 1
                else f"{self.SITE_URL}/motorcycles-for-sale?page={page}"
            )
            try:
                resp = self.session.get(page_url, timeout=PER_PAGE_TIMEOUT, allow_redirects=True)
                if resp.status_code != 200:
                    print(f"   ⚠️  Listing page {page}: HTTP {resp.status_code}")
                    continue
                page_urls = self._extract_listing_urls(resp.text)
                new_count = 0
                for u in page_urls:
                    if u not in seen:
                        seen.add(u)
                        all_urls.append(u)
                        new_count += 1
                if new_count == 0:
                    print(f"   ℹ️  Page {page}: 0 nouvelle URL, arrêt pagination")
                    break
                print(f"   ✅ Page {page}: +{new_count} URL(s)")
            except Exception as e:
                print(f"   ⚠️  Page {page} erreur: {type(e).__name__}: {e}")
                continue

        return all_urls

    def _extract_listing_urls(self, html: str) -> List[str]:
        """Extrait les URLs détaillées depuis le HTML d'une page de listing."""
        soup = BeautifulSoup(html, "lxml")
        urls: List[str] = []
        seen: set[str] = set()
        for anchor in soup.find_all("a", href=True):
            href = anchor.get("href", "")
            if not isinstance(href, str):
                continue
            if not LISTING_URL_RE.search(href):
                continue
            full = urljoin(self.SITE_URL, href.split("?")[0].split("#")[0])
            if full in seen:
                continue
            seen.add(full)
            urls.append(full)
        return urls

    def extract_from_detail_page(self, url: str, html: str, soup: BeautifulSoup) -> Optional[Dict]:
        """Extrait un produit depuis une page de détail."""
        title_el = soup.find(["h1", "h2"])
        title = title_el.get_text(strip=True) if title_el else ""
        if not title or len(title) < 3:
            return None

        # Prix : chercher dans le HTML un pattern $X (montants typiques 1 000 - 200 000$)
        prix = self._find_price(soup, html)

        # Année / marque / modèle : depuis l'URL ou le titre
        annee = self.clean_year(url) or self.clean_year(title)
        marque, modele = self._guess_brand_model(title)

        # Image principale (og:image en priorité)
        image = ""
        og_image = soup.find("meta", attrs={"property": "og:image"})
        if og_image and og_image.get("content"):
            image = og_image.get("content")
        if not image:
            img = soup.find("img")
            if img and img.get("src"):
                image = urljoin(self.SITE_URL, img.get("src"))

        # Kilométrage : pattern "X km" / "X,XXX km"
        kilo = None
        km_match = re.search(r"([\d,\s]+)\s*km\b", html, re.IGNORECASE)
        if km_match:
            kilo = self.clean_mileage(km_match.group(1))

        return {
            "name": title,
            "prix": prix,
            "annee": annee,
            "marque": marque,
            "modele": modele,
            "kilometrage": kilo,
            "image": image,
            "etat": "occasion",
            "sourceCategorie": "marketplace",
        }

    def _find_price(self, soup: BeautifulSoup, html: str) -> Optional[float]:
        """Détecte le prix en CAD dans une page produit."""
        # 1) Tag explicite ".price" / data-price
        for selector in [
            ".price",
            ".listing-price",
            "[data-price]",
            "[itemprop='price']",
        ]:
            el = soup.select_one(selector)
            if el:
                text = el.get_text(" ", strip=True) or el.get("content") or el.get("data-price") or ""
                price = self.clean_price(str(text))
                if price and price >= 100:
                    return price

        # 2) Regex sur le HTML brut : "$12,345" / "12 345 $"
        m = re.search(r"\$\s*([\d][\d,\.\s]{2,12})\b", html)
        if m:
            return self.clean_price(m.group(1))
        return None

    @staticmethod
    def _guess_brand_model(title: str) -> tuple[Optional[str], Optional[str]]:
        if not title:
            return None, None
        words = re.split(r"\s+", title.strip())
        if len(words) < 2:
            return words[0] if words else None, None
        return words[0], " ".join(words[1:3])
