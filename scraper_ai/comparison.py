"""
Fonctions de comparaison de produits — module léger sans dépendances lourdes.
Extrait de scraper_ai/main.py pour éviter d'importer Gemini/Playwright/etc.
"""
import re
from typing import List, Dict, Tuple


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
    'combat', 'lime', 'sauge', 'cristal', 'obsidian',
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
    # Modificateurs de couleur véhicules
    'acide', 'cristal', 'crystal',
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


_NAME_STATUS_TAGS = re.compile(
    r'\b(?:'
    r'pr[ée][\s-]?commande|pre[\s-]?order'
    r'|en\s+stock|in\s+stock|disponible|available'
    r'|[ée]puis[ée]|sold\s+out|out\s+of\s+stock|indisponible'
    r'|sur\s+commande|on\s+order'
    r'|liquidation|clearance'
    r')\b',
    re.I
)


def clean_product_name(product: dict) -> None:
    """Strip status/availability tags from product name (PRE-COMMANDE, EN STOCK, etc.)."""
    name = product.get('name', '')
    if not name:
        return
    cleaned = _NAME_STATUS_TAGS.sub('', name)
    # Clean leftover separators around where the tag was, but preserve hyphens inside words (Sea-Doo, MT-07)
    cleaned = re.sub(r'(?:^[\s\-–—]+|[\s\-–—]+$)', '', cleaned)
    cleaned = re.sub(r'\s[\-–—]\s', ' ', cleaned)
    cleaned = re.sub(r'\s{2,}', ' ', cleaned).strip()
    if cleaned != name:
        product['name'] = cleaned


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
        r'^(?:motomarine|watercraft|jet\s*ski|personal\s+watercraft|pwc)\s+',
        r'^(?:ponton|pontoon|bateau|boat|embarcation)\s+',
        r'^(?:moteur\s+hors[\s-]?bord|outboard|hors[\s-]?bord)\s+',
        r'^(?:sportive|routiere|routière|touring|adventure|aventure|cruiser|custom|standard|naked|enduro|supermoto|trail|dual[\s-]?sport|double[\s-]?usage|sport[\s-]?touring|grand[\s-]?touring|retro)\s+',
        r'^(?:3[\s-]?roues|three[\s-]?wheel|trike)\s+',
        r'^(?:velo[\s-]?electrique|e[\s-]?bike|ebike)\s+',
    ]
    for pattern in _CATEGORY_PREFIX_PATTERNS:
        modele = re.sub(pattern, '', modele, flags=re.I).strip()

    _ETAT_STANDALONE = r'\b(?:neuf|new|usage|usagee?|occasion|used|demo|demonstrateur|preowned|pre[\s-]?owned|certifie|certified)\b'
    modele = re.sub(_ETAT_STANDALONE, '', modele, flags=re.I).strip()

    modele = re.sub(r'\bpre\s*commande\b', '', modele, flags=re.I).strip()
    modele = re.sub(r'\bpre\s*order\b', '', modele, flags=re.I).strip()

    if ignore_colors:
        modele = remove_colors_from_string(modele)

    modele = re.sub(
        r'(\d+)\s+(?:th|st|nd|rd|e|eme)\s+(?:annivers\w*|anniv)\b',
        r'\1 anniversaire',
        modele,
    )

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
    print(
        f"📊 Concurrent: {comparison_url} ({len(comparison_products)} produits)")
    print(f"🔒 Mode: {match_mode} — {mode_labels[match_mode]}")

    for rp in reference_products:
        enrich_product_year(rp)
    for cp in comparison_products:
        enrich_product_year(cp)

    def _build_key(product, mode):
        marque, modele, annee = normalize_product_key(
            product, ignore_colors=ignore_colors)
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

    print(
        f"   📋 Clés de référence: {len(ref_index)} (ignorées: {skipped_ref})")

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

    print(
        f"\n📈 Correspondances: {len(matched_products)}/{len(comparison_products)} ({match_rate:.0f}%)")
    print(f"{'='*60}\n")

    return matched_products
