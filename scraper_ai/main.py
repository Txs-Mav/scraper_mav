"""
Point d'entrée principal pour le scraper AI
Scraping en parallèle avec comparaison des produits vs site de référence
"""
import argparse
import json
import time
import os
import subprocess
import platform
import sys
from pathlib import Path
from typing import List, Dict, Tuple
from concurrent.futures import ThreadPoolExecutor, as_completed

# Ajouter le répertoire parent au PYTHONPATH pour les imports
scraper_ai_path = Path(__file__).parent
parent_path = scraper_ai_path.parent
if str(parent_path) not in sys.path:
    sys.path.insert(0, str(parent_path))

try:
    from .scraper_executor import ScraperExecutor
    from .html_analyzer import HTMLAnalyzer
except ImportError:
    # Essayer avec le chemin absolu
    try:
        from scraper_ai.scraper_executor import ScraperExecutor
        from scraper_ai.html_analyzer import HTMLAnalyzer
    except ImportError:
        from scraper_executor import ScraperExecutor
        from html_analyzer import HTMLAnalyzer


def cleanup_nextjs_lock():
    """
    Nettoie le lock file Next.js pour éviter les erreurs lors du relancement.
    Supprime aussi les processus Next.js zombies si nécessaire.
    """
    # Chemin du lock file Next.js
    project_root = Path(__file__).parent.parent
    lock_file = project_root / "dashboard_web" / ".next" / "dev" / "lock"

    # Créer le répertoire parent si nécessaire avant de supprimer le lock
    lock_file.parent.mkdir(parents=True, exist_ok=True)

    # Supprimer le lock file s'il existe
    if lock_file.exists():
        try:
            lock_file.unlink()
            print(f"✅ Lock file Next.js supprimé: {lock_file}")
        except Exception as e:
            print(f"⚠️  Impossible de supprimer le lock file: {e}")

    # Vérifier et tuer les processus Next.js zombies
    try:
        system = platform.system()
        if system in ("Darwin", "Linux"):  # macOS et Linux
            # Méthode 1: Chercher par nom de processus
            try:
                result = subprocess.run(
                    ["pgrep", "-f", "next dev"],
                    capture_output=True,
                    text=True,
                    timeout=5
                )
                if result.returncode == 0 and result.stdout.strip():
                    pids = [pid.strip() for pid in result.stdout.strip().split(
                        '\n') if pid.strip()]
                    for pid in pids:
                        try:
                            subprocess.run(["kill", "-9", pid],
                                           check=False, timeout=2)
                            print(f"✅ Processus Next.js terminé (PID: {pid})")
                        except Exception:
                            pass
            except Exception:
                pass

            # Méthode 2: Chercher les processus utilisant les ports 3000, 3001, 3002, 3003
            for port in [3000, 3001, 3002, 3003]:
                try:
                    if system == "Darwin":
                        # Sur macOS, utiliser lsof
                        result = subprocess.run(
                            ["lsof", "-ti", f":{port}"],
                            capture_output=True,
                            text=True,
                            timeout=5
                        )
                    else:  # Linux
                        result = subprocess.run(
                            ["lsof", "-ti", f":{port}"],
                            capture_output=True,
                            text=True,
                            timeout=5
                        )

                    if result.returncode == 0 and result.stdout.strip():
                        pids = [pid.strip() for pid in result.stdout.strip().split(
                            '\n') if pid.strip()]
                        for pid in pids:
                            try:
                                # Vérifier que c'est bien un processus Node/Next.js
                                check_result = subprocess.run(
                                    ["ps", "-p", pid, "-o", "comm="],
                                    capture_output=True,
                                    text=True,
                                    timeout=2
                                )
                                if check_result.returncode == 0 and ("node" in check_result.stdout.lower() or "next" in check_result.stdout.lower()):
                                    subprocess.run(
                                        ["kill", "-9", pid], check=False, timeout=2)
                                    print(
                                        f"✅ Processus Next.js sur port {port} terminé (PID: {pid})")
                            except Exception:
                                pass
                except Exception:
                    # lsof peut ne pas être disponible, ignorer
                    pass

            # Attendre un peu pour que les processus se terminent
            time.sleep(0.5)

    except Exception as e:
        # Ignorer les erreurs de détection de processus
        pass

    # Vérifier à nouveau si le lock file existe et le supprimer une dernière fois
    if lock_file.exists():
        try:
            lock_file.unlink()
        except Exception:
            pass


