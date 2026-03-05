"""
Point d'entrée principal pour le scraper AI
Scraping intelligent avec cache Supabase et sélecteurs dynamiques
"""
import argparse
import json
import time
import os
import sys
import io
from pathlib import Path
from typing import List, Dict, Tuple
from concurrent.futures import ThreadPoolExecutor, as_completed

# Forcer le flush immédiat de stdout/stderr (important quand redirigé vers un fichier)
if hasattr(sys.stdout, 'buffer'):
    sys.stdout = io.TextIOWrapper(
        sys.stdout.buffer, line_buffering=True, encoding='utf-8')
if hasattr(sys.stderr, 'buffer'):
    sys.stderr = io.TextIOWrapper(
        sys.stderr.buffer, line_buffering=True, encoding='utf-8')

# Ajouter le répertoire parent au PYTHONPATH pour les imports
scraper_ai_path = Path(__file__).parent
parent_path = scraper_ai_path.parent
if str(parent_path) not in sys.path:
    sys.path.insert(0, str(parent_path))

try:
    from .intelligent_scraper import IntelligentScraper, scrape_site
    from .supabase_storage import SupabaseStorage, set_global_user
    from .config import PROMPT_VERSION
except ImportError:
    try:
        from scraper_ai.intelligent_scraper import IntelligentScraper, scrape_site
        from scraper_ai.supabase_storage import SupabaseStorage, set_global_user
        from scraper_ai.config import PROMPT_VERSION
    except ImportError:
        from intelligent_scraper import IntelligentScraper, scrape_site
        from supabase_storage import SupabaseStorage, set_global_user
        from config import PROMPT_VERSION


# Liste des couleurs communes à ignorer pour le matching
COLOR_KEYWORDS = [
    # Français — couleurs de base
    'blanc', 'noir', 'rouge', 'bleu', 'vert', 'jaune', 'orange', 'rose', 'violet',
    'gris', 'argent', 'or', 'bronze', 'beige', 'marron', 'brun', 'turquoise',
    'kaki', 'sable', 'ivoire', 'creme', 'crème',
    # Français — finitions et textures
    'brillant', 'mat', 'métallisé', 'metallisé', 'métallique', 'metallique',
    'perle', 'nacré', 'nacre', 'satin', 'chrome', 'carbone',
    'foncé', 'fonce', 'clair', 'fluo', 'neon', 'néon',
    # Français — couleurs spécifiques véhicules (fréquentes dans les catalogues moto)
    'ebene', 'ébène', 'graphite', 'anthracite', 'platine', 'titane',
    'cuivre', 'acier', 'cobalt', 'corail', 'ardoise', 'étain',
    'nebuleux', 'nébuleux', 'nebuleuse', 'nébuleuse',
    'bonbon', 'diablo', 'champagne', 'phantom', 'fantome', 'fantôme',
    'combat', 'lime', 'sauge', 'cristal', 'obsidian', 'highland',
    'etincelle', 'étincelle', 'velocite', 'vélocité',
    # Anglais
    'white', 'black', 'red', 'blue', 'green', 'yellow', 'orange', 'pink', 'purple',
    'gray', 'grey', 'silver', 'gold', 'bronze', 'beige', 'brown', 'turquoise',
    'matte', 'glossy', 'metallic', 'pearl', 'satin', 'carbon',
    'dark', 'light', 'neon', 'bright',
    'ivory', 'charcoal', 'titanium', 'copper', 'steel', 'platinum', 'graphite',
    'racing', 'candy', 'phantom', 'midnight', 'arctic', 'cosmic', 'storm',
    # Descripteurs de couleur (souvent dans les noms de véhicules)
    'nouveau', 'nouvelle', 'special', 'édition',
]


def _strip_accents(text: str) -> str:
    """Retire les accents d'une chaîne (é→e, è→e, etc.)"""
    import unicodedata
    nfkd = unicodedata.normalize('NFKD', text)
    return ''.join(c for c in nfkd if not unicodedata.category(c).startswith('M'))


def _deep_normalize(text: str) -> str:
    """Normalisation profonde : minuscules, sans accents, sans ponctuation, espaces unifiés.
    Insère un espace entre lettres et chiffres collés (ninja500 → ninja 500).
    Fusionne les lettres simples consécutives en un seul token (r l → rl, s x f → sxf)
    pour que "KLX110R L" et "KLX110RL" produisent le même résultat.
    """
    import re
    if not text:
        return ''
    text = text.lower().strip()
    text = _strip_accents(text)
    # Insérer un espace entre lettres et chiffres collés: "ninja500" → "ninja 500"
    text = re.sub(r'([a-z])(\d)', r'\1 \2', text)
    text = re.sub(r'(\d)([a-z])', r'\1 \2', text)
    # Retirer tout sauf lettres, chiffres, espaces
    text = re.sub(r'[^a-z0-9\s]', ' ', text)
    # Unifier les espaces multiples
    text = re.sub(r'\s+', ' ', text).strip()

    # Fusionner les lettres simples consécutives: "r l" → "rl", "s x f" → "sxf"
    # Cela uniformise "KLX110R L" (→ klx 110 r l → klx 110 rl)
    # et "KLX110RL" (→ klx 110 rl) vers le même résultat.
    words = text.split()
    merged: list = []
    i = 0
    while i < len(words):
        if len(words[i]) == 1 and words[i].isalpha():
            # Début d'une séquence potentielle de lettres simples
            letters = [words[i]]
            j = i + 1
            while j < len(words) and len(words[j]) == 1 and words[j].isalpha():
                letters.append(words[j])
                j += 1
            if len(letters) > 1:
                merged.append(''.join(letters))
            else:
                merged.append(words[i])
            i = j
        else:
            merged.append(words[i])
            i += 1
    text = ' '.join(merged)

    return text


