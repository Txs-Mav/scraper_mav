"""Publication d'un scraper généré par scraper_usine vers Supabase.

Une fois qu'un scraper est généré + validé (score ≥ seuil), on l'inscrit
dans la table ``shared_scrapers`` avec ``validation_status='pending'`` et
``is_active=false``. Le scraper apparaît alors dans la page admin
``/dashboard/admin/scrapers`` du dashboard où un développeur peut :

  - le tester en live,
  - l'approuver (passe à ``is_active=true`` → repris par le cron horaire),
  - le rejeter (reste en base mais désactivé).

Cette étape ne fait QUE la mise en base. Le scraper Python est déjà écrit
sur disque par ``generator.py`` et référencé dans ``_generated_registry.py``.

Variables d'environnement requises :
    SUPABASE_URL
    SUPABASE_SERVICE_ROLE_KEY  (bypass RLS)

Si les variables ne sont pas définies, la fonction ne fait rien et logue
un avertissement (utile en dev local sans accès Supabase).
"""
from __future__ import annotations

import json
import os
import re
from dataclasses import asdict
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional  # noqa: F401
from urllib.parse import urlparse

import requests

from .models import (
    GeneratedScraper, ScrapingStrategy, SiteAnalysis,
    ValidationReport, _to_serializable,
)
from .domain_profiles import get_profile

DEFAULT_PUBLISH_THRESHOLD = 95
PIPELINE_TAG = "scraper_usine"


def publish_pending_scraper(
    *,
    analysis: SiteAnalysis,
    strategy: ScrapingStrategy,
    generated: GeneratedScraper,
    report: ValidationReport,
    threshold: int = DEFAULT_PUBLISH_THRESHOLD,
    verbose: bool = True,
) -> Optional[Dict[str, Any]]:
    """Insère/met à jour la ligne ``shared_scrapers`` en mode pending.

    Returns:
        Le dict envoyé à Supabase si publié, ``None`` sinon (score insuffisant
        ou Supabase non configuré).
    """
    if report.score < threshold:
        if verbose:
            print(
                f"  [publisher] Score {report.score}/100 < {threshold} "
                f"— scraper NON publié dans shared_scrapers."
            )
        return None

    supabase_url = (
        os.environ.get("SUPABASE_URL")
        or os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    )
    service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not supabase_url or not service_key:
        if verbose:
            print(
                "  [publisher] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY absents — "
                "publication ignorée. Lance avec les bonnes variables d'env "
                "pour publier en pending."
            )
        return None

    payload = _build_payload(analysis, strategy, generated, report)

    headers = {
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=representation",
    }

    url = f"{supabase_url}/rest/v1/shared_scrapers"

    # Sur conflit (site_slug existant) on garde la stratégie d'écraser SAUF
    # validation_status si l'enregistrement actuel est déjà 'approved' ; on ne
    # veut pas casser un scraper en prod. On utilise une 2-step approche :
    #   1) fetch existing
    #   2) si existant approved → on update les colonnes techniques uniquement
    #      en gardant validation_status=approved et is_active inchangé
    #   3) sinon → upsert complet en pending
    existing = _fetch_existing(supabase_url, service_key, payload["site_slug"])
    if existing and existing.get("validation_status") == "approved":
        if verbose:
            print(
                f"  [publisher] {payload['site_slug']} déjà approuvé en prod — "
                f"mise à jour des colonnes techniques uniquement."
            )
        update_payload = {
            k: v for k, v in payload.items()
            if k not in {"validation_status", "is_active", "validated_at", "validated_by"}
        }
        update_payload["last_verified_at"] = update_payload.get("last_verified_at")
        return _patch_existing(
            supabase_url, service_key, payload["site_slug"], update_payload, verbose,
        )

    try:
        resp = requests.post(
            url,
            headers=headers,
            params={"on_conflict": "site_slug"},
            data=json.dumps(payload),
            timeout=30,
        )
    except requests.RequestException as e:
        if verbose:
            print(f"  [publisher] Échec réseau Supabase : {e}")
        return None

    if resp.status_code in (200, 201):
        if verbose:
            print(
                f"  [publisher] ✅ {payload['site_slug']} publié en PENDING dans "
                f"shared_scrapers (score {report.score}/100). "
                f"À valider via /dashboard/admin/scrapers."
            )
        return payload

    if verbose:
        print(
            f"  [publisher] ⚠️  Erreur Supabase {resp.status_code} : "
            f"{resp.text[:300]}"
        )
    return None