def normalize_product_key(product: dict) -> Tuple[str, str, int]:
    """Crée une clé normalisée pour identifier les produits (marque + modèle + année)"""
    marque = str(product.get('marque', '')).lower().strip()
    modele = str(product.get('modele', '')).lower().strip()
    annee = product.get('annee', 0) or 0
    # Normaliser les variations
    marque = marque.replace('-', ' ').replace('_', ' ')
    modele = modele.replace('-', ' ').replace('_', ' ')
    return (marque, modele, annee)


def find_matching_products(reference_products: List[dict], comparison_products: List[dict],
                           reference_url: str, comparison_url: str) -> List[dict]:
    """
    Trouve les produits du concurrent qui existent aussi dans le site de référence.
    Compare les prix pour chaque correspondance trouvée.

    Retourne UNIQUEMENT les produits du concurrent qui ont une correspondance avec la référence.
    """
    print(f"\n{'='*60}")
    print(f"🔍 COMPARAISON AVEC LE SITE DE RÉFÉRENCE")
    print(f"{'='*60}")
    print(f"📊 Référence: {reference_url} ({len(reference_products)} produits)")
    print(
        f"📊 Concurrent: {comparison_url} ({len(comparison_products)} produits)")

    # Créer un index des produits de référence par clé normalisée
    reference_index: Dict[Tuple, List[dict]] = {}
    for ref_product in reference_products:
        key = normalize_product_key(ref_product)
        if key[0] and key[1]:  # Ignorer si marque ou modèle vide
            if key not in reference_index:
                reference_index[key] = []
            reference_index[key].append(ref_product)

    # Trouver les correspondances avec la référence
    matched_products = []

    for product in comparison_products:
        key = normalize_product_key(product)

        # Vérifier si ce produit existe dans le site de référence
        if key[0] and key[1] and key in reference_index:
            ref_matches = reference_index[key]

            # Trouver le meilleur match (prix le plus proche ou premier)
            current_price = float(product.get('prix', 0) or 0)
            best_match = None
            min_price_diff = float('inf')

            for ref_product in ref_matches:
                ref_price = float(ref_product.get('prix', 0) or 0)
                if ref_price > 0 and current_price > 0:
                    price_diff = abs(current_price - ref_price)
                    if price_diff < min_price_diff:
                        min_price_diff = price_diff
                        best_match = ref_product
                elif not best_match:
                    best_match = ref_product

            if best_match:
                ref_price = float(best_match.get('prix', 0) or 0)

                # Enrichir le produit avec les infos de comparaison
                product['prixReference'] = ref_price
                product['differencePrix'] = current_price - \
                    ref_price if current_price > 0 and ref_price > 0 else None
                product['siteReference'] = reference_url
                product['produitReference'] = {
                    'name': best_match.get('name'),
                    'sourceUrl': best_match.get('sourceUrl'),
                    'prix': ref_price
                }

                matched_products.append(product)

                if product['differencePrix'] is not None:
                    diff_str = f"+{product['differencePrix']:.0f}$" if product['differencePrix'] >= 0 else f"{product['differencePrix']:.0f}$"
                    print(
                        f"   ✅ {product.get('marque', '')} {product.get('modele', '')} {key[2] or ''}: {current_price:.0f}$ vs {ref_price:.0f}$ ({diff_str})")

    match_rate = (len(matched_products) / len(comparison_products)
                  * 100) if comparison_products else 0
    print(
        f"\n📈 Correspondances: {len(matched_products)}/{len(comparison_products)} ({match_rate:.0f}%)")
    print(f"{'='*60}\n")

    return matched_products


def scrape_site_wrapper(args: tuple) -> Tuple[str, dict]:
    """Wrapper pour le scraping en parallèle"""
    executor, url, force_refresh = args
    try:
        result = executor.scrape_site(url, force_refresh=force_refresh)
        return (url, result)
    except Exception as e:
        import traceback
        print(f"❌ Erreur lors du scraping de {url}: {e}")
        print(f"📋 Trace complète de l'erreur:")
        traceback.print_exc()
        return (url, {"companyInfo": {}, "products": []})