def remove_colors_from_string(text: str) -> str:
    """Retire les mots de couleur d'une chaîne de caractères.
    Compare des mots entiers (pas de substring) pour éviter les faux positifs.
    """
    if not text:
        return ''

    normalized = _deep_normalize(text)
    words = normalized.split()
    filtered_words = []

    # Normaliser les mots-couleur une seule fois
    normalized_colors = set(_deep_normalize(c) for c in COLOR_KEYWORDS if c)

    for word in words:
        if word not in normalized_colors:
            filtered_words.append(word)

    return ' '.join(filtered_words)


# Liste des marques connues pour identification (triée par longueur décroissante)
KNOWN_BRANDS = sorted([
    # Powersports / Moto
    'kawasaki', 'honda', 'yamaha', 'suzuki', 'ktm', 'husqvarna',
    'triumph', 'cfmoto', 'cf moto', 'aprilia', 'vespa', 'piaggio', 'ducati',
    'bmw', 'harley-davidson', 'harley davidson', 'indian', 'royal enfield',
    'can-am', 'can am', 'polaris', 'arctic cat', 'sea-doo', 'sea doo',
    'ski-doo', 'ski doo', 'brp', 'segway', 'kymco', 'adly', 'beta',
    'cub cadet', 'john deere', 'gas gas', 'gasgas', 'sherco', 'benelli',
    'mv agusta', 'moto guzzi', 'zero', 'energica', 'sur-ron', 'surron',
    # Auto
    'ford', 'toyota', 'chevrolet', 'gmc', 'ram', 'jeep', 'dodge', 'chrysler',
    'nissan', 'hyundai', 'kia', 'subaru', 'mazda', 'volkswagen', 'audi',
    'mercedes-benz', 'mercedes benz', 'lexus', 'acura', 'infiniti',
    'lincoln', 'buick', 'cadillac', 'tesla', 'mitsubishi', 'volvo',
    'land rover', 'jaguar', 'porsche', 'mini', 'fiat', 'alfa romeo',
    'genesis', 'rivian', 'lucid', 'polestar',
], key=len, reverse=True)

# Normaliser les marques pour le matching
_NORMALIZED_BRANDS = [(_deep_normalize(b), b) for b in KNOWN_BRANDS]

# Mapping pour unifier les variantes de marques
_BRAND_ALIASES = {
    'cf moto': 'cfmoto',
    'harley davidson': 'harley davidson',
    'harley-davidson': 'harley davidson',
    'can am': 'can am',
    'can-am': 'can am',
    'sea doo': 'sea doo',
    'sea-doo': 'sea doo',
    'ski doo': 'ski doo',
    'ski-doo': 'ski doo',
    'gas gas': 'gasgas',
    'sur-ron': 'surron',
    'sur ron': 'surron',
    'mercedes benz': 'mercedes benz',
    'land rover': 'land rover',
    'alfa romeo': 'alfa romeo',
}


def extract_year_from_text(text: str) -> int:
    """Extrait une année (19xx/20xx) depuis un texte quelconque."""
    import re
    if not text:
        return 0
    match = re.search(r'\b(19|20)\d{2}\b', text)
    if match:
        year = int(match.group(0))
        if 1900 <= year <= 2100:
            return year
    return 0


def extract_year_from_url(url: str) -> int:
    """Extrait une année depuis une URL de produit.

    Gère les patterns courants :
      - /kawasaki-ninja-500-se-2025-a-vendre-k59130/
      - /sportive-kawasaki-ninja-500-se-2026-ms-w-get-171662.html
      - /suzuki/df40a/2024/
    """
    import re
    if not url:
        return 0
    # Chercher un pattern -YYYY- ou /YYYY/ dans l'URL (pas au début pour éviter le port)
    match = re.search(r'[/-](20[12]\d)(?:[/-]|\.html|$)', url)
    if match:
        return int(match.group(1))
    # Fallback: pattern plus large
    match = re.search(r'[/-](19\d{2}|20\d{2})(?:[/-]|\.html|$)', url)
    if match:
        year = int(match.group(1))
        if 1990 <= year <= 2100:
            return year
    return 0


def enrich_product_year(product: dict) -> None:
    """Enrichit le produit avec l'année extraite depuis name ou sourceUrl si absente.

    Ordre de priorité :
      1. Champ 'annee' existant
      2. Regex sur 'name'
      3. Regex sur 'sourceUrl'
    """
    annee = product.get('annee', 0) or 0
    if annee:
        return

    year = extract_year_from_text(product.get('name', ''))
    if not year:
        year = extract_year_from_url(product.get('sourceUrl', ''))

    if year:
        product['annee'] = year


