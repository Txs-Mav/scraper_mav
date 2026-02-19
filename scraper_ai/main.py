"""
Point d'entrée principal pour le scraper AI
Scraping intelligent avec cache Supabase et sélecteurs dynamiques
"""
import argparse
import json
import time
import os
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
    'kawasaki', 'honda', 'yamaha', 'suzuki', 'ktm', 'husqvarna',
    'triumph', 'cfmoto', 'cf moto', 'aprilia', 'vespa', 'piaggio', 'ducati',
    'bmw', 'harley-davidson', 'harley davidson', 'indian', 'royal enfield',
    'can-am', 'can am', 'polaris', 'arctic cat', 'sea-doo', 'sea doo',
    'ski-doo', 'ski doo', 'brp', 'segway', 'kymco', 'adly', 'beta',
    'cub cadet', 'john deere', 'gas gas', 'gasgas', 'sherco', 'benelli',
    'mv agusta', 'moto guzzi', 'zero', 'energica', 'sur-ron', 'surron',
], key=len, reverse=True)

# Normaliser les marques pour le matching
_NORMALIZED_BRANDS = [(_deep_normalize(b), b) for b in KNOWN_BRANDS]

# Sous-modèles significatifs : ces mots ne doivent JAMAIS être ignorés lors du matching
# par inclusion. Si un côté a "SE" et l'autre non, ce ne sont PAS les mêmes produits.
SIGNIFICANT_SUBMODEL_WORDS = {
    # Variantes de performance / édition
    'se', 'r', 'rr', 'rs', 'x', 'xr', 'xc', 'xs', 'xd', 'xt', 'xmr', 'xtp',
    'sx', 'sxf', 'exc', 'excf',
    'factory', 'edition', 'special', 'limited', 'elite', 'premium', 'pro',
    'sport', 'sports', 'adventure', 'adv',
    # Variantes touring / utilitaire
    'touring', 'tour', 'gt', 'gts', 'trail', 'rally',
    'eps', 'dps', 'ess',  # Direction assistée (modèles différents)
    'lt', 'st',  # Light Touring, Sport Touring
    # Variantes taille / cylindrée
    'plus', 'max', 'mini', 'lite', 'base',
    # Variantes spécifiques motos/VTT
    'enduro', 'supermoto', 'motard', 'scrambler', 'classic', 'heritage',
    'custom', 'cruiser', 'naked', 'street',
    # Combinaisons fusionnées de lettres (R L → rl, etc.)
    # Toute combinaison incluant 'r' ou 'x' est significative
    'rl', 'rx', 'xl', 'fl', 'fx',
    # Tailles de cylindrée souvent dans le modèle
    '125', '150', '200', '250', '300', '350', '390', '400', '450', '500',
    '600', '650', '690', '700', '750', '790', '800', '850', '890', '900',
    '950', '1000', '1090', '1190', '1200', '1250', '1290',
}
# Normaliser les sous-modèles
_NORMALIZED_SIGNIFICANT = {_deep_normalize(
    w) for w in SIGNIFICANT_SUBMODEL_WORDS if w}

# Lettres simples significatives (pour vérification des formes fusionnées)
_SIGNIFICANT_SINGLE_LETTERS = {
    w for w in _NORMALIZED_SIGNIFICANT if len(w) == 1}


def _is_significant_diff(diff_words: set) -> bool:
    """Vérifie si un ensemble de mots de différence contient un sous-modèle significatif.

    Gère aussi les formes fusionnées: si un mot court (≤3 lettres) contient une lettre
    significative individuelle (r, x), il est considéré comme significatif.
    Ex: 'rl' contient 'r' → significatif.

    Tout token numérique est significatif (tailles de roues, cylindrées, versions, etc.)
    car les nombres dans les noms de produits indiquent toujours une variante distincte.
    Ex: ELEKTRODE 20 ≠ ELEKTRODE 16 (taille de roue différente)
    """
    for w in diff_words:
        # Vérification directe dans le set
        if w in _NORMALIZED_SIGNIFICANT:
            return True
        # Tout nombre est significatif (taille, cylindrée, version, puissance)
        if w.isdigit():
            return True
        # Pour les tokens courts et purement alpha (possibles résultats de fusion),
        # vérifier si une lettre individuelle est significative
        if 1 < len(w) <= 3 and w.isalpha() and _SIGNIFICANT_SINGLE_LETTERS:
            if any(c in _SIGNIFICANT_SINGLE_LETTERS for c in w):
                return True
    return False


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
}