# ---------------------------------------------------------------------------
# Helpers privés
# ---------------------------------------------------------------------------

def _build_payload(
    analysis: SiteAnalysis,
    strategy: ScrapingStrategy,
    generated: GeneratedScraper,
    report: ValidationReport,
) -> Dict[str, Any]:
    now_iso = datetime.now(timezone.utc).isoformat()

    sample_products = report.sample_products or []
    listing_urls = _build_listing_urls(analysis)
    selectors_block = _build_selectors_block(analysis, strategy, sample_products)
    pagination_config = _build_pagination_config(analysis, strategy)
    vehicle_types = _extract_vehicle_types(analysis, report)
    extracted_fields = sorted({
        f.field_name for f in (report.field_details or []) if f.coverage > 0
    })

    domain = analysis.domain or _slug_to_domain(generated.slug, analysis.site_url)
    site_name = analysis.site_name or generated.slug.replace("-", " ").title()

    description = _build_description(
        analysis=analysis, strategy=strategy, report=report,
        site_name=site_name, vehicle_types=vehicle_types,
    )

    search_keywords = _build_search_keywords(
        slug=generated.slug, name=site_name, domain=domain,
        sample_products=sample_products, vehicle_types=vehicle_types,
    )

    validation_summary = {
        "score": report.score,
        "grade": report.grade,
        "products_tested": report.products_tested,
        "field_coverage": report.field_coverage,
        "warnings": report.warnings,
        "errors": report.errors[:5],
        "sample_products": sample_products[:3],
        "execution_time_seconds": report.execution_time_seconds,
        "strategy_used": report.strategy_used,
        "platform_detected": report.platform_detected,
        "validated_at": now_iso,
    }

    return {
        "site_name": site_name,
        "site_slug": generated.slug,
        "site_url": analysis.site_url,
        "site_domain": domain,
        "search_keywords": search_keywords,
        "scraper_module": generated.module_name,
        "selectors": selectors_block,
        "listing_urls": listing_urls,
        "pagination_config": pagination_config,
        "description": description,
        "categories": _detect_categories(listing_urls),
        "vehicle_types": vehicle_types,
        "extracted_fields": extracted_fields,
        "is_active": False,
        "validation_status": "pending",
        "validation_score": report.score,
        "validation_grade": report.grade,
        "validation_report": validation_summary,
        "submitted_by_pipeline": PIPELINE_TAG,
        "version": "1.0",
        "last_verified_at": now_iso,
    }


# ---------------------------------------------------------------------------
# Constructeurs des colonnes JSONB enrichies
# ---------------------------------------------------------------------------

def _build_listing_urls(analysis: SiteAnalysis) -> List[Dict[str, Any]]:
    """Construit la liste des URLs de listing en incluant les sitemaps détectés.

    Format compatible avec les SQL manuels (cf. migration_shared_scrapers_morin_sports.sql) :
        [
          {"url": "...", "type": "sitemap"},
          {"url": "...", "type": "listing", "category": "inventaire", "etat": "neuf"},
        ]
    """
    out: List[Dict[str, Any]] = []

    if analysis.sitemap_xml_url:
        out.append({"url": analysis.sitemap_xml_url, "type": "sitemap"})

    for lp in (analysis.listing_pages or []):
        entry: Dict[str, Any] = {
            "url": lp.url,
            "type": "listing",
        }
        if lp.source_categorie:
            entry["category"] = lp.source_categorie
        if lp.etat:
            entry["etat"] = lp.etat
        if lp.estimated_products:
            entry["estimated_products"] = lp.estimated_products
        out.append(entry)

    return out