def normalize_product_key(product: dict, ignore_colors: bool = False, _ignore_colors: bool = False) -> Tuple[str, str, int]:
    """Crée une clé normalisée pour identifier les produits (marque + modèle + année).

    Exclut du matching : localisation, concessionnaire, état, préfixes catégorie.
    Les couleurs ne sont retirées QUE si ignore_colors=True.
    Tout le reste (trims, variantes) est toujours conservé.
    """
    import re

    raw_marque = str(product.get('marque', '')).strip()
    raw_modele = str(product.get('modele', '')).strip()
    annee = product.get('annee', 0) or 0

    # ── Toujours tenter d'extraire l'année si absente ──
    if not annee:
        annee = extract_year_from_text(product.get('name', ''))
    if not annee:
        annee = extract_year_from_url(product.get('sourceUrl', ''))

    # Nettoyer les préfixes courants
    raw_marque = re.sub(
        r'^(manufacturier|fabricant|marque|brand)\s*:\s*', '', raw_marque, flags=re.I)
    raw_modele = re.sub(r'^(modèle|modele|model)\s*:\s*',
                        '', raw_modele, flags=re.I)

    marque = _deep_normalize(raw_marque)
    modele = _deep_normalize(raw_modele)

    # ── Extraction depuis 'name' si marque ou modèle manquant ──
    if not marque or not modele:
        name = str(product.get('name', '')).strip()
        if name:
            name_norm = _deep_normalize(name)

            detected_brand = ''
            rest_of_name = name_norm

            for norm_brand, original_brand in _NORMALIZED_BRANDS:
                if name_norm.startswith(norm_brand + ' ') or name_norm == norm_brand:
                    detected_brand = norm_brand
                    rest_of_name = name_norm[len(norm_brand):].strip()
                    break
                # Chercher la marque n'importe où dans le nom
                idx = name_norm.find(norm_brand)
                if idx >= 0:
                    detected_brand = norm_brand
                    rest_of_name = (
                        name_norm[:idx] + ' ' + name_norm[idx + len(norm_brand):]).strip()
                    rest_of_name = re.sub(r'\s+', ' ', rest_of_name)
                    break

            if detected_brand:
                if not marque:
                    marque = detected_brand
                if not modele:
                    # Retirer l'année du reste pour avoir le modèle pur
                    year_match = re.search(r'\b(19|20)\d{2}\b', rest_of_name)
                    if year_match:
                        if not annee:
                            annee = int(year_match.group(0))
                        rest_of_name = rest_of_name[:year_match.start(
                        )] + rest_of_name[year_match.end():]
                    modele = re.sub(r'\s+', ' ', rest_of_name).strip()
            elif not modele:
                # Aucune marque connue détectée dans le nom — utiliser le nom nettoyé comme modèle
                # Cas fréquent : marque déjà définie (JSON-LD), nom = juste le modèle (ex: "Z900")
                year_match = re.search(r'\b(19|20)\d{2}\b', name_norm)
                if year_match:
                    if not annee:
                        annee = int(year_match.group(0))
                    name_norm = name_norm[:year_match.start(
                    )] + name_norm[year_match.end():]
                # Si la marque est déjà définie, la retirer du nom pour éviter la duplication
                cleaned_name = name_norm
                if marque:
                    marque_norm = _deep_normalize(marque)
                    if cleaned_name.startswith(marque_norm + ' '):
                        cleaned_name = cleaned_name[len(marque_norm):].strip()
                    elif cleaned_name.endswith(' ' + marque_norm):
                        cleaned_name = cleaned_name[:-
                                                    len(marque_norm):].strip()
                modele = re.sub(r'\s+', ' ', cleaned_name).strip()

    # Unifier les alias de marques
    marque = _BRAND_ALIASES.get(marque, marque)

    # ── Nettoyage du modèle : retirer UNIQUEMENT localisation, concessionnaire, état ──
    # Tout le reste (couleurs, trims, variantes) est conservé pour un matching strict.

    _DEALER_NOISE_PATTERNS = [
        r'\b(?:en\s+vente|disponible|neuf|usage|usag[ée]|occasion)\s+(?:a|à|chez|au)\b.*$',
        r"\bd['\u2019]?occasion\s+(?:a|à|chez|au)\b.*$",
        r'\b(?:a|à)\s+vendre\s+(?:a|à|chez|au)\b.*$',
        r'\b(?:concessionnaire|dealer|showroom|magasin|succursale)\b.*$',
        r'\b\w+\s+(?:motosport|motorsport|powersports?)\s*$',
        r'\b(?:moto|motos|auto|autos)\s+\w+\s*$',
        r'\b\w+\s+(?:moto|motos|sport[s]?|auto[s]?|motors?|marine|performance|center|centre)\s*$',
    ]
    for pattern in _DEALER_NOISE_PATTERNS:
        modele = re.sub(pattern, '', modele, flags=re.I).strip()

    _CATEGORY_PREFIX_PATTERNS = [
        r'^(?:c[oô]te\s+[aà]\s+c[oô]te|cote\s+a\s+cote|side\s*by\s*side|sxs)\s+',
        r'^(?:vtt|atv|quad|motoneige|snowmobile|moto|scooter)\s+',
    ]
    for pattern in _CATEGORY_PREFIX_PATTERNS:
        modele = re.sub(pattern, '', modele, flags=re.I).strip()

    _ETAT_STANDALONE = r'\b(?:neuf|new|usage|usagee?|occasion|used|demo|demonstrateur|preowned|pre[\s-]?owned|certifie|certified)\b'
    modele = re.sub(_ETAT_STANDALONE, '', modele, flags=re.I).strip()

    if ignore_colors:
        modele = remove_colors_from_string(modele)

    marque = re.sub(r'\s+', ' ', marque).strip()
    modele = re.sub(r'\s+', ' ', modele).strip()

    return (marque, modele, annee)


def _pick_best_ref(ref_matches: List[dict], current_price: float) -> dict:
    """Sélectionne le meilleur produit de référence parmi les candidats (prix le plus proche)."""
    best = None
    min_diff = float('inf')
    for ref in ref_matches:
        rp = float(ref.get('prix', 0) or 0)
        if rp > 0 and current_price > 0:
            diff = abs(current_price - rp)
            if diff < min_diff:
                min_diff = diff
                best = ref
        elif not best:
            best = ref
    return best or ref_matches[0]


