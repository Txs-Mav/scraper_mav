"""
Détection de variantes de templates de fiche détail (P2.2).

Beaucoup de sites servent plusieurs structures DOM différentes pour leurs pages
de fiche : véhicules récents vs anciens, catalogue interne vs partenaires, fiches
A/B testées, etc. Un sélecteur unique extrait alors un sous-ensemble seulement
des champs.

Ce module échantillonne 10-20 fiches détail, calcule pour chacune une signature
DOM stable, puis clusterise via Jaccard ≥ 0.7. Si un seul cluster sort → cas
nominal, comportement actuel inchangé. Si > 1 cluster, le générateur peut
produire un dispatcher (P2.2-bis).
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Callable, Dict, List, Optional, Set, Tuple

from bs4 import BeautifulSoup, Tag

from .models import DetailTemplateCluster


# Seuil de similarité Jaccard pour fusionner deux signatures dans le même cluster.
JACCARD_THRESHOLD = 0.70

# Nombre min/max de fiches détail à échantillonner. En dessous de MIN_SAMPLES,
# on ne lance pas le clustering (résultat trop bruité).
MIN_SAMPLES = 4
MAX_SAMPLES = 20


def cluster_detail_templates(
    detail_urls: List[str],
    fetch_html: Callable[[str], Optional[str]],
    *,
    log_fn: Optional[Callable[[str], None]] = None,
    jaccard_threshold: float = JACCARD_THRESHOLD,
    min_samples: int = MIN_SAMPLES,
    max_samples: int = MAX_SAMPLES,
) -> List[DetailTemplateCluster]:
    """Clusterise un échantillon de fiches détail par similarité de structure DOM.

    Args:
        detail_urls : URLs de fiches détail à échantillonner. On en consomme
            jusqu'à ``max_samples``.
        fetch_html : callback qui retourne le HTML brut d'une URL (ou None
            en cas d'échec). Permet à l'analyzer d'injecter sa propre session
            (avec cookies / headers stealth) sans coupler ce module à requests.
        jaccard_threshold : similarité Jaccard minimale entre deux signatures
            pour les considérer dans le même cluster.
        min_samples : nombre minimal de fiches valides pour produire un résultat.

    Returns:
        Liste de ``DetailTemplateCluster``. Vide si l'échantillon est trop maigre.
        Avec un seul cluster, le caller peut continuer le flux nominal sans
        rien changer (équivalent au comportement pré-P2.2).
    """
    log = log_fn or (lambda _msg: None)

    if not detail_urls:
        return []

    # Échantillonne jusqu'à max_samples URLs. On essaie de varier les URLs
    # (un sample uniformément réparti dans la liste) pour ne pas tomber sur
    # 20 fiches consécutives d'une seule catégorie.
    sample = _evenly_spaced_sample(detail_urls, max_samples)

    fetched: List[Tuple[str, str]] = []
    for url in sample:
        try:
            html = fetch_html(url)
        except Exception as e:
            log(f"      template_clusters: fetch échoué pour {url[:70]}: {type(e).__name__}: {e}")
            continue
        if html and len(html) > 1000:
            fetched.append((url, html))
        if len(fetched) >= max_samples:
            break

    if len(fetched) < min_samples:
        log(f"      template_clusters: échantillon trop maigre ({len(fetched)} < {min_samples}) — skip")
        return []

    # Calcule une signature DOM pour chaque fiche
    signatures: List[Tuple[str, Set[str]]] = []  # (url, signature_set)
    for url, html in fetched:
        try:
            soup = BeautifulSoup(html, "lxml")
        except Exception:
            continue
        sig = _detail_signature(soup)
        if sig:
            signatures.append((url, sig))

    if len(signatures) < min_samples:
        return []

    # Clusterise par Jaccard ≥ seuil. Algo simple : pour chaque signature, on
    # la rattache au premier cluster existant dont le centroïde dépasse le seuil,
    # sinon on crée un nouveau cluster. Suffisant pour 10-20 fiches.
    clusters: List[List[Tuple[str, Set[str]]]] = []
    for url, sig in signatures:
        attached = False
        for cluster in clusters:
            centroid = _centroid_signature(cluster)
            if _jaccard(sig, centroid) >= jaccard_threshold:
                cluster.append((url, sig))
                attached = True
                break
        if not attached:
            clusters.append([(url, sig)])

    # Trie les clusters par taille décroissante (le template le plus fréquent en premier)
    clusters.sort(key=lambda c: len(c), reverse=True)

    out: List[DetailTemplateCluster] = []
    for idx, cluster in enumerate(clusters):
        # On ignore les clusters singleton car probablement du bruit (page d'erreur,
        # fiche atypique). À 2 fiches on commence à considérer comme variant légitime.
        if len(cluster) < 2 and len(clusters) > 1:
            continue
        centroid = _centroid_signature(cluster)
        out.append(DetailTemplateCluster(
            template_id=f"tpl_{chr(ord('a') + idx)}",
            sample_urls=[url for url, _ in cluster][:5],
            signature_keys=sorted(centroid),
            item_count=len(cluster),
            selectors=None,
        ))

    log(f"      template_clusters: {len(out)} cluster(s) sur {len(signatures)} fiches "
        f"({', '.join(f'{c.template_id}={c.item_count}' for c in out)})")
    return out


# ---------------------------------------------------------------------------
# Signature DOM
# ---------------------------------------------------------------------------

# On capture des "clés" stables qui caractérisent un template : data-attributes
# sur les conteneurs principaux, classes du <main>/<article>/<section>, présence
# de blocs structurants (tableaux specs, listes dl, galleries…). On évite les
# classes hashées (CSS-in-JS) et le contenu textuel pour rester insensible aux
# valeurs.

_RANDOM_CLASS = re.compile(r"^[a-z0-9_-]{16,}$|^[A-Za-z]+__[A-Za-z0-9]{6,}$|^css-")
_DATA_ATTR = re.compile(r"^data-[a-z][a-z0-9-]+$")


def _detail_signature(soup: BeautifulSoup) -> Set[str]:
    """Construit l'ensemble des clés caractéristiques d'une fiche détail."""
    keys: Set[str] = set()

    # Conteneurs principaux et leurs classes (dépouillées des hashes CSS-in-JS)
    for sel in ("main", "article", "section[class]", "[role='main']",
                ".product", ".vehicle", ".vdp", ".product-detail",
                ".product-info", ".product-page", ".vehicle-detail"):
        try:
            els = soup.select(sel)
        except Exception:
            continue
        for el in els[:3]:
            keys.add(f"tag:{el.name}")
            for cls in (el.get("class") or [])[:5]:
                if cls and not _RANDOM_CLASS.match(cls):
                    keys.add(f"cls:{cls.lower()}")

    # data-* attributes du <body> et conteneurs principaux : très stables et
    # caractéristiques (data-product-id, data-vehicle-vin, data-template, …).
    for el in soup.select("body, main, article, [data-template], [data-page-type]")[:10]:
        for attr in (el.attrs or {}):
            if _DATA_ATTR.match(attr):
                keys.add(f"attr:{attr.lower()}")

    # Squelette structural : présence de blocs typiques d'une fiche détail.
    if soup.find("h1"):
        keys.add("struct:h1")
    keys.add(f"struct:dl-{min(len(soup.find_all('dl')), 3)}")
    keys.add(f"struct:table-{min(len(soup.find_all('table')), 3)}")
    keys.add(f"struct:section-{min(len(soup.find_all('section')), 5)}")

    # JSON-LD types présents : un fort signal de format
    for script in soup.find_all("script", type="application/ld+json"):
        raw = (script.string or "")[:4000].lower()
        for jt in ("vehicle", "car", "automotivevehicle", "product",
                   "individualproduct", "residence", "house", "jobposting"):
            if f'"@type":"{jt}"' in raw.replace(" ", "") or f"'@type':'{jt}'" in raw.replace(" ", ""):
                keys.add(f"jsonld:{jt}")

    return keys


def _jaccard(a: Set[str], b: Set[str]) -> float:
    if not a and not b:
        return 1.0
    inter = len(a & b)
    union = len(a | b)
    return inter / union if union else 0.0


def _centroid_signature(cluster: List[Tuple[str, Set[str]]]) -> Set[str]:
    """Centroïde = clés présentes dans au moins 50% des signatures du cluster."""
    if not cluster:
        return set()
    if len(cluster) == 1:
        return set(cluster[0][1])
    counts: Dict[str, int] = {}
    for _, sig in cluster:
        for key in sig:
            counts[key] = counts.get(key, 0) + 1
    threshold = max(1, len(cluster) // 2)
    return {k for k, n in counts.items() if n >= threshold}


def _evenly_spaced_sample(items: List[str], n: int) -> List[str]:
    """Retourne n éléments répartis uniformément dans la liste (préserve l'ordre).
    Si len(items) <= n, retourne tout."""
    if not items or n <= 0:
        return []
    if len(items) <= n:
        return list(items)
    step = len(items) / n
    return [items[int(i * step)] for i in range(n)]
