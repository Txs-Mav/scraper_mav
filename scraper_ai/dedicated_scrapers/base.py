"""
Classe de base pour les scrapers dédiés.
Chaque scraper dédié hérite de DedicatedScraper et implémente ses propres
méthodes d'extraction avec des sélecteurs CSS hardcodés.
"""
import re
import time
from abc import ABC, abstractmethod
from typing import Dict, List, Optional, Any
from urllib.parse import urlparse, urljoin
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests
from bs4 import BeautifulSoup


class DedicatedScraper(ABC):
    """Classe abstraite pour les scrapers dédiés (sans Gemini)."""

    SITE_NAME: str = ""
    SITE_SLUG: str = ""
    SITE_URL: str = ""
    SITE_DOMAIN: str = ""

    MAX_WORKERS: int = 12
    HTTP_TIMEOUT: int = 20
    FUTURE_RESULT_TIMEOUT: int = 30
    MAX_RETRIES_PER_URL: int = 2

    def __init__(self):
        self.session = requests.Session()

        try:
            import brotli  # noqa: F401
            accept_enc = 'gzip, deflate, br'
        except ImportError:
            accept_enc = 'gzip, deflate'

        self.session.headers.update({
            'User-Agent': (
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
                'AppleWebKit/537.36 (KHTML, like Gecko) '
                'Chrome/131.0.0.0 Safari/537.36'
            ),
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
            'Accept-Language': 'fr-CA,fr;q=0.9,en-US;q=0.7,en;q=0.5',
            'Accept-Encoding': accept_enc,
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'none',
            'Sec-Fetch-User': '?1',
        })
        adapter = requests.adapters.HTTPAdapter(
            pool_connections=20,
            pool_maxsize=20,
            max_retries=requests.adapters.Retry(
                total=4, backoff_factor=1.0,
                status_forcelist=[429, 500, 502, 503, 504],
                allowed_methods=["GET", "HEAD"],
                respect_retry_after_header=True,
            )
        )
        self.session.mount('http://', adapter)
        self.session.mount('https://', adapter)

    @abstractmethod
    def discover_product_urls(self, categories: List[str] = None) -> List[str]:
        """Découvre toutes les URLs de produits du site."""

    @abstractmethod
    def extract_from_detail_page(self, url: str, html: str, soup: BeautifulSoup) -> Optional[Dict]:
        """Extrait un produit depuis une page de détail."""

    def scrape(self, categories: List[str] = None, inventory_only: bool = False) -> Dict[str, Any]:
        """Pipeline complet: découverte URLs → extraction parallèle → résultats."""
        start_time = time.time()

        print(f"\n{'='*70}")
        print(f"🔧 SCRAPER DÉDIÉ: {self.SITE_NAME}")
        print(f"{'='*70}")
        print(f"🌐 Site: {self.SITE_URL}")
        print(f"📦 Catégories: {categories or ['toutes']}")

        product_urls = self.discover_product_urls(categories)
        print(f"\n✅ {len(product_urls)} URLs de produits découvertes")

        if not product_urls:
            elapsed = time.time() - start_time
            return self._empty_result(elapsed)

        products = self._extract_all(product_urls)

        if inventory_only:
            products = [p for p in products if p.get('sourceCategorie') != 'catalogue']

        elapsed = time.time() - start_time

        print(f"\n{'='*70}")
        print(f"✅ {self.SITE_NAME}: {len(products)} produits en {elapsed:.1f}s")
        print(f"{'='*70}")

        return {
            'products': products,
            'metadata': {
                'site_url': self.SITE_URL,
                'site_name': self.SITE_NAME,
                'scraper_type': 'dedicated',
                'scraper_module': self.SITE_SLUG,
                'products_count': len(products),
                'urls_processed': len(product_urls),
                'execution_time_seconds': round(elapsed, 2),
                'categories': categories or ['inventaire', 'occasion'],
                'cache_status': 'dedicated',
            },
            'scraper_info': {
                'type': 'dedicated',
                'module': self.SITE_SLUG,
                'selectors': 'hardcoded',
            }
        }

    def _extract_all(self, urls: List[str]) -> List[Dict]:
        """Extraction parallèle de toutes les URLs avec retry et concurrence adaptative."""
        all_products = []
        total = len(urls)
        processed = 0
        workers = min(self.MAX_WORKERS, total)
        extract_start = time.time()
        failed_urls: List[str] = []
        timeout_count = 0

        batch_size = min(total, max(workers * 4, 50))

        per_url_timeout = max(self.HTTP_TIMEOUT + 15, self.FUTURE_RESULT_TIMEOUT)
        global_timeout = max(600, total * per_url_timeout // workers)

        print(f"\n📥 Extraction de {total} pages ({workers} workers, timeout HTTP {self.HTTP_TIMEOUT}s)...")

        remaining_urls = list(urls)

        while remaining_urls:
            batch = remaining_urls[:batch_size]
            remaining_urls = remaining_urls[batch_size:]
            batch_timeouts = 0
            batch_ok = 0

            with ThreadPoolExecutor(max_workers=workers) as executor:
                futures = {
                    executor.submit(self._fetch_and_extract, url): url
                    for url in batch
                }

                try:
                    for future in as_completed(futures, timeout=global_timeout):
                        processed += 1
                        url = futures[future]
                        try:
                            product = future.result(timeout=self.FUTURE_RESULT_TIMEOUT)
                            if product:
                                all_products.append(product)
                            batch_ok += 1
                        except Exception as e:
                            err_str = str(e).lower()
                            if 'timeout' in err_str or 'timed out' in err_str:
                                batch_timeouts += 1
                                timeout_count += 1
                            failed_urls.append(url)

                        if processed % 50 == 0 or processed == total:
                            elapsed = time.time() - extract_start
                            rate = processed / elapsed if elapsed > 0 else 0
                            print(f"   📊 [{processed}/{total}] {len(all_products)} produits — {rate:.1f} URLs/s")
                except TimeoutError:
                    pending = len(batch) - (batch_ok + batch_timeouts)
                    timeout_count += pending
                    timed_out_urls = [u for f, u in futures.items() if not f.done()]
                    failed_urls.extend(timed_out_urls)
                    print(
                        f"   ⚠️  Batch timeout — {pending} URL(s) abandonnée(s), "
                        f"{len(all_products)} produit(s) conservé(s)"
                    )
                    for future in futures:
                        future.cancel()

            batch_total = batch_ok + batch_timeouts
            if batch_total > 0 and batch_timeouts / batch_total > 0.25:
                old_w = workers
                workers = max(3, workers * 2 // 3)
                if workers != old_w:
                    print(f"   🔽 Throttling ({batch_timeouts} timeouts/{batch_total}) — {old_w}→{workers} workers")
                batch_size = max(workers * 3, 20)
                if remaining_urls:
                    time.sleep(1.0)
            elif batch_total >= 10 and batch_timeouts / batch_total < 0.05 and workers < self.MAX_WORKERS:
                old_w = workers
                workers = min(self.MAX_WORKERS, workers + 2)
                if workers != old_w:
                    print(f"   🔼 Serveur stable — {old_w}→{workers} workers")

        if failed_urls and self.MAX_RETRIES_PER_URL > 0:
            retry_round = 0
            urls_to_retry = list(failed_urls)
            failed_urls.clear()

            while urls_to_retry and retry_round < self.MAX_RETRIES_PER_URL:
                retry_round += 1
                retry_count = len(urls_to_retry)
                retry_workers = min(4, retry_count)
                backoff = 1.5 * retry_round
                print(f"   🔄 Retry #{retry_round}: {retry_count} URLs ({retry_workers} workers, pause {backoff:.1f}s)...")
                time.sleep(backoff)

                retry_successes = 0
                still_failed: List[str] = []

                with ThreadPoolExecutor(max_workers=retry_workers) as executor:
                    futures = {
                        executor.submit(self._fetch_and_extract, url): url
                        for url in urls_to_retry
                    }
                    try:
                        for future in as_completed(futures, timeout=max(180, retry_count * 8)):
                            url = futures[future]
                            try:
                                product = future.result(timeout=self.FUTURE_RESULT_TIMEOUT + 10)
                                if product:
                                    all_products.append(product)
                                    retry_successes += 1
                            except Exception:
                                still_failed.append(url)
                    except TimeoutError:
                        still_failed.extend(
                            u for f, u in futures.items() if not f.done()
                        )

                print(f"   {'✅' if retry_successes else 'ℹ️'}  Retry #{retry_round}: {retry_successes}/{retry_count} récupérées")
                urls_to_retry = still_failed

        elapsed = time.time() - extract_start
        unique = self._deduplicate(all_products)

        if timeout_count > 0:
            print(f"   ⚠️  {timeout_count} timeout(s) au total, {len(failed_urls)} URL(s) définitivement échouée(s)")
        print(f"   ✅ {len(unique)} produits uniques (dédupliqués de {len(all_products)}) en {elapsed:.1f}s")
        return unique

    def _fetch_and_extract(self, url: str) -> Optional[Dict]:
        """Fetch une URL et extrait le produit."""
        try:
            response = self.session.get(
                url, timeout=self.HTTP_TIMEOUT, allow_redirects=True)
            if response.status_code != 200:
                return None

            if response.history:
                original_path = urlparse(url).path.rstrip('/')
                final_path = urlparse(response.url).path.rstrip('/')
                if original_path != final_path:
                    orig_last = original_path.split('/')[-1] if original_path else ''
                    if orig_last and orig_last not in final_path:
                        return None

            html = response.text
            soup = BeautifulSoup(html, 'lxml')

            product = self.extract_from_detail_page(url, html, soup)
            if product:
                product['sourceUrl'] = url
                product['sourceSite'] = self.SITE_URL
                product['quantity'] = 1
                product['groupedUrls'] = [url]

            return product

        except requests.exceptions.Timeout:
            raise
        except Exception:
            return None

    def _deduplicate(self, products: List[Dict]) -> List[Dict]:
        """Déduplique par inventaire/stock ou par nom+prix."""
        seen = {}
        unique = []
        for p in products:
            stock = p.get('inventaire', '')
            if stock:
                key = stock.lower().strip()
            else:
                key = f"{p.get('name', '')}-{p.get('prix', 0)}".lower()

            if key not in seen:
                seen[key] = True
                unique.append(p)
        return unique

    def _empty_result(self, elapsed: float) -> Dict:
        return {
            'products': [],
            'metadata': {
                'site_url': self.SITE_URL,
                'site_name': self.SITE_NAME,
                'scraper_type': 'dedicated',
                'products_count': 0,
                'urls_processed': 0,
                'execution_time_seconds': round(elapsed, 2),
                'cache_status': 'dedicated',
            },
            'scraper_info': {'type': 'dedicated', 'module': self.SITE_SLUG}
        }

    @staticmethod
    def clean_price(text: str) -> Optional[float]:
        """Parse un prix depuis du texte."""
        if not text:
            return None
        cleaned = re.sub(r'[^\d.,]', '', text.strip())
        cleaned = cleaned.replace(',', '').replace(' ', '')
        if '.' in cleaned:
            parts = cleaned.split('.')
            if len(parts[-1]) > 2:
                cleaned = cleaned.replace('.', '')
        try:
            val = float(cleaned)
            return val if val > 0 else None
        except (ValueError, TypeError):
            return None

    @staticmethod
    def clean_mileage(text: str) -> Optional[int]:
        """Parse un kilométrage depuis du texte."""
        if not text:
            return None
        cleaned = re.sub(r'[^\d]', '', text.strip())
        try:
            val = int(cleaned)
            return val if val >= 0 else None
        except (ValueError, TypeError):
            return None

    @staticmethod
    def clean_year(text: str) -> Optional[int]:
        """Parse une année depuis du texte."""
        if not text:
            return None
        match = re.search(r'(19|20)\d{2}', text.strip())
        if match:
            return int(match.group(0))
        return None
