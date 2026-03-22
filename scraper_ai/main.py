"""
Point d'entrée principal pour le scraper AI
Scraping intelligent avec cache Supabase et sélecteurs dynamiques
"""
import argparse
import json
import re
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
    from .dedicated_scrapers.registry import DedicatedScraperRegistry
except ImportError:
    try:
        from scraper_ai.intelligent_scraper import IntelligentScraper, scrape_site
        from scraper_ai.supabase_storage import SupabaseStorage, set_global_user
        from scraper_ai.config import PROMPT_VERSION
        from scraper_ai.dedicated_scrapers.registry import DedicatedScraperRegistry
    except ImportError:
        from intelligent_scraper import IntelligentScraper, scrape_site
        from supabase_storage import SupabaseStorage, set_global_user
        from config import PROMPT_VERSION
        try:
            from dedicated_scrapers.registry import DedicatedScraperRegistry
        except ImportError:
            DedicatedScraperRegistry = None


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
    'racing', 'candy', 'phantom', 'midnight', 'cosmic', 'storm',
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


def normalize_product_key(product: dict, ignore_colors: bool = True) -> Tuple[str, str, int]:
    """Crée une clé normalisée pour identifier les produits (marque + modèle + année).

    Exclut du matching : localisation, concessionnaire, préfixes catégorie, couleurs.
    L'état (neuf/occasion) n'est PAS dans la clé — un usagé peut matcher un neuf du même modèle.
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


MATCH_MODES = ('exact', 'base', 'no_year', 'flexible')

_TRIM_SUFFIXES = re.compile(
    r'\b(?:'
    r'abs|cbs|tcs|ktrc'                                       # freins/traction
    r'|eps|dps|ps'                                             # direction assistée
    r'|se|le|dx|lx|sx|ex|sr|gt|st|rs|ss|rr'                  # trims 2 lettres
    r'|limited|ltd|sport|touring|trail|adventure|explore'      # trims longs
    r'|premium|deluxe|elite|plus|pro|base|standard|special'
    r'|4x4|awd|2wd|4wd'                                       # transmission
    r'|xt|xt-p|x-tp'                                          # Can-Am trims
    r')\b',
    re.I
)


def _strip_model_suffixes(modele: str) -> str:
    """Retire les suffixes de trim/variante pour obtenir le modèle de base."""
    base = _TRIM_SUFFIXES.sub('', modele)
    return re.sub(r'\s+', ' ', base).strip()


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
                           ignore_colors: bool = True,
                           match_mode: str = 'exact') -> List[dict]:
    """
    Trouve les produits du concurrent qui existent aussi dans le site de référence.

    match_mode contrôle la tolérance :
      exact    — marque + modèle complet + année + état
      base     — marque + modèle de base (sans suffixes ABS/SE/EPS/Limited…) + année + état
      no_year  — marque + modèle complet + état (ignore l'année)
      flexible — marque + modèle de base + état (ignore suffixes ET année)
    """
    if match_mode not in MATCH_MODES:
        match_mode = 'exact'

    mode_labels = {
        'exact': 'marque + modèle + année + état',
        'base': 'marque + modèle de base + année + état',
        'no_year': 'marque + modèle + état (toutes années)',
        'flexible': 'marque + modèle de base + état (toutes années)',
    }

    print(f"\n{'='*60}")
    print(f"🔍 COMPARAISON AVEC LE SITE DE RÉFÉRENCE")
    print(f"{'='*60}")
    print(f"📊 Référence: {reference_url} ({len(reference_products)} produits)")
    print(f"📊 Concurrent: {comparison_url} ({len(comparison_products)} produits)")
    print(f"🔒 Mode: {match_mode} — {mode_labels[match_mode]}")

    for rp in reference_products:
        enrich_product_year(rp)
    for cp in comparison_products:
        enrich_product_year(cp)

    def _build_key(product, mode):
        marque, modele, annee = normalize_product_key(product, ignore_colors=ignore_colors)
        if mode in ('base', 'flexible'):
            modele = _strip_model_suffixes(modele)
        if mode in ('no_year', 'flexible'):
            annee = 0
        return (marque, modele, annee)

    # Index de référence pour chaque niveau actif
    ref_index: Dict[Tuple, List[dict]] = {}
    skipped_ref = 0

    for rp in reference_products:
        key = _build_key(rp, match_mode)
        if not key[1]:
            skipped_ref += 1
            continue
        ref_index.setdefault(key, []).append(rp)

    print(f"   📋 Clés de référence: {len(ref_index)} (ignorées: {skipped_ref})")

    matched_products = []
    skipped_comp = 0
    match_levels: Dict[str, int] = {}

    for product in comparison_products:
        key = _build_key(product, match_mode)
        marque, modele, annee = key

        if not modele:
            skipped_comp += 1
            continue

        ref_matches = ref_index.get(key)
        if not ref_matches:
            continue

        current_price = float(product.get('prix', 0) or 0)
        best_match = _pick_best_ref(ref_matches, current_price)
        ref_price = float(best_match.get('prix', 0) or 0)

        product['prixReference'] = ref_price
        product['differencePrix'] = (
            current_price - ref_price) if current_price > 0 and ref_price > 0 else None
        product['siteReference'] = reference_url
        product['matchLevel'] = match_mode
        product['produitReference'] = {
            'name': best_match.get('name'),
            'sourceUrl': best_match.get('sourceUrl'),
            'prix': ref_price,
            'image': best_match.get('image'),
            'inventaire': best_match.get('inventaire'),
            'kilometrage': best_match.get('kilometrage'),
            'annee': best_match.get('annee'),
            'etat': best_match.get('etat'),
            'sourceCategorie': best_match.get('sourceCategorie'),
        }

        if not product.get('sourceSite'):
            product['sourceSite'] = comparison_url

        matched_products.append(product)
        match_levels[match_mode] = match_levels.get(match_mode, 0) + 1

        if product['differencePrix'] is not None:
            diff_str = f"+{product['differencePrix']:.0f}$" if product['differencePrix'] >= 0 else f"{product['differencePrix']:.0f}$"
            print(f"   ✅ [{match_mode}] {marque} {modele} {annee or '*'}: "
                  f"{current_price:.0f}$ vs {ref_price:.0f}$ ({diff_str})")

    match_rate = (len(matched_products) / len(comparison_products)
                  * 100) if comparison_products else 0

    levels_str = ', '.join(f"{k}={v}" for k, v in match_levels.items())
    print(f"\n   📊 Matching: {levels_str or 'aucun'}")

    if not matched_products and comparison_products:
        print(f"   ⚠️ Aucune correspondance! Échantillon des clés concurrent:")
        for p in comparison_products[:5]:
            k = _build_key(p, match_mode)
            print(f"      Conc: marque='{k[0]}' modele='{k[1]}' annee={k[2]} "
                  f"| name='{p.get('name', '')[:50]}'")

    print(f"\n📈 Correspondances: {len(matched_products)}/{len(comparison_products)} ({match_rate:.0f}%)")
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


def _save_direct_supabase(supabase_url: str, supabase_key: str, row: dict,
                          user_id: str, reference_url: str) -> bool:
    """Sauvegarde directement dans Supabase via PostgREST (pas de limite 4.5MB Vercel)."""
    import requests
    try:
        headers = {
            "apikey": supabase_key,
            "Authorization": f"Bearer {supabase_key}",
            "Content-Type": "application/json",
            "Prefer": "return=representation",
        }
        print(f"   💾 Sauvegarde directe Supabase (PostgREST, pas de limite de taille)...")
        resp = requests.post(
            f"{supabase_url}/rest/v1/scrapings",
            json=row,
            headers=headers,
            timeout=60,
        )
        if resp.status_code in (200, 201):
            data = resp.json()
            record = data[0] if isinstance(data, list) and data else data
            print(f"☁️  Sauvegardé dans Supabase (ID: {record.get('id', 'N/A')})")
            _cleanup_old_scrapings(supabase_url, supabase_key, user_id, reference_url, keep=5)
            return True
        else:
            print(f"⚠️  Erreur PostgREST ({resp.status_code}): {resp.text[:300]}")
            return False
    except Exception as e:
        print(f"⚠️  Erreur sauvegarde directe: {e}")
        return False


def _cleanup_old_scrapings(supabase_url: str, supabase_key: str,
                           user_id: str, reference_url: str, keep: int = 5):
    """Garde seulement les N derniers scrapings par (user_id, reference_url)."""
    import requests
    try:
        headers = {
            "apikey": supabase_key,
            "Authorization": f"Bearer {supabase_key}",
        }
        resp = requests.get(
            f"{supabase_url}/rest/v1/scrapings",
            params={
                "select": "id,created_at",
                "user_id": f"eq.{user_id}",
                "reference_url": f"eq.{reference_url}",
                "order": "created_at.desc",
            },
            headers=headers,
            timeout=15,
        )
        if resp.status_code != 200:
            return
        rows = resp.json()
        if len(rows) <= keep:
            return
        ids_to_delete = [r["id"] for r in rows[keep:]]
        for old_id in ids_to_delete:
            requests.delete(
                f"{supabase_url}/rest/v1/scrapings",
                params={"id": f"eq.{old_id}"},
                headers={**headers, "Content-Type": "application/json"},
                timeout=10,
            )
        print(f"   🧹 Nettoyage: {len(ids_to_delete)} ancien(s) scraping(s) supprimé(s)")
    except Exception as e:
        print(f"   ⚠️  Nettoyage échoué (non bloquant): {e}")


def _save_via_api(row: dict, user_id: str) -> bool:
    """Fallback: sauvegarde via l'API Next.js (limite 4.5MB sur Vercel)."""
    import requests
    api_url = os.environ.get('NEXTJS_API_URL', '').strip() or 'http://localhost:3000'
    max_retries = 3
    for attempt in range(1, max_retries + 1):
        try:
            timeout = 30 + (attempt - 1) * 15
            print(
                f"   💾 Sauvegarde via API Next.js (tentative {attempt}/{max_retries}, timeout {timeout}s)...")
            response = requests.post(
                f"{api_url}/api/scrapings/save",
                json=row,
                timeout=timeout,
            )
            if response.status_code == 200:
                result = response.json()
                if result.get('success') and not result.get('isLocal'):
                    print(
                        f"☁️  Sauvegardé dans Supabase (ID: {result.get('scraping', {}).get('id', 'N/A')})")
                    return True
                else:
                    print(
                        f"⚠️  Réponse API: {result.get('message', 'Sauvegarde locale uniquement')}")
            elif response.status_code == 413:
                print(f"⚠️  Payload trop volumineux pour Vercel (4.5MB). Configurez SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY pour la sauvegarde directe.")
                return False
            else:
                print(
                    f"⚠️  Erreur API ({response.status_code}): {response.text[:200]}")
        except Exception as e:
            print(f"⚠️  Tentative {attempt}/{max_retries} échouée: {e}")

        if attempt < max_retries:
            wait = attempt * 5
            print(f"   ⏳ Nouvelle tentative dans {wait}s...")
            time.sleep(wait)
    return False


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
                        help='(déprécié, maintenant le comportement par défaut) Ignorer les couleurs lors du matching')
    parser.add_argument('--strict-colors', action='store_true',
                        help='Garder les couleurs lors du matching (par défaut les couleurs sont ignorées)')
    parser.add_argument('--inventory-only', action='store_true',
                        help='Extraire seulement les produits d\'inventaire (exclut les pages catalogue/showroom)')
    parser.add_argument('--match-mode', choices=MATCH_MODES, default='exact',
                        help='Mode de matching: exact, base (sans suffixes), no_year, flexible (sans suffixes ni année)')

    args = parser.parse_args()

    urls = args.urls
    reference_url = args.reference_url
    force_refresh = args.force_refresh
    ignore_colors = not args.strict_colors
    inventory_only = args.inventory_only
    match_mode = args.match_mode
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
    print(f"🔗 Mode matching: {match_mode}")
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
    # PHASE 2: CRÉATION DES SCRAPERS UNIVERSELS (SÉQUENTIEL)
    # =====================================================
    # Les scrapers dédiés (pas de Gemini) sont envoyés en Phase 3 (parallèle)
    # Seuls les scrapers universels (Gemini) restent séquentiels ici
    phase2_results: dict = {}

    has_registry = DedicatedScraperRegistry is not None
    dedicated_sites = []
    universal_sites = []
    for url in sites_without_cache:
        if has_registry and DedicatedScraperRegistry.has_dedicated_scraper(url):
            dedicated_sites.append(url)
        else:
            universal_sites.append(url)

    if dedicated_sites:
        print(f"\n   🔧 {len(dedicated_sites)} site(s) dédié(s) détecté(s) → Phase 3 (parallèle)")
        for url in dedicated_sites:
            print(f"      ⚡ {url[:50]}...")

    if universal_sites:
        print(f"\n{'='*50}")
        print(f"🔧 PHASE 2: CRÉATION DES SCRAPERS UNIVERSELS (séquentiel)")
        print(f"{'='*50}")
        print(
            f"   ⏱️  Estimation: ~{len(universal_sites) * 45}s ({len(universal_sites)} sites × ~45s)")
        print(f"   💡 Traitement un par un pour éviter les limites API Gemini\n")

        failed_sites: list = []

        for i, url in enumerate(universal_sites, 1):
            site_start = time.time()
            site_inv_only = inventory_only if url == reference_url else False
            print(
                f"\n   [{i}/{len(universal_sites)}] 🔄 Création du scraper pour {url[:50]}..."
                f" {'(inventaire)' if site_inv_only else '(complet)'}")
            try:
                scraper = IntelligentScraper(user_id=user_id)
                result = scraper.scrape(
                    url, force_refresh=True, categories=categories, inventory_only=site_inv_only)
                product_count = len(result.get('products', []))
                site_elapsed = time.time() - site_start
                if product_count == 0:
                    print(
                        f"   [{i}/{len(universal_sites)}] ⚠️  Scraper créé mais 0 produits ({site_elapsed:.0f}s) - sera re-tenté en phase 3")
                    failed_sites.append(url)
                else:
                    print(
                        f"   [{i}/{len(universal_sites)}] ✅ Scraper créé: {product_count} produits extraits ({site_elapsed:.0f}s)")
                    phase2_results[url] = {
                        "companyInfo": {},
                        "products": result.get('products', []),
                        "metadata": result.get('metadata', {})
                    }
            except Exception as e:
                print(f"   [{i}/{len(universal_sites)}] ❌ Erreur: {e}")
                failed_sites.append(url)

            if i < len(universal_sites):
                print(f"   ⏳ Pause de 2s avant le prochain site...")
                time.sleep(2)

    # =====================================================
    # PHASE 3: EXTRACTION (PARALLÈLE)
    # =====================================================
    # Inclut: scrapers dédiés, sites en cache, sites universels échoués en Phase 2
    sites_needing_extraction = []
    for url in all_sites:
        if url in phase2_results:
            pass
        else:
            sites_needing_extraction.append(url)

    print(f"\n{'='*50}")
    print(f"⚡ PHASE 3: EXTRACTION DES DONNÉES (parallèle)")
    print(f"{'='*50}")
    print(f"   🚀 {len(sites_needing_extraction)} sites en parallèle, "
          f"{len(phase2_results)} déjà extraits en Phase 2\n")

    results: Dict[str, dict] = {}

    for url in all_sites:
        if url in phase2_results:
            results[url] = phase2_results[url]
            product_count = len(phase2_results[url].get('products', []))
            is_ref = " ⭐" if url == reference_url else ""
            print(
                f"   ♻️  {url[:40]}...: {product_count} produits (Phase 2){is_ref}")

    if sites_needing_extraction:
        per_site_timeout = 300
        total_timeout = per_site_timeout * len(sites_needing_extraction)
        with ThreadPoolExecutor(max_workers=min(len(sites_needing_extraction), 10)) as pool:
            futures = {}
            for url in sites_needing_extraction:
                site_inv_only = inventory_only if url == reference_url else False
                future = pool.submit(
                    scrape_site_wrapper,
                    (url, user_id, False, categories, site_inv_only)
                )
                futures[future] = url

            try:
                for future in as_completed(futures, timeout=total_timeout):
                    url = futures[future]
                    try:
                        result_url, result_data = future.result(timeout=per_site_timeout)
                        results[result_url] = result_data
                        product_count = len(result_data.get('products', []))
                        is_ref = " ⭐" if url == reference_url else ""
                        print(
                            f"   ✅ {url[:40]}...: {product_count} produits{is_ref}")
                    except Exception as e:
                        print(f"   ❌ {url[:40]}...: Erreur - {e}")
                        results[url] = {"companyInfo": {}, "products": []}
            except TimeoutError:
                timed_out = [u for f, u in futures.items() if u not in results]
                print(f"\n   ⚠️  Timeout global Phase 3 — {len(timed_out)} site(s) abandonné(s):")
                for u in timed_out:
                    print(f"      ❌ {u[:50]}")
                    results[u] = {"companyInfo": {}, "products": []}

    # =====================================================
    # PHASE 3b: RETRY DES SITES AVEC 0 PRODUITS (max 3 sites, sans force_refresh)
    # =====================================================
    code_errors = {'AttributeError', 'TypeError',
                   'NameError', 'KeyError', 'ImportError', 'SyntaxError'}
    sites_with_zero_products = [
        url for url in all_sites
        if len(results.get(url, {}).get('products', [])) == 0
        and results.get(url, {}).get('_error', '') not in code_errors
    ]

    MAX_RETRIES = 3
    if sites_with_zero_products:
        retry_list = sites_with_zero_products[:MAX_RETRIES]
        skipped = len(sites_with_zero_products) - len(retry_list)
        print(f"\n{'='*50}")
        print(
            f"🔄 PHASE 3b: RETRY ({len(retry_list)} sites, cache conservé)")
        print(f"{'='*50}")
        if skipped > 0:
            print(f"   ⏭️  {skipped} site(s) ignoré(s) pour limiter le temps total")

        for url in retry_list:
            is_ref = " ⭐" if url == reference_url else ""
            site_inv_only = inventory_only if url == reference_url else False
            print(f"   🔄 Retry: {url[:50]}...{is_ref}")
            try:
                scraper = IntelligentScraper(user_id=user_id)
                retry_result = scraper.scrape(
                    url, force_refresh=False, categories=categories, inventory_only=site_inv_only)
                retry_count = len(retry_result.get('products', []))
                if retry_count > 0:
                    results[url] = retry_result
                    print(f"   ✅ Retry réussi: {retry_count} produits{is_ref}")
                else:
                    print(
                        f"   ⚠️  Retry: toujours 0 produits pour {url[:50]}...{is_ref}")
            except Exception as e:
                print(f"   ❌ Retry échoué: {e}")

            if url != retry_list[-1]:
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
                    ignore_colors=ignore_colors,
                    match_mode=match_mode
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

    # PRIORITÉ 1: Sauvegarder directement dans Supabase (bypass Vercel 4.5MB limit)
    # PRIORITÉ 2: Fallback via l'API Next.js si pas de credentials directes
    saved_to_supabase = False
    if user_id:
        supabase_url = os.environ.get('SUPABASE_URL') or os.environ.get('NEXT_PUBLIC_SUPABASE_URL', '')
        supabase_key = os.environ.get('SUPABASE_SERVICE_ROLE_KEY', '')

        scraping_row = {
            "user_id": user_id,
            "reference_url": reference_url,
            "competitor_urls": competitor_urls,
            "products": all_products_to_save,
            "metadata": final_data["metadata"],
            "scraping_time_seconds": round(elapsed_time, 1),
            "mode": "reference_only" if not competitor_urls else "comparison"
        }

        if supabase_url and supabase_key:
            saved_to_supabase = _save_direct_supabase(
                supabase_url, supabase_key, scraping_row, user_id, reference_url)

        if not saved_to_supabase:
            saved_to_supabase = _save_via_api(scraping_row, user_id)

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