def find_matching_products(reference_products: List[dict], comparison_products: List[dict],
                           reference_url: str, comparison_url: str,
                           ignore_colors: bool = False) -> List[dict]:
    """
    Trouve les produits du concurrent qui existent aussi dans le site de référence.

    Matching STRICT : marque + modèle + année doivent correspondre.
    L'année est obligatoire : si deux produits ont des années différentes, pas de match.
    Si les deux côtés n'ont pas d'année (0), le match est permis.
    """
    print(f"\n{'='*60}")
    print(f"🔍 COMPARAISON AVEC LE SITE DE RÉFÉRENCE")
    print(f"{'='*60}")
    print(f"📊 Référence: {reference_url} ({len(reference_products)} produits)")
    print(
        f"📊 Concurrent: {comparison_url} ({len(comparison_products)} produits)")
    print(f"🔒 Matching strict: marque + modèle + année (année obligatoire)")

    # Enrichir tous les produits avec l'année avant le matching
    enriched_ref = 0
    enriched_comp = 0
    for rp in reference_products:
        had_year = bool(rp.get('annee'))
        enrich_product_year(rp)
        if not had_year and rp.get('annee'):
            enriched_ref += 1
    for cp in comparison_products:
        had_year = bool(cp.get('annee'))
        enrich_product_year(cp)
        if not had_year and cp.get('annee'):
            enriched_comp += 1
    print(f"   📅 Années enrichies: {enriched_ref} réf, {enriched_comp} conc (depuis name/URL)")

    ref_exact: Dict[Tuple, List[dict]] = {}

    skipped_ref = 0
    no_year_ref = 0
    for rp in reference_products:
        key = normalize_product_key(rp, ignore_colors=ignore_colors)
        marque, modele, annee = key

        if not modele:
            skipped_ref += 1
            continue
        if not annee:
            no_year_ref += 1

        if key not in ref_exact:
            ref_exact[key] = []
        ref_exact[key].append(rp)

    print(
        f"   📋 Clés de référence: {len(ref_exact)} (ignorées: {skipped_ref}, sans année: {no_year_ref})")
    sample_keys = list(ref_exact.keys())[:5]
    for k in sample_keys:
        print(f"      Réf: marque='{k[0]}' modele='{k[1]}' annee={k[2]}")

    matched_products = []
    skipped_comp = 0
    no_year_comp = 0
    match_levels = {'exact': 0}

    for product in comparison_products:
        key = normalize_product_key(product, ignore_colors=ignore_colors)
        marque, modele, annee = key

        if not modele:
            skipped_comp += 1
            continue
        if not annee:
            no_year_comp += 1

        current_price = float(product.get('prix', 0) or 0)
        ref_matches = None
        match_level = ''

        # Match exact uniquement (marque + modele + annee)
        if key in ref_exact:
            ref_matches = ref_exact[key]
            match_level = 'exact'

        if not ref_matches:
            continue

        best_match = _pick_best_ref(ref_matches, current_price)
        ref_price = float(best_match.get('prix', 0) or 0)

        # Enrichir le produit avec les infos de comparaison
        product['prixReference'] = ref_price
        product['differencePrix'] = (
            current_price - ref_price) if current_price > 0 and ref_price > 0 else None
        product['siteReference'] = reference_url
        product['produitReference'] = {
            'name': best_match.get('name'),
            'sourceUrl': best_match.get('sourceUrl'),
            'prix': ref_price,
            'image': best_match.get('image'),
            'inventaire': best_match.get('inventaire'),
        }

        if not product.get('sourceSite'):
            product['sourceSite'] = comparison_url

        matched_products.append(product)
        match_levels[match_level] = match_levels.get(match_level, 0) + 1

        if product['differencePrix'] is not None:
            diff_str = f"+{product['differencePrix']:.0f}$" if product['differencePrix'] >= 0 else f"{product['differencePrix']:.0f}$"
            print(
                f"   ✅ [{match_level}] {marque} {modele} {annee or '?'}: {current_price:.0f}$ vs {ref_price:.0f}$ ({diff_str})")

    match_rate = (len(matched_products) / len(comparison_products)
                  * 100) if comparison_products else 0
    print(f"\n   📋 Concurrent - ignorés (modèle vide): {skipped_comp}, sans année: {no_year_comp}")
    print(
        f"   📊 Matching: exact={match_levels['exact']}")

    if not matched_products and comparison_products:
        print(f"   ⚠️ Aucune correspondance! Échantillon des clés concurrent:")
        for p in comparison_products[:5]:
            k = normalize_product_key(p, ignore_colors=ignore_colors)
            print(
                f"      Conc: marque='{k[0]}' modele='{k[1]}' annee={k[2]} | name='{p.get('name', '')[:50]}'")

    print(
        f"\n📈 Correspondances: {len(matched_products)}/{len(comparison_products)} ({match_rate:.0f}%)")
    print(f"{'='*60}\n")

    return matched_products


def scrape_site_wrapper(args: tuple) -> Tuple[str, dict]:
    """Wrapper pour le scraping en parallèle avec le nouveau système intelligent"""
    url, user_id, force_refresh, categories, inventory_only = args
    try:
        scraper = IntelligentScraper(user_id=user_id)
        result = scraper.scrape(
            url, force_refresh=force_refresh, categories=categories, inventory_only=inventory_only)
        return (url, {
            "companyInfo": {},
            "products": result.get('products', []),
            "metadata": result.get('metadata', {})
        })
    except Exception as e:
        import traceback
        print(f"❌ Erreur lors du scraping de {url}: {e}")
        print(f"📋 Trace complète de l'erreur:")
        traceback.print_exc()
        return (url, {"companyInfo": {}, "products": [], "_error": type(e).__name__})