def normalize_product_key(product: dict, ignore_colors: bool = False) -> Tuple[str, str, int]:
    """Crée une clé normalisée pour identifier les produits (marque + modèle + année).

    Normalisation profonde: sans accents, sans ponctuation, espaces collés entre 
    lettres/chiffres séparés, comparaison de mots entiers pour les couleurs.

    Args:
        product: Dictionnaire du produit
        ignore_colors: Si True, retire les couleurs du modèle pour le matching
    """
    import re

    raw_marque = str(product.get('marque', '')).strip()
    raw_modele = str(product.get('modele', '')).strip()
    annee = product.get('annee', 0) or 0

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
                    year_match = re.search(r'\b(20[12]\d)\b', rest_of_name)
                    if year_match:
                        if not annee:
                            annee = int(year_match.group(1))
                        rest_of_name = rest_of_name[:year_match.start(
                        )] + rest_of_name[year_match.end():]
                    modele = re.sub(r'\s+', ' ', rest_of_name).strip()
            elif not modele:
                # Aucune marque connue détectée dans le nom — utiliser le nom nettoyé comme modèle
                # Cas fréquent : marque déjà définie (JSON-LD), nom = juste le modèle (ex: "Z900")
                year_match = re.search(r'\b(20[12]\d)\b', name_norm)
                if year_match:
                    if not annee:
                        annee = int(year_match.group(1))
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

    # ── Nettoyage du modèle : retirer les phrases parasites de localisation/concession ──
    # Patterns courants : "en vente a shawinigan mvm motosport", "neuf a trois-rivieres", etc.
    _DEALER_NOISE_PATTERNS = [
        r'\b(?:en\s+vente|disponible|neuf|usage|usag[ée])\s+(?:a|à|chez|au)\b.*$',
        r'\b(?:mvm\s*motosport|morin\s*sports?|moto\s*thibault|moto\s*ducharme)\b.*$',
        r'\b(?:shawinigan|trois\s*[-\s]*rivi[eè]res|montr[ée]al|qu[ée]bec|laval|longueuil|sherbrooke|drummondville|victoriaville|b[ée]cancour)\b.*$',
        r'\b(?:concessionnaire|dealer|showroom|magasin|succursale)\b.*$',
    ]
    for pattern in _DEALER_NOISE_PATTERNS:
        modele = re.sub(pattern, '', modele, flags=re.I).strip()

    # Retirer les couleurs si demandé
    if ignore_colors:
        modele = remove_colors_from_string(modele)

    # Nettoyer les espaces finaux
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

    Matching strict après normalisation profonde :
      1. Match exact (marque + modèle + année) — après deepNormalize
      2. Match avec année wildcard — si l'un des deux côtés n'a PAS d'année (0),
         on accepte le match. Si les deux ont une année et qu'elles diffèrent → PAS de match.

    Les sous-modèles (SE, Touring, R, X, etc.) sont TOUJOURS respectés.
    Les années sont TOUJOURS respectées quand elles existent des deux côtés.

    Retourne UNIQUEMENT les produits du concurrent qui ont une correspondance.
    """
    print(f"\n{'='*60}")
    print(f"🔍 COMPARAISON AVEC LE SITE DE RÉFÉRENCE")
    print(f"{'='*60}")
    print(f"📊 Référence: {reference_url} ({len(reference_products)} produits)")
    print(
        f"📊 Concurrent: {comparison_url} ({len(comparison_products)} produits)")
    if ignore_colors:
        print(f"🎨 Mode: Ignorer les couleurs (matching élargi)")

    # ── Index des produits de référence ──
    # Index 1 : clé complète (marque, modele, annee) — pour match exact
    ref_exact: Dict[Tuple, List[dict]] = {}
    # Index 2 : clé (marque, modele) → liste de (annee, produit) — pour match avec année wildcard
    ref_by_model: Dict[Tuple[str, str], List[Tuple[int, dict]]] = {}

    skipped_ref = 0
    for rp in reference_products:
        key = normalize_product_key(rp, ignore_colors=ignore_colors)
        marque, modele, annee = key

        if not modele:
            skipped_ref += 1
            continue

        # Index exact
        if key not in ref_exact:
            ref_exact[key] = []
        ref_exact[key].append(rp)

        # Index par modèle (pour wildcard année)
        model_key = (marque, modele)
        if model_key not in ref_by_model:
            ref_by_model[model_key] = []
        ref_by_model[model_key].append((annee, rp))

    print(
        f"   📋 Clés de référence: {len(ref_exact)} (modèles uniques: {len(ref_by_model)}, ignorées: {skipped_ref})")
    sample_keys = list(ref_exact.keys())[:5]
    for k in sample_keys:
        print(f"      Réf: marque='{k[0]}' modele='{k[1]}' annee={k[2]}")

    # ── Matching ──
    matched_products = []
    skipped_comp = 0
    match_levels = {'exact': 0, 'year_wildcard': 0, 'model_inclusion': 0}

    for product in comparison_products:
        key = normalize_product_key(product, ignore_colors=ignore_colors)
        marque, modele, annee = key

        if not modele:
            skipped_comp += 1
            continue

        current_price = float(product.get('prix', 0) or 0)
        ref_matches = None
        match_level = ''

        # ── Niveau 1 : Match exact (marque + modele + annee) ──
        if key in ref_exact:
            ref_matches = ref_exact[key]
            match_level = 'exact'

        # ── Niveau 2 : Match avec année wildcard ──
        # Seulement si au moins un côté n'a PAS d'année (0).
        # Si les deux côtés ont une année et qu'elles diffèrent → PAS de match.
        if not ref_matches:
            model_key = (marque, modele)
            candidates = ref_by_model.get(model_key, [])

            wildcard_matches = []
            for ref_annee, ref_prod in candidates:
                # Accepter si : l'un des deux n'a pas d'année
                if annee == 0 or ref_annee == 0:
                    wildcard_matches.append(ref_prod)
                # Si les deux ont une année identique (déjà couvert par exact, mais au cas où)
                elif annee == ref_annee:
                    wildcard_matches.append(ref_prod)
                # Sinon (deux années différentes non-nulles) → on refuse

            if wildcard_matches:
                ref_matches = wildcard_matches
                match_level = 'year_wildcard'

        # ── Niveau 3 : Match par inclusion de modèle ──
        # Si le modèle du concurrent est contenu dans le modèle de la référence (ou inversement),
        # on accepte le match SEULEMENT si la différence ne contient pas de sous-modèle significatif.
        #
        # Ex ACCEPTÉ : "brute force 300" ↔ "brute force 300 rouge" (diff = couleur → OK)
        # Ex REJETÉ  : "450 sx" ↔ "450 sx se" (diff = "se" → sous-modèle significatif → REJET)
        # Ex REJETÉ  : "450 sx se" ↔ "450 sx" (diff = "se" → sous-modèle significatif → REJET)
        if not ref_matches:
            for ref_key, ref_prods in ref_exact.items():
                ref_marque, ref_modele, ref_annee = ref_key
                if ref_marque != marque:
                    continue
                # Vérifier compatibilité d'année
                if annee != 0 and ref_annee != 0 and annee != ref_annee:
                    continue
                if not ref_modele or not modele:
                    continue
                ref_words = set(ref_modele.split())
                comp_words = set(modele.split())

                is_subset = comp_words.issubset(
                    ref_words) or ref_words.issubset(comp_words)
                if not is_subset:
                    continue

                diff_words = ref_words.symmetric_difference(comp_words)
                has_significant_diff = _is_significant_diff(diff_words)

                if has_significant_diff:
                    if len(matched_products) < 50:
                        print(
                            f"      🚫 [inclusion rejetée] '{modele}' ≠ '{ref_modele}' (diff significative: {diff_words})")
                    continue

                if not ref_matches:
                    ref_matches = []
                ref_matches.extend(ref_prods)
                match_level = 'model_inclusion'

        if not ref_matches:
            continue

        # Sélectionner le meilleur match
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
            'prix': ref_price
        }

        if not product.get('sourceSite'):
            product['sourceSite'] = comparison_url

        matched_products.append(product)
        match_levels[match_level] = match_levels.get(match_level, 0) + 1

        if product['differencePrix'] is not None:
            diff_str = f"+{product['differencePrix']:.0f}$" if product['differencePrix'] >= 0 else f"{product['differencePrix']:.0f}$"
            level_icon = '✅' if match_level == 'exact' else '📅'
            print(
                f"   {level_icon} [{match_level}] {marque} {modele} {annee or ''}: {current_price:.0f}$ vs {ref_price:.0f}$ ({diff_str})")

    match_rate = (len(matched_products) / len(comparison_products)
                  * 100) if comparison_products else 0
    print(f"\n   📋 Concurrent - ignorés (modèle vide): {skipped_comp}")
    print(
        f"   📊 Matching: exact={match_levels['exact']}, wildcard année={match_levels['year_wildcard']}, inclusion modèle={match_levels['model_inclusion']}")

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
        return (url, {"companyInfo": {}, "products": []})


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
        f"📦 Inventaire seulement: {'Oui (exclut catalogue/showroom)' if inventory_only else 'Non (inventaire + catalogue)'}")
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
    if sites_without_cache:
        print(f"\n{'='*50}")
        print(f"🔧 PHASE 2: CRÉATION DES SCRAPERS (séquentiel)")
        print(f"{'='*50}")
        print(
            f"   ⏱️  Estimation: ~{len(sites_without_cache) * 45}s ({len(sites_without_cache)} sites × ~45s)")
        print(f"   💡 Traitement un par un pour éviter les limites API\n")

        failed_sites: list = []  # Sites dont le scraper n'a rien extrait

        for i, url in enumerate(sites_without_cache, 1):
            print(
                f"\n   [{i}/{len(sites_without_cache)}] 🔄 Création du scraper pour {url[:50]}...")
            try:
                scraper = IntelligentScraper(user_id=user_id)
                # Appel avec force_refresh=True pour forcer la création
                result = scraper.scrape(
                    url, force_refresh=True, categories=categories, inventory_only=inventory_only)
                product_count = len(result.get('products', []))
                if product_count == 0:
                    print(
                        f"   [{i}/{len(sites_without_cache)}] ⚠️  Scraper créé mais 0 produits - sera re-tenté en phase 3")
                    failed_sites.append(url)
                else:
                    print(
                        f"   [{i}/{len(sites_without_cache)}] ✅ Scraper créé: {product_count} produits extraits")
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

    with ThreadPoolExecutor(max_workers=min(len(all_sites), 10)) as pool:
        futures = {}
        for url in all_sites:
            future = pool.submit(
                scrape_site_wrapper,
                # force_refresh=False car scrapers déjà créés
                (url, user_id, False, categories, inventory_only)
            )
            futures[future] = url

        for future in as_completed(futures):
            url = futures[future]
            try:
                result_url, result_data = future.result()
                results[result_url] = result_data
                product_count = len(result_data.get('products', []))
                is_ref = " ⭐" if url == reference_url else ""
                print(f"   ✅ {url[:40]}...: {product_count} produits{is_ref}")
            except Exception as e:
                print(f"   ❌ {url[:40]}...: Erreur - {e}")
                results[url] = {"companyInfo": {}, "products": []}

    # =====================================================
    # PHASE 3b: RETRY DES SITES AVEC 0 PRODUITS
    # =====================================================
    # Identifier TOUS les sites avec 0 produits (pas juste ceux en phase 2)
    sites_with_zero_products = [
        url for url in all_sites
        if len(results.get(url, {}).get('products', [])) == 0
    ]

    if sites_with_zero_products:
        print(f"\n{'='*50}")
        print(
            f"🔄 PHASE 3b: RETRY DES SITES SANS PRODUITS ({len(sites_with_zero_products)} sites)")
        print(f"{'='*50}")
        print(f"   ⏳ Nouvelle tentative avec force_refresh=True...\n")

        for url in sites_with_zero_products:
            is_ref = " ⭐" if url == reference_url else ""
            print(f"   🔄 Retry: {url[:50]}...{is_ref}")
            try:
                scraper = IntelligentScraper(user_id=user_id)
                retry_result = scraper.scrape(
                    url, force_refresh=True, categories=categories, inventory_only=inventory_only)
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
        try:
            import requests
            api_url = os.environ.get('NEXTJS_API_URL', 'http://localhost:3000')

            scraping_payload = {
                "user_id": user_id,
                "reference_url": reference_url,
                "competitor_urls": competitor_urls,
                # IMPORTANT: inclure TOUS les produits (référence + matchés)
                "products": all_products_to_save,
                "metadata": final_data["metadata"],
                "scraping_time_seconds": round(elapsed_time, 1),
                "mode": "reference_only" if not competitor_urls else "comparison"
            }

            response = requests.post(
                f"{api_url}/api/scrapings/save",
                json=scraping_payload,
                timeout=30
            )

            if response.status_code == 200:
                result = response.json()
                if result.get('success') and not result.get('isLocal'):
                    saved_to_supabase = True
                    print(
                        f"☁️  Sauvegardé dans Supabase (ID: {result.get('scraping', {}).get('id', 'N/A')})")
                else:
                    print(
                        f"⚠️  Réponse API: {result.get('message', 'Sauvegarde locale uniquement')}")
            else:
                print(
                    f"⚠️  Erreur API ({response.status_code}): {response.text[:200]}")
        except Exception as e:
            print(f"⚠️  Erreur sauvegarde Supabase: {e}")

    # FALLBACK: Sauvegarder localement seulement si Supabase a échoué
    output_file = Path(__file__).parent.parent / "scraped_data.json"
    if not saved_to_supabase:
        with open(output_file, 'w', encoding='utf-8') as f:
            json.dump(final_data, f, indent=2, ensure_ascii=False)
        print(f"💾 Sauvegardé localement: {output_file}")

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
