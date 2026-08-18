"""Regroupement partagé des produits identiques (multi-unités).

Remplace les trois copies historiques du regroupement
(motoplex._group_identical_products, intelligent_scraper._deduplicate_products,
st_onge_ford._group_identical_products) par une implémentation unique.

Contrat de sortie (issue Txs-Mav/scraper_mav#1) :
  - quantity == 1 → produit inchangé par rapport à l'ancien comportement
    (pas de champ ``units`` ni ``multi_unit``) ;
  - quantity >= 2 → le produit groupé gagne ``multi_unit: True`` et
    ``units: [{unit_key, inventaire, prix, sourceUrl, couleur, vin}]``,
    et ``prix`` = min des prix d'unités connus.

La cascade de ``unit_key`` DOIT rester identique dans les trois langages qui
la calculent (ici, le trigger plpgsql product_price_history, et detectChanges
en TypeScript) : vin (>=10 car.) → inventaire → ID de fin d'URL → URL
complète → md5(nom|couleur)[:12].
"""
import hashlib
import re
from typing import Dict, List, Optional

# ID d'unité en fin d'URL PowerGO/SM360 : « …-a-vendre-84568/ »,
# « …-a-vendre-ins52104/ », « …-for-sale-inst4/ »
_URL_ID_RE = re.compile(r'-([a-z]{0,8}\d{1,10})/?$', re.IGNORECASE)


def compute_unit_key(product: Dict) -> str:
    """Identifiant stable d'une unité physique. Même cascade que le trigger SQL."""
    vin = str(product.get('vin') or '').strip().upper()
    if len(vin) >= 10:
        return vin

    inv = str(product.get('inventaire') or '').strip()
    if inv:
        return inv

    url = str(product.get('sourceUrl') or '').rstrip('/')
    if url:
        m = _URL_ID_RE.search(url)
        if m:
            return m.group(1).lower()
        return url

    base = f"{str(product.get('name') or '').lower().strip()}|{str(product.get('couleur') or '').lower().strip()}"
    return hashlib.md5(base.encode('utf-8')).hexdigest()[:12]


def _unit_from_product(product: Dict) -> Dict:
    unit = {
        'unit_key': compute_unit_key(product),
        'prix': product.get('prix'),
        'sourceUrl': product.get('sourceUrl'),
    }
    for field in ('inventaire', 'couleur', 'vin'):
        if product.get(field):
            unit[field] = product[field]
    return unit


def group_identical_products(
    products: List[Dict],
    *,
    dedupe_by_url: bool = True,
    dedupe_by_inventaire: bool = False,
    vin_split: bool = False,
) -> List[Dict]:
    """Déduplique puis regroupe les unités du même modèle.

    dedupe_by_url / dedupe_by_inventaire : passe 1 — éliminer la même page
    crawlée deux fois. vin_split : un VIN valide n'est jamais fusionné avec
    un autre (chaque VIN = son propre groupe, comportement St-Onge Ford).
    """
    unique: List[Dict] = products
    if dedupe_by_url or dedupe_by_inventaire:
        seen_urls: set = set()
        seen_inv: set = set()
        unique = []
        for product in products:
            url = str(product.get('sourceUrl') or '').rstrip('/')
            inv = str(product.get('inventaire') or '')
            if dedupe_by_url and url and url in seen_urls:
                continue
            if dedupe_by_inventaire and inv and inv in seen_inv:
                continue
            if url:
                seen_urls.add(url)
            if inv:
                seen_inv.add(inv)
            unique.append(product)

    groups: Dict[str, Dict] = {}
    group_units: Dict[str, List[Dict]] = {}

    for product in unique:
        vin = str(product.get('vin') or '').strip().upper()
        if vin_split and len(vin) >= 10:
            key = f"vin:{vin}"
        else:
            marque = str(product.get('marque') or '').lower().strip()
            modele = str(product.get('modele') or '').lower().strip()
            annee = product.get('annee', 0)
            etat = str(product.get('etat') or 'neuf').lower().strip()
            if marque and modele:
                key = f"{marque}|{modele}|{annee}|{etat}"
            else:
                key = f"name:{str(product.get('name') or '').lower().strip()}|{annee}|{etat}"

        if key not in groups:
            product['quantity'] = 1
            existing_urls = product.get('groupedUrls')
            if not existing_urls:
                product['groupedUrls'] = [product.get('sourceUrl', '')]
            groups[key] = product
            group_units[key] = [_unit_from_product(product)]
        else:
            group = groups[key]
            group['quantity'] = group.get('quantity', 1) + 1
            url = product.get('sourceUrl', '')
            if url:
                group.setdefault('groupedUrls', []).append(url)
            group_units[key].append(_unit_from_product(product))
            existing_price = group.get('prix')
            new_price = product.get('prix')
            if new_price:
                try:
                    if not existing_price or float(new_price) < float(existing_price):
                        group['prix'] = new_price
                except (ValueError, TypeError):
                    pass

    for key, group in groups.items():
        units = group_units[key]
        if len(units) >= 2:
            group['multi_unit'] = True
            group['units'] = units

    return list(groups.values())