def main():
    parser = argparse.ArgumentParser(
        description=f'Scraper AI v{PROMPT_VERSION} - Scraping intelligent avec cache Supabase',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Exemples:
  # Extraire uniquement le site de référence (sans comparaison)
  python -m scraper_ai.main https://site-reference.com
  
  # Comparer des concurrents avec le site de référence
  python -m scraper_ai.main https://site-reference.com https://concurrent1.com https://concurrent2.com
  
  # Forcer la régénération du scraper (ignorer le cache)
  python -m scraper_ai.main --force-refresh https://site.com
  
  # Spécifier l'utilisateur pour le cache Supabase
  python -m scraper_ai.main --user-id UUID https://site.com
  
  # Filtrer par catégories (inventaire, occasion, catalogue)
  python -m scraper_ai.main --categories inventaire,occasion https://site.com
        """
    )
    parser.add_argument('urls', nargs='*',
                        help='URL(s) du/des site(s) à scraper')
    parser.add_argument('--reference', '-r', dest='reference_url',
                        help='URL du site de référence pour comparer les prix')
    parser.add_argument('--force-refresh', '-f', action='store_true',
                        help='Forcer la régénération des scrapers (ignorer le cache)')
    parser.add_argument('--user-id', '-u', dest='user_id',
                        help='ID utilisateur pour le cache Supabase')
    parser.add_argument('--categories', '-c', dest='categories',
                        help='Catégories à scraper (inventaire,occasion,catalogue)')
    parser.add_argument('--invalidate-cache', '-i', action='store_true',
                        help='Invalider le cache pour les URLs spécifiées')
    parser.add_argument('--ignore-colors', action='store_true',
                        help='Ignorer les couleurs lors du matching des produits (permet plus de correspondances)')
    parser.add_argument('--inventory-only', action='store_true',
                        help='Extraire seulement les produits d\'inventaire (exclut les pages catalogue/showroom)')

    args = parser.parse_args()

    urls = args.urls
    reference_url = args.reference_url
    force_refresh = args.force_refresh
    ignore_colors = args.ignore_colors
    inventory_only = args.inventory_only
    user_id = args.user_id or os.environ.get('SCRAPER_USER_ID')

    # VÉRIFICATION OBLIGATOIRE: L'utilisateur doit être connecté
    if not user_id:
        print(f"\n{'='*70}")
        print(f"❌ AUTHENTIFICATION REQUISE")
        print(f"{'='*70}")
        print(f"Vous devez être connecté pour utiliser le scraper.")
        print(f"\nSolutions:")
        print(f"  1. Lancez le scraping depuis le dashboard (recommandé)")
        print(f"  2. Utilisez --user-id UUID avec votre ID utilisateur")
        print(f"  3. Définissez la variable d'environnement SCRAPER_USER_ID")
        print(f"{'='*70}\n")
        return

    # Parser les catégories
    categories = None
    if args.categories:
        categories = [c.strip() for c in args.categories.split(',')]
    else:
        # Par défaut: TOUTES les catégories pour extraction complète
        # L'état (neuf/usagé/catalogue) est détecté automatiquement par produit
        categories = ['inventaire', 'occasion', 'catalogue']

    if not urls:
        parser.print_help()
        return

    # Mode invalidation de cache
    if args.invalidate_cache:
        if user_id:
            storage = SupabaseStorage(user_id)
            for url in urls:
                if storage.delete_scraper(url):
                    print(f"✅ Cache invalidé pour {url}")
                else:
                    print(f"⚠️  Pas de cache trouvé pour {url}")
        else:
            print("⚠️  --user-id requis pour invalider le cache Supabase")
        return

    # Configurer l'utilisateur global si fourni
    if user_id:
        set_global_user(user_id)

    # Déterminer le site de référence
    if not reference_url and len(urls) > 0:
        reference_url = urls[0]

    # S'assurer que le site de référence est dans la liste
    all_urls = list(set(urls))
    if reference_url and reference_url not in all_urls:
        all_urls.insert(0, reference_url)

    # Séparer référence et concurrents
    competitor_urls = [url for url in all_urls if url != reference_url]

    print(f"\n{'='*70}")
    print(f"🚀 SCRAPER AI v{PROMPT_VERSION} - SCRAPING INTELLIGENT")
    print(f"{'='*70}")
    print(f"⭐ Site de référence: {reference_url}")
    print(f"📦 Concurrents à comparer: {len(competitor_urls)}")
    for i, url in enumerate(competitor_urls, 1):
        print(f"   {i}. {url}")
    print(f"👤 User ID: {user_id or 'Non connecté (local)'}")
    print(f"📂 Catégories: {categories}")
    print(f"🎨 Ignorer couleurs: {'Oui' if ignore_colors else 'Non'}")
    print(
        f"📦 Inventaire seulement: référence={'Oui' if inventory_only else 'Non'}, concurrents=Non (extraction complète)")
    print(f"{'='*70}\n")

    start_time = time.time()

    all_sites = [reference_url] + \
        competitor_urls if reference_url else competitor_urls

    # =====================================================
    # PHASE 1: VÉRIFICATION DU CACHE
    # =====================================================
    print(f"\n{'='*50}")
    print(f"📦 PHASE 1: VÉRIFICATION DU CACHE")
    print(f"{'='*50}")

    storage = SupabaseStorage(user_id)
    sites_with_cache = []
    sites_without_cache = []

    for url in all_sites:
        is_valid, cached_data = storage.is_cache_valid(url)
        if is_valid and cached_data and not force_refresh:
            sites_with_cache.append(url)
            print(f"   ✅ {url[:50]}... → CACHE VALIDE")
        else:
            sites_without_cache.append(url)
            status = "FORCE REFRESH" if force_refresh else (
                "EXPIRÉ" if cached_data else "NOUVEAU")
            print(f"   🆕 {url[:50]}... → {status}")

    print(
        f"\n   📊 Résumé: {len(sites_with_cache)} en cache, {len(sites_without_cache)} à créer")

    # =====================================================
    # PHASE 2: CRÉATION DES SCRAPERS (SÉQUENTIEL)
    # =====================================================
    # Résultats Phase 2 réutilisés en Phase 3 pour éviter double-scraping
    phase2_results: dict = {}
    if sites_without_cache:
        print(f"\n{'='*50}")
        print(f"🔧 PHASE 2: CRÉATION DES SCRAPERS (séquentiel)")
        print(f"{'='*50}")
        print(
            f"   ⏱️  Estimation: ~{len(sites_without_cache) * 45}s ({len(sites_without_cache)} sites × ~45s)")
        print(f"   💡 Traitement un par un pour éviter les limites API\n")

        failed_sites: list = []  # Sites dont le scraper n'a rien extrait

        for i, url in enumerate(sites_without_cache, 1):
            site_start = time.time()
            # inventory_only s'applique UNIQUEMENT au site de référence
            # Les concurrents doivent extraire TOUS les produits (1000-2000+)
            site_inv_only = inventory_only if url == reference_url else False
            print(
                f"\n   [{i}/{len(sites_without_cache)}] 🔄 Création du scraper pour {url[:50]}..."
                f" {'(inventaire)' if site_inv_only else '(complet)'}")
            try:
                scraper = IntelligentScraper(user_id=user_id)
                result = scraper.scrape(
                    url, force_refresh=True, categories=categories, inventory_only=site_inv_only)
                product_count = len(result.get('products', []))
                site_elapsed = time.time() - site_start
                if product_count == 0:
                    print(
                        f"   [{i}/{len(sites_without_cache)}] ⚠️  Scraper créé mais 0 produits ({site_elapsed:.0f}s) - sera re-tenté en phase 3")
                    failed_sites.append(url)
                else:
                    print(
                        f"   [{i}/{len(sites_without_cache)}] ✅ Scraper créé: {product_count} produits extraits ({site_elapsed:.0f}s)")
                    phase2_results[url] = {
                        "companyInfo": {},
                        "products": result.get('products', []),
                        "metadata": result.get('metadata', {})
                    }
            except Exception as e:
                print(f"   [{i}/{len(sites_without_cache)}] ❌ Erreur: {e}")
                failed_sites.append(url)

            # Petite pause entre chaque site pour éviter le rate limiting
            if i < len(sites_without_cache):
                print(f"   ⏳ Pause de 2s avant le prochain site...")
                time.sleep(2)

    # =====================================================
    # PHASE 3: EXTRACTION (PARALLÈLE)
    # =====================================================
    print(f"\n{'='*50}")
    print(f"⚡ PHASE 3: EXTRACTION DES DONNÉES (parallèle)")
    print(f"{'='*50}")
    print(f"   🚀 Extraction parallèle de {len(all_sites)} sites...\n")

    results: Dict[str, dict] = {}

    # Utiliser directement les résultats de Phase 2 pour éviter le double-scraping
    sites_needing_extraction = []
    for url in all_sites:
        if url in phase2_results:
            results[url] = phase2_results[url]
            product_count = len(phase2_results[url].get('products', []))
            is_ref = " ⭐" if url == reference_url else ""
            print(
                f"   ♻️  {url[:40]}...: {product_count} produits (Phase 2){is_ref}")
        else:
            sites_needing_extraction.append(url)

    if sites_needing_extraction:
        with ThreadPoolExecutor(max_workers=min(len(sites_needing_extraction), 10)) as pool:
            futures = {}
            for url in sites_needing_extraction:
                site_inv_only = inventory_only if url == reference_url else False
                future = pool.submit(
                    scrape_site_wrapper,
                    (url, user_id, False, categories, site_inv_only)
                )
                futures[future] = url

            for future in as_completed(futures):
                url = futures[future]
                try:
                    result_url, result_data = future.result()
                    results[result_url] = result_data
                    product_count = len(result_data.get('products', []))
                    is_ref = " ⭐" if url == reference_url else ""
                    print(
                        f"   ✅ {url[:40]}...: {product_count} produits{is_ref}")
                except Exception as e:
                    print(f"   ❌ {url[:40]}...: Erreur - {e}")
                    results[url] = {"companyInfo": {}, "products": []}

    # =====================================================
    # PHASE 3b: RETRY DES SITES AVEC 0 PRODUITS
    # =====================================================
    # Ne retrier que les sites avec 0 produits ET sans erreur de code
    # Les bugs Python (AttributeError, TypeError, etc.) ne doivent pas déclencher
    # un retry qui risque de corrompre un cache valide
    code_errors = {'AttributeError', 'TypeError',
                   'NameError', 'KeyError', 'ImportError', 'SyntaxError'}
    sites_with_zero_products = [
        url for url in all_sites
        if len(results.get(url, {}).get('products', [])) == 0
        and results.get(url, {}).get('_error', '') not in code_errors
    ]

    if sites_with_zero_products:
        print(f"\n{'='*50}")
        print(
            f"🔄 PHASE 3b: RETRY DES SITES SANS PRODUITS ({len(sites_with_zero_products)} sites)")
        print(f"{'='*50}")
        print(f"   ⏳ Nouvelle tentative avec force_refresh=True...\n")

        for url in sites_with_zero_products:
            is_ref = " ⭐" if url == reference_url else ""
            site_inv_only = inventory_only if url == reference_url else False
            print(f"   🔄 Retry: {url[:50]}...{is_ref}")
            try:
                scraper = IntelligentScraper(user_id=user_id)
                retry_result = scraper.scrape(
                    url, force_refresh=True, categories=categories, inventory_only=site_inv_only)
                retry_count = len(retry_result.get('products', []))
                if retry_count > 0:
                    results[url] = retry_result
                    print(f"   ✅ Retry réussi: {retry_count} produits{is_ref}")
                else:
                    print(
                        f"   ⚠️  Retry: toujours 0 produits pour {url[:50]}...{is_ref}")
            except Exception as e:
                print(f"   ❌ Retry échoué: {e}")

            # Pause entre retries pour éviter le rate limiting
            if url != sites_with_zero_products[-1]:
                time.sleep(2)

    # Signaler les sites ignorés à cause d'erreurs de code
    code_error_sites = [
        url for url in all_sites
        if results.get(url, {}).get('_error', '') in code_errors
    ]
    if code_error_sites:
        print(
            f"\n⚠️  {len(code_error_sites)} site(s) ignoré(s) pour retry (erreur de code):")
        for url in code_error_sites:
            err = results[url].get('_error', '')
            print(f"   ❌ {url[:50]} → {err} (cache préservé)")

    elapsed_time = time.time() - start_time
    print(f"\n⏱️  Scraping terminé en {elapsed_time:.1f}s")

    # Récupérer les produits de référence
    reference_products = results.get(reference_url, {}).get('products', [])

    if not reference_products:
        print(f"\n{'='*60}")
        print(f"⚠️  ATTENTION: Aucun produit trouvé sur le site de référence!")
        print(f"{'='*60}")
        print(f"🌐 Site: {reference_url}")
        print(f"\n💡 Causes possibles:")
        print(
            f"   1. Erreur DNS ou réseau temporaire (le site était peut-être inaccessible)")
        print(f"   2. Le site nécessite JavaScript (Selenium)")
        print(f"   3. Les sélecteurs CSS détectés sont incorrects")
        print(f"   4. La structure du site a changé")
        print(f"\n🔧 Solutions:")
        print(f"   - Relancez le scraping (les erreurs réseau sont souvent transitoires)")
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
        print(f"\n{'='*60}")
        print(f"🔍 COMPARAISON AVEC LES CONCURRENTS")
        print(f"{'='*60}")

        for url in competitor_urls:
            result = results.get(url, {})
            competitor_products = result.get('products', [])

            if competitor_products and reference_products:
                matched = find_matching_products(
                    reference_products=reference_products,
                    comparison_products=competitor_products,
                    reference_url=reference_url,
                    comparison_url=url,
                    ignore_colors=ignore_colors
                )
                all_matched_products.extend(matched)

    # Sauvegarder les produits
    # IMPORTANT: Inclure TOUS les produits (référence + TOUS les concurrents, matchés ou non)
    # pour que le dashboard puisse afficher les produits même sans correspondance

    # Enrichir tous les produits avec l'année avant sauvegarde
    for product in reference_products:
        enrich_product_year(product)
    for competitor_url_key in competitor_urls:
        for product in results.get(competitor_url_key, {}).get('products', []):
            enrich_product_year(product)

    # Marquer les produits de référence avec leur source
    # FORCER sourceSite (pas conditionnel) pour éviter tout mélange de données
    for product in reference_products:
        product['sourceSite'] = reference_url
        product['isReferenceProduct'] = True

    # Combiner: produits de référence + TOUS les produits des concurrents (pas juste matchés)
    all_products_to_save = []

    # 1. Ajouter tous les produits de référence
    all_products_to_save.extend(reference_products)

    # 2. Ajouter TOUS les produits des concurrents (matchés ET non-matchés)
    # Éviter les doublons en vérifiant sourceUrl (IGNORER les sourceUrl vides/None)
    reference_source_urls = {p.get('sourceUrl')
                             for p in reference_products if p.get('sourceUrl')}

    # Set pour suivre les URLs déjà ajoutées (éviter doublons entre concurrents)
    added_source_urls = set(reference_source_urls)

    # D'abord les produits matchés (ont déjà prixReference, differencePrix)
    for matched in all_matched_products:
        source_url = matched.get('sourceUrl')
        # Ne dédupliquer que si sourceUrl est non-vide
        if source_url and source_url in added_source_urls:
            continue
        # FORCER sourceSite si manquant
        if not matched.get('sourceSite'):
            try:
                from urllib.parse import urlparse
                parsed = urlparse(source_url or '')
                if parsed.netloc:
                    matched['sourceSite'] = f"{parsed.scheme}://{parsed.netloc}"
            except:
                pass
        all_products_to_save.append(matched)
        if source_url:
            added_source_urls.add(source_url)

    # Ensuite TOUS les autres produits des concurrents (non-matchés)
    for competitor_url in competitor_urls:
        result = results.get(competitor_url, {})
        competitor_products = result.get('products', [])

        for product in competitor_products:
            source_url = product.get('sourceUrl')
            # Ne dédupliquer que si sourceUrl est non-vide
            if source_url and source_url in added_source_urls:
                continue
            # FORCER sourceSite pour les produits concurrents
            if not product.get('sourceSite'):
                product['sourceSite'] = competitor_url
            all_products_to_save.append(product)
            if source_url:
                added_source_urls.add(source_url)

    # Vérification: log la répartition par site
    site_counts = {}
    for p in all_products_to_save:
        site = p.get('sourceSite', 'unknown')
        site_counts[site] = site_counts.get(site, 0) + 1
    print(f"\n📊 RÉPARTITION PAR SITE (avant sauvegarde):")
    for site, count in sorted(site_counts.items(), key=lambda x: -x[1]):
        is_ref = " ⭐" if site == reference_url else ""
        print(f"   {site[:50]}: {count} produits{is_ref}")

    final_data = {
        "products": all_products_to_save,
        "metadata": {
            "reference_url": reference_url,
            "reference_products_count": len(reference_products),
            "competitor_urls": competitor_urls,
            "total_matched_products": len(all_matched_products),
            "total_products": len(all_products_to_save),
            "scraping_time_seconds": round(elapsed_time, 1),
            "mode": "reference_only" if not competitor_urls else "comparison",
            "categories": categories,
            "prompt_version": PROMPT_VERSION
        }
    }

    # PRIORITÉ 1: Sauvegarder dans Supabase via l'API (si user_id fourni)
    saved_to_supabase = False
    if user_id:
        import requests
        api_url = os.environ.get('NEXTJS_API_URL', 'http://localhost:3000')

        scraping_payload = {
            "user_id": user_id,
            "reference_url": reference_url,
            "competitor_urls": competitor_urls,
            "products": all_products_to_save,
            "metadata": final_data["metadata"],
            "scraping_time_seconds": round(elapsed_time, 1),
            "mode": "reference_only" if not competitor_urls else "comparison"
        }

        max_retries = 3
        for attempt in range(1, max_retries + 1):
            try:
                timeout = 30 + (attempt - 1) * 15
                print(
                    f"   💾 Sauvegarde Supabase (tentative {attempt}/{max_retries}, timeout {timeout}s)...")
                response = requests.post(
                    f"{api_url}/api/scrapings/save",
                    json=scraping_payload,
                    timeout=timeout
                )

                if response.status_code == 200:
                    result = response.json()
                    if result.get('success') and not result.get('isLocal'):
                        saved_to_supabase = True
                        print(
                            f"☁️  Sauvegardé dans Supabase (ID: {result.get('scraping', {}).get('id', 'N/A')})")
                        break
                    else:
                        print(
                            f"⚠️  Réponse API: {result.get('message', 'Sauvegarde locale uniquement')}")
                else:
                    print(
                        f"⚠️  Erreur API ({response.status_code}): {response.text[:200]}")
            except Exception as e:
                print(f"⚠️  Tentative {attempt}/{max_retries} échouée: {e}")

            if attempt < max_retries:
                wait = attempt * 5
                print(f"   ⏳ Nouvelle tentative dans {wait}s...")
                time.sleep(wait)

    # TOUJOURS sauvegarder localement en backup (peu importe le résultat Supabase)
    output_file = Path(__file__).parent.parent / "scraped_data.json"
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(final_data, f, indent=2, ensure_ascii=False)
    if not saved_to_supabase:
        print(f"💾 Sauvegardé localement: {output_file}")
    else:
        print(f"💾 Backup local: {output_file}")

    # Résumé
    print(f"\n{'='*70}")
    print(f"✅ SCRAPING TERMINÉ!")
    print(f"{'='*70}")
    print(f"⭐ Site de référence: {reference_url}")
    print(f"📦 Produits de référence: {len(reference_products)}")
    if competitor_urls:
        print(f"🔍 Produits avec correspondance: {len(all_matched_products)}")
        print(
            f"📦 Total produits sauvegardés: {len(all_products_to_save)} (référence + matchés)")
    else:
        print(f"📦 Produits extraits: {len(all_products_to_save)}")
    print(f"⏱️  Temps total: {elapsed_time:.1f}s")
    if saved_to_supabase:
        print(f"☁️  Données dans: Supabase Cloud")
    else:
        print(f"💾 Sauvegardé: {output_file}")

    # Aperçu (afficher tous les produits sauvegardés, pas juste les matchés)
    if all_products_to_save:
        # Statistiques d'état
        etat_counts = {}
        cat_counts = {}
        for p in all_products_to_save:
            etat = p.get('etat', 'inconnu')
            cat = p.get('sourceCategorie', 'inconnu')
            etat_counts[etat] = etat_counts.get(etat, 0) + 1
            cat_counts[cat] = cat_counts.get(cat, 0) + 1

        print(f"\n📊 RÉPARTITION PAR ÉTAT:")
        etat_labels = {'neuf': '🟢 Neuf', 'occasion': '🟠 Usagé',
                       'demonstrateur': '🔵 Démonstrateur', 'inconnu': '⚪ Inconnu'}
        for etat, count in sorted(etat_counts.items(), key=lambda x: -x[1]):
            label = etat_labels.get(etat, etat)
            print(f"   {label}: {count} produits")

        print(f"\n📂 RÉPARTITION PAR SOURCE:")
        cat_labels = {'inventaire': '📦 Inventaire', 'catalogue': '📖 Catalogue',
                      'vehicules_occasion': '🔄 Véhicules occasion', 'inconnu': '⚪ Inconnu'}
        for cat, count in sorted(cat_counts.items(), key=lambda x: -x[1]):
            label = cat_labels.get(cat, cat)
            print(f"   {label}: {count} produits")

        print(f"\n📋 APERÇU (10 premiers):")
        for idx, p in enumerate(all_products_to_save[:10], start=1):
            nom = p.get('name') or f"{p.get('marque', '')} {p.get('modele', '')}".strip(
            ) or p.get('sourceUrl', '')
            prix = p.get('prix', 0) or 0
            diff = p.get('differencePrix')
            site = p.get('sourceSite', '')
            etat = p.get('etat', '')
            src_cat = p.get('sourceCategorie', '')

            # Badge d'état
            etat_badge = {'neuf': '[NEUF]', 'occasion': '[USAGÉ]',
                          'demonstrateur': '[DÉMO]'}.get(etat, '')
            cat_badge = {'catalogue': '[CAT]', 'vehicules_occasion': '[OCC]', 'inventaire': '[INV]'}.get(
                src_cat, '')

            # Extraire le domaine du site
            try:
                from urllib.parse import urlparse
                domain = urlparse(site).netloc.replace('www.', '')[:20]
            except:
                domain = site[:20]

            if diff is not None:
                diff_str = f"+{diff:.0f}$" if diff >= 0 else f"{diff:.0f}$"
                print(
                    f"   {idx}. {nom[:30]} | {prix:.0f}$ ({diff_str}) | {domain} {etat_badge} {cat_badge}")
            else:
                print(
                    f"   {idx}. {nom[:30]} | {prix:.0f}$ | {domain} {etat_badge} {cat_badge}")

        if len(all_products_to_save) > 10:
            print(f"   ... et {len(all_products_to_save) - 10} autres")
    else:
        print(f"\n⚠️  Aucun produit extrait.")


if __name__ == "__main__":
    main()