def _build_selectors_block(
    analysis: SiteAnalysis, strategy: ScrapingStrategy,
    sample_products: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    """Construit le bloc `selectors` enrichi (discovery patterns, json_ld types,
    domaines alternatifs, sélecteurs CSS détaillés)."""
    sel = analysis.selectors or None
    selectors_csv = _to_serializable(asdict(sel)) if sel else {}

    profile = get_profile(analysis.domain_profile_key or "auto")

    discovery: Dict[str, Any] = {
        "method": strategy.discovery_method.value if strategy.discovery_method else "",
    }
    if analysis.sitemap_xml_url:
        discovery["sitemap_url"] = analysis.sitemap_xml_url

    # Concatène toutes les sources d'URLs disponibles pour détecter les patterns
    # canoniques. Les URLs des sample_products sont les plus représentatives
    # (vraies fiches produit), les listing_pages sont parfois trop génériques
    # (ex: '/fr/inventaire-neuf/' qui ne contient pas '/inventaire/' isolé).
    url_haystack_parts: List[str] = []
    for lp in (analysis.listing_pages or []):
        url_haystack_parts.append(lp.url.lower())
    for sample in (sample_products or [])[:10]:
        url = sample.get("sourceUrl") if isinstance(sample, dict) else None
        if isinstance(url, str):
            url_haystack_parts.append(url.lower())
    all_paths = " ".join(url_haystack_parts)

    if all_paths or analysis.listing_pages:
        discovery["filter_lang"] = "/fr/" if "fr" in analysis.language_versions else ""
        if "/inventaire/" in all_paths:
            discovery["filter_path"] = "/inventaire/"
        elif "/inventory/" in all_paths:
            discovery["filter_path"] = "/inventory/"
        if "a-vendre-" in all_paths:
            discovery["filter_marker"] = "a-vendre-"
        elif "-id-" in all_paths or re.search(r"-id\d+", all_paths):
            discovery["filter_marker"] = "-id"
        if "/neuf/" in all_paths or "/new/" in all_paths:
            discovery["neuf_pattern"] = "/neuf/" if "/neuf/" in all_paths else "/new/"
        for marker in ("/usage/", "/used/", "/occasion/", "/occasions/", "/usages/"):
            if marker in all_paths:
                discovery["occasion_pattern"] = marker
                break

    detail: Dict[str, str] = {}
    if sel:
        detail_map = {
            "title": sel.detail_name.selector,
            "brand": sel.detail_brand.selector,
            "model": sel.detail_model.selector,
            "year": sel.detail_year.selector,
            "mileage": sel.detail_mileage.selector,
            "vin": sel.detail_vin.selector,
            "color": sel.detail_color.selector,
            "image": sel.detail_image.selector,
            "price": sel.detail_price.selector,
            "description": sel.detail_description.selector,
        }
        detail = {k: v for k, v in detail_map.items() if v}
        # Champs supplémentaires (immo, jobs, etc.) du profil métier
        if hasattr(sel, "extra_fields") and sel.extra_fields:
            for fname, entry in sel.extra_fields.items():
                if entry and entry.selector and fname not in detail:
                    detail[fname] = entry.selector

    json_ld_block: Dict[str, Any] = {
        "available": bool(analysis.json_ld_available),
    }
    if analysis.json_ld_type:
        json_ld_block["type"] = analysis.json_ld_type
    if profile.jsonld_types:
        json_ld_block["accepted_types"] = list(profile.jsonld_types)

    block: Dict[str, Any] = {
        "discovery": discovery,
        "detail": detail,
        "json_ld": json_ld_block,
        "domains": _extract_alt_domains(analysis),
    }
    if selectors_csv:
        block["raw_selectors"] = selectors_csv

    return block


def _build_pagination_config(
    analysis: SiteAnalysis, strategy: ScrapingStrategy,
) -> Dict[str, Any]:
    """Bloc pagination_config enrichi avec une note humaine."""
    method = strategy.pagination_method.value if strategy.pagination_method else ""
    rendering = strategy.rendering.value if strategy.rendering else ""
    discovery = strategy.discovery_method.value if strategy.discovery_method else ""
    extraction = strategy.extraction_method.value if strategy.extraction_method else ""

    notes: List[str] = []
    if discovery == "sitemap":
        notes.append("Découverte via sitemap XML (live à chaque exécution).")
    elif discovery == "listing":
        notes.append("Découverte via pages de listing paginées.")
    elif discovery in ("api", "scroll_intercept"):
        notes.append("Découverte via API interne capturée par Playwright.")

    if rendering == "playwright":
        notes.append("Rendering Playwright requis (SPA/JavaScript).")
    if analysis.warm_up_required:
        notes.append("Warm-up de session nécessaire avant pagination.")
    if analysis.has_iframe_inventory:
        notes.append("Inventaire dans un iframe tiers.")

    config: Dict[str, Any] = {
        "method": method,
        "rendering": rendering,
        "discovery": discovery,
        "extraction": extraction,
    }
    if analysis.sitemap_xml_url:
        config["sitemap_url"] = analysis.sitemap_xml_url
    if strategy.api_config and strategy.api_config.url:
        config["api_url"] = strategy.api_config.url
        config["api_method"] = strategy.api_config.method
    if notes:
        config["note"] = " ".join(notes)

    return config


def _extract_vehicle_types(analysis: SiteAnalysis, report: ValidationReport) -> List[str]:
    """Déduit les types de véhicules depuis :
      1. Les segments d'URL des sample_products (/motocyclette/, /vtt/, etc.)
      2. Les URLs sitemap si dispo
      3. Le DomainProfile (fallback générique)
    """
    profile = get_profile(analysis.domain_profile_key or "auto")
    if profile.domain_type.value != "auto":
        # Pour les profils non-vehicules (ecommerce/jobs/immo), pas de vehicle_types
        return []

    type_keywords = {
        "moto": ["motocyclette", "motorcycle", "moto"],
        "scooter": ["scooter"],
        "vtt": ["vtt", "atv", "quad"],
        "cote-a-cote": ["cote-a-cote", "side-by-side", "sxs", "utv"],
        "motoneige": ["motoneige", "snowmobile"],
        "motomarine": ["motomarine", "personal-watercraft", "pwc"],
        "bateau": ["bateau", "boat"],
        "ponton": ["ponton", "pontoon"],
        "moteur-hors-bord": ["moteur-hors-bord", "outboard"],
        "remorque": ["remorque", "trailer"],
        "velo-electrique": ["velo-electrique", "e-bike"],
        "auto": ["auto", "automobile", "car", "voiture"],
        "camion": ["camion", "truck", "pickup"],
        "vus": ["vus", "suv"],
        "equipement-mecanique": ["equipement-mecanique", "power-equipment"],
    }

    found: set[str] = set()
    haystack_parts: List[str] = []

    for lp in (analysis.listing_pages or []):
        haystack_parts.append(lp.url.lower())

    for sample in (report.sample_products or [])[:10]:
        url = str(sample.get("sourceUrl", "")).lower()
        if url:
            haystack_parts.append(url)
        vt = sample.get("vehicule_type")
        if vt:
            haystack_parts.append(str(vt).lower())

    haystack = " ".join(haystack_parts)
    if not haystack:
        return []

    for canonical, keywords in type_keywords.items():
        if any(f"/{kw}/" in haystack or f" {kw} " in haystack or f"-{kw}-" in haystack
               for kw in keywords):
            found.add(canonical)

    return sorted(found)


def _build_description(
    *, analysis: SiteAnalysis, strategy: ScrapingStrategy,
    report: ValidationReport, site_name: str, vehicle_types: List[str],
) -> str:
    """Construit une description humaine concise (≤ 300 chars) avec contexte."""
    parts: List[str] = []

    if vehicle_types:
        readable = {
            "moto": "motos", "scooter": "scooters", "vtt": "VTT",
            "cote-a-cote": "côte-à-côte", "motoneige": "motoneiges",
            "motomarine": "motomarines", "bateau": "bateaux", "ponton": "pontons",
            "moteur-hors-bord": "moteurs hors-bord", "remorque": "remorques",
            "velo-electrique": "vélos électriques",
            "auto": "automobiles", "camion": "camions", "vus": "VUS",
            "equipement-mecanique": "équipement mécanique",
        }
        labels = [readable.get(vt, vt) for vt in vehicle_types[:5]]
        if len(labels) > 1:
            label_str = ", ".join(labels[:-1]) + " et " + labels[-1]
        else:
            label_str = labels[0]
        parts.append(f"Concessionnaire {label_str}.")

    if analysis.platform and analysis.platform.name and analysis.platform.platform_type.value != "generic":
        parts.append(f"Plateforme {analysis.platform.name}.")

    nb_estimated = sum(lp.estimated_products for lp in (analysis.listing_pages or []))
    if nb_estimated:
        parts.append(f"~{nb_estimated} produits détectés à l'analyse.")

    parts.append(
        f"Scraper généré par scraper_usine ({strategy.discovery_method.value if strategy.discovery_method else 'n/a'}"
        f" + {strategy.extraction_method.value if strategy.extraction_method else 'n/a'})."
    )

    desc = " ".join(parts)
    return desc[:500]


def _build_search_keywords(
    *, slug: str, name: str, domain: str,
    sample_products: List[Dict[str, Any]], vehicle_types: List[str],
) -> List[str]:
    """Mots-clés enrichis pour la barre de recherche du dashboard.

    Combine :
      - mots du slug
      - mots du nom du site (sans suffixe corporate)
      - domaine sans .com/.ca
      - marques détectées dans les sample_products
      - types de véhicules canoniques
    """
    bag: set[str] = set()

    # Slug + nom
    for token in re.split(r"[-_\s]+", f"{slug} {name}".lower()):
        token = token.strip()
        if len(token) > 1 and token.isascii():
            bag.add(token)

    # Domaine sans extension
    if domain:
        d_low = domain.lower().replace("www.", "")
        bag.add(d_low)
        # Sans extension principale
        d_clean = re.sub(r"\.(com|ca|net|org|fr|qc\.ca|info|biz)$", "", d_low)
        if d_clean and d_clean != d_low:
            bag.add(d_clean)

    # Marques depuis les samples (top 10 produits)
    for sample in sample_products[:10]:
        marque = sample.get("marque")
        if marque and isinstance(marque, str) and len(marque) > 1:
            bag.add(marque.lower().strip())

    # Types de véhicules
    bag.update(vehicle_types)

    # Filtrer mots vides classiques
    stop = {"sport", "sports", "inc", "ltd", "ltée", "le", "la", "les",
            "de", "du", "des", "et", "and", "the", "a", "an"}
    bag = {w for w in bag if w not in stop}

    return sorted(bag)


def _extract_alt_domains(analysis: SiteAnalysis) -> List[str]:
    """Liste des domaines alternatifs (cf. SITE_DOMAIN_ALT dans les scrapers manuels).

    Détectés depuis :
      - Le domaine principal `analysis.domain`
      - Les `language_versions` qui pointent vers d'autres hôtes
      - Les sitemaps qui pointent vers d'autres domaines
    """
    seen: set[str] = set()
    domains: List[str] = []

    def _add(d: str) -> None:
        if not d:
            return
        clean = d.replace("www.", "").lower()
        if clean and clean not in seen:
            seen.add(clean)
            domains.append(clean)

    _add(analysis.domain)
    for url in (analysis.language_versions or {}).values():
        _add(urlparse(url).netloc)
    if analysis.sitemap_xml_url:
        _add(urlparse(analysis.sitemap_xml_url).netloc)

    return domains


def _detect_categories(listing_urls: List[Dict[str, Any]]) -> List[str]:
    cats: set[str] = set()
    for entry in listing_urls:
        cat = entry.get("category")
        if cat:
            cats.add(cat)
    return sorted(cats)


def _slug_to_domain(slug: str, fallback_url: str) -> str:
    try:
        host = urlparse(fallback_url).netloc.replace("www.", "")
        if host:
            return host
    except Exception:
        pass
    return slug.replace("-", "")


def _fetch_existing(
    supabase_url: str, service_key: str, slug: str,
) -> Optional[Dict[str, Any]]:
    try:
        resp = requests.get(
            f"{supabase_url}/rest/v1/shared_scrapers",
            headers={
                "apikey": service_key,
                "Authorization": f"Bearer {service_key}",
            },
            params={"site_slug": f"eq.{slug}", "select": "*"},
            timeout=15,
        )
        if resp.status_code == 200:
            rows = resp.json() or []
            return rows[0] if rows else None
    except requests.RequestException:
        return None
    return None


def _patch_existing(
    supabase_url: str,
    service_key: str,
    slug: str,
    payload: Dict[str, Any],
    verbose: bool,
) -> Optional[Dict[str, Any]]:
    try:
        resp = requests.patch(
            f"{supabase_url}/rest/v1/shared_scrapers",
            headers={
                "apikey": service_key,
                "Authorization": f"Bearer {service_key}",
                "Content-Type": "application/json",
                "Prefer": "return=representation",
            },
            params={"site_slug": f"eq.{slug}"},
            data=json.dumps(payload),
            timeout=30,
        )
    except requests.RequestException as e:
        if verbose:
            print(f"  [publisher] Échec patch Supabase : {e}")
        return None

    if resp.status_code in (200, 201, 204):
        if verbose:
            print(f"  [publisher] ✅ {slug} : colonnes techniques mises à jour.")
        return payload

    if verbose:
        print(
            f"  [publisher] ⚠️  Erreur patch Supabase {resp.status_code} : "
            f"{resp.text[:300]}"
        )
    return None