def main():
    # Nettoyer le lock file Next.js au démarrage pour éviter les erreurs
    cleanup_nextjs_lock()

    parser = argparse.ArgumentParser(
        description='Scraper AI - Scraping parallèle avec comparaison vs site de référence',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Exemples:
  # Extraire uniquement le site de référence (sans comparaison)
  python -m scraper_ai.main https://site-reference.com
  
  # Comparer des concurrents avec le site de référence
  python -m scraper_ai.main https://site-reference.com https://concurrent1.com https://concurrent2.com
  python -m scraper_ai.main --reference https://mvmmotosport.com/fr/ https://concurrent.com
  python -m scraper_ai.main --force-refresh https://site1.com https://site2.com
        """
    )
    parser.add_argument('urls', nargs='*',
                        help='URL(s) du/des site(s) à scraper')
    parser.add_argument('--reference', '-r', dest='reference_url',
                        help='URL du site de référence pour comparer les prix')
    parser.add_argument('--force-refresh', '-f', action='store_true',
                        help='Forcer la régénération des scrapers (ignorer le cache)')
    parser.add_argument('--invalidate-cache', '-i', action='store_true',
                        help='Invalider le cache pour les URLs spécifiées')

    args = parser.parse_args()

    urls = args.urls
    reference_url = args.reference_url
    force_refresh = args.force_refresh

    if not urls:
        parser.print_help()
        return

    # Mode invalidation de cache
    if args.invalidate_cache:
        analyzer = HTMLAnalyzer()
        for url in urls:
            analyzer.invalidate_cache(url)
        return

    # Déterminer le site de référence
    if not reference_url and len(urls) > 0:
        reference_url = urls[0]

    # S'assurer que le site de référence est dans la liste
    all_urls = list(set(urls))
    if reference_url and reference_url not in all_urls:
        all_urls.insert(0, reference_url)

    # Séparer référence et concurrents
    competitor_urls = [url for url in all_urls if url != reference_url]

    print(f"\n{'='*60}")
    print(f"🚀 SCRAPER AI - SCRAPING PARALLÈLE")
    print(f"{'='*60}")
    print(f"⭐ Site de référence: {reference_url}")
    print(f"📦 Concurrents à comparer: {len(competitor_urls)}")
    for i, url in enumerate(competitor_urls, 1):
        print(f"   {i}. {url}")

    # Estimation du temps
    analyzer = HTMLAnalyzer()
    all_sites = [reference_url] + \
        competitor_urls if reference_url else competitor_urls
    cached_count = sum(
        1 for url in all_sites if analyzer.get_scraper_for_site(url) is not None)
    new_count = len(all_sites) - cached_count
    estimated_time = (cached_count * 30 + new_count *
                      90) // max(len(all_sites), 1)

    print(f"\n⏱️  Estimation: ~{estimated_time}s")
    print(f"   ({cached_count} en cache, {new_count} nouveau(x))")
    print(f"{'='*60}\n")

    start_time = time.time()

    # Créer un executor par thread
    def create_executor():
        return ScraperExecutor()

    # Scraper tous les sites en parallèle
    print(f"🔄 Lancement du scraping parallèle...")
    results: Dict[str, dict] = {}

    with ThreadPoolExecutor(max_workers=min(len(all_sites), 4)) as pool:
        futures = {}
        for url in all_sites:
            executor = create_executor()
            future = pool.submit(scrape_site_wrapper,
                                 (executor, url, force_refresh))
            futures[future] = url

        for future in as_completed(futures):
            url = futures[future]
            try:
                result_url, result_data = future.result()
                results[result_url] = result_data
                product_count = len(result_data.get('products', []))
                is_ref = " ⭐" if url == reference_url else ""
                print(f"   ✅ {url}: {product_count} produits{is_ref}")
            except Exception as e:
                print(f"   ❌ {url}: Erreur - {e}")
                results[url] = {"companyInfo": {}, "products": []}

    elapsed_time = time.time() - start_time
    print(f"\n⏱️  Scraping terminé en {elapsed_time:.1f}s")

    # Récupérer les produits de référence
    reference_products = results.get(reference_url, {}).get('products', [])

    if not reference_products:
        print(f"\n{'='*60}")
        print(f"❌ PROBLÈME CRITIQUE: Aucun produit trouvé sur le site de référence!")
        print(f"{'='*60}")
        print(f"🌐 Site: {reference_url}")
        print(f"\n💡 Causes possibles:")
        print(f"   1. Le scraper généré ne fonctionne pas correctement")
        print(f"   2. Les sélecteurs CSS sont incorrects")
        print(f"   3. La pagination n'a pas été gérée")
        print(f"   4. Le site nécessite JavaScript (Selenium)")
        print(f"\n🔧 Solutions:")
        print(f"   - Vérifiez les logs ci-dessus pour voir les erreurs")
        print(f"   - Utilisez '--force-refresh' pour régénérer le scraper")
        print(f"   - Vérifiez manuellement si le site affiche des produits")
        print(f"{'='*60}\n")

    # Si seulement le site de référence est fourni, extraire ses produits directement
    # Sinon, comparer chaque concurrent avec la référence
    all_matched_products = []

    if not competitor_urls:
        # Pas de concurrents : extraire tous les produits du site de référence
        print(f"\n{'='*60}")
        print(f"📦 EXTRACTION DU SITE DE RÉFÉRENCE")
        print(f"{'='*60}")
        print(f"✅ {len(reference_products)} produits extraits du site de référence")
        all_matched_products = reference_products
    else:
        # Des concurrents sont fournis : comparer avec la référence
        # Seuls les produits qui ont une correspondance avec la référence sont gardés
        print(f"\n{'='*60}")
        print(f"🔍 COMPARAISON AVEC LES CONCURRENTS")
        print(f"{'='*60}")

        for url in competitor_urls:
            result = results.get(url, {})
            products = result.get('products', [])

            if products and reference_products:
                matched = find_matching_products(
                    reference_products=reference_products,
                    comparison_products=products,
                    reference_url=reference_url,
                    comparison_url=url
                )
                all_matched_products.extend(matched)

    # Sauvegarder les produits
    output_file = Path(__file__).parent.parent / "scraped_data.json"

    final_data = {
        "products": all_matched_products,
        "metadata": {
            "reference_url": reference_url,
            "reference_products_count": len(reference_products),
            "competitor_urls": competitor_urls,
            "total_matched_products": len(all_matched_products),
            "scraping_time_seconds": round(elapsed_time, 1),
            "mode": "reference_only" if not competitor_urls else "comparison"
        }
    }

    # Sauvegarder localement (fallback)
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(final_data, f, indent=2, ensure_ascii=False)

    # Essayer de sauvegarder dans Supabase via l'API (si disponible)
    try:
        import requests
        api_url = os.environ.get('NEXTJS_API_URL', 'http://localhost:3000')
        save_url = f"{api_url}/api/scrapings/save"
        
        response = requests.post(
            save_url,
            json={
                "reference_url": reference_url,
                "competitor_urls": competitor_urls,
                "products": all_matched_products,
                "metadata": final_data["metadata"],
                "scraping_time_seconds": round(elapsed_time, 1),
                "mode": "reference_only" if not competitor_urls else "comparison"
            },
            timeout=10
        )
        
        if response.status_code == 200:
            result = response.json()
            if result.get('success'):
                print(f"💾 Sauvegardé dans Supabase: {result.get('message', '')}")
            else:
                print(f"⚠️  Sauvegarde Supabase échouée: {result.get('error', 'Unknown error')}")
        elif response.status_code == 401:
            print(f"💾 Sauvegardé localement (utilisateur non connecté)")
        else:
            print(f"⚠️  Erreur API Supabase ({response.status_code}), sauvegarde locale uniquement")
    except Exception as e:
        # Si l'API n'est pas disponible, continuer avec la sauvegarde locale uniquement
        print(f"💾 Sauvegardé localement uniquement (API non disponible: {e})")

    # Résumé
    print(f"\n{'='*60}")
    print(f"✅ SCRAPING TERMINÉ!")
    print(f"{'='*60}")
    print(f"⭐ Site de référence: {reference_url}")
    print(f"📦 Produits de référence: {len(reference_products)}")
    if competitor_urls:
        print(f"🔍 Produits avec correspondance: {len(all_matched_products)}")
    else:
        print(f"📦 Produits extraits: {len(all_matched_products)}")
    print(f"⏱️  Temps total: {elapsed_time:.1f}s")
    print(f"💾 Sauvegardé: {output_file}")

    # Aperçu
    if all_matched_products:
        print(f"\n📋 APERÇU (10 premiers):")
        for idx, p in enumerate(all_matched_products[:10], start=1):
            nom = p.get('name') or f"{p.get('marque', '')} {p.get('modele', '')}".strip() or p.get('sourceUrl', '')
            prix = p.get('prix', 0) or 0
            diff = p.get('differencePrix')
            site = p.get('sourceSite', '')

            # Extraire le domaine du site
            try:
                from urllib.parse import urlparse
                domain = urlparse(site).netloc.replace('www.', '')[:20]
            except:
                domain = site[:20]

            if diff is not None:
                diff_str = f"+{diff:.0f}$" if diff >= 0 else f"{diff:.0f}$"
                print(
                    f"   {idx}. {nom[:30]} | {prix:.0f}$ ({diff_str}) | {domain}")
            else:
                print(f"   {idx}. {nom[:30]} | {prix:.0f}$ | {domain}")

        if len(all_matched_products) > 10:
            print(f"   ... et {len(all_matched_products) - 10} autres")
    else:
        print(f"\n⚠️  Aucune correspondance trouvée avec le site de référence.")


if __name__ == "__main__":
    main()
