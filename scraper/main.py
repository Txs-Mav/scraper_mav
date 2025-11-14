"""
Point d'entrée principal pour le scraper
"""
import sys
import json
import os

# Ajouter le répertoire scripts au path pour les imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from scraper.scraper import SupplierScraper


def main():
    if len(sys.argv) < 2:
        print("Usage: python -m scraper.main <url>")
        sys.exit(1)
    
    url = sys.argv[1]
    scraper = SupplierScraper(url)
    result = scraper.scrape()
    
    # Sauvegarder le résultat (dans le répertoire scripts/ pour compatibilité)
    from pathlib import Path
    output_file = Path(__file__).parent.parent / "scraped_data.json"
    # Fallback au répertoire racine si scripts/ n'existe pas
    if not output_file.parent.exists():
        output_file = Path(__file__).parent.parent.parent / "scraped_data.json"
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(result, f, indent=2, ensure_ascii=False)
    
    print(f"💾 Résultats sauvegardés dans: {output_file}")
    
    # Afficher un résumé
    print("\n📋 RÉSUMÉ:")
    print(f"Nom entreprise: {result['companyInfo'].get('name', 'N/A')}")
    print(f"Email: {result['companyInfo'].get('email', 'N/A')}")
    print(f"Téléphone: {result['companyInfo'].get('phone', 'N/A')}")
    print(f"Adresse: {result['companyInfo'].get('address', 'N/A')}")
    print(f"Logo: {result['companyInfo'].get('logo', 'N/A')}")
    print(f"Produits: {len(result['products'])}")
    
    if len(result['products']) == 0:
        print(f"\n⚠️ ATTENTION: Aucun produit trouvé!")
        print(f"   Cela peut indiquer:")
        print(f"   - Le site web ne contient pas de produits visibles")
        print(f"   - Les produits sont chargés via JavaScript (nécessite Selenium)")
        print(f"   - Le site web nécessite une authentification")
        print(f"   - Les produits sont dans un format non standard")
        print(f"   - Le scraper n'a pas exploré les bonnes pages")
    else:
        print(f"\n✅ Produits trouvés:")
        for i, product in enumerate(result['products'][:10], 1):
            print(f"   {i}. {product.get('name', 'N/A')} - {product.get('category', 'N/A')}")
        if len(result['products']) > 10:
            print(f"   ... et {len(result['products']) - 10} autres produits")


if __name__ == "__main__":
    main()

