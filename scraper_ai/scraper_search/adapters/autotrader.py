"""
AutoTraderAdapter — AutoTrader.ca via SERP rendue.

Anti-bot : Incapsula (Imperva). HTTP direct → page de challenge JS.
Stratégie : Playwright stealth + parsing multi-stratégies en cascade.

Stratégies de parsing essayées dans l'ordre :
    1. Cards `[data-testid="list-item"]` avec data-attributes (make/model/price/…)
       — le plus fiable historiquement, mais data-testid change parfois.
    2. `__NEXT_DATA__` SSR — JSON Next.js injecté côté serveur.
    3. JSON-LD `ItemList` avec listings `Vehicle` ou `Car` — utilisé par
       AutoTrader pour le SEO, contient prix/année/modèle.
    4. Anchors vers `/a/{make}/{model}/...` ou `/offers/...` (forme ancienne)
       avec extraction du contexte parent — ultime filet de sécurité.

Si TOUTES les stratégies échouent, on dumpe l'HTML dans `/tmp/at_debug_*.html`
quand `AUTOTRADER_DEBUG_DUMP=1` pour permettre un audit manuel rapide.
"""
from __future__ import annotations

import json
import os
import re
import sys
import time
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import quote_plus, urljoin, urlparse

from ..models import SearchQuery
from ._browser_serp_base import BrowserSerpAdapter


# Markers Incapsula plus précis (en plus des markers génériques de la base).
_INCAPSULA_MARKERS = (
    "_incapsula_resource",
    "/_incapsula_resource",
    "incap_ses_",
    "imperva",
    "request unsuccessful. incapsula",
)


class AutoTraderAdapter(BrowserSerpAdapter):
    name = "AutoTrader.ca"
    site_url = "https://www.autotrader.ca"
    serves_categories: List[str] = ["vehicule.auto"]

    marketplace_hint = ""
    item_selector = "[data-testid='list-item']"
    # Wait plus long : Incapsula peut ajouter 3-6s, et la SERP React met
    # encore 1-2s à hydrater les cards. On donne 30s + un post-load généreux.
    default_timeout_ms = 30000
    # Incapsula peut tenir un challenge JS jusqu'à 4-5s avant d'émettre le
    # cookie de session et de servir la SERP — on tolère un networkidle long.
    networkidle_ms = 4500
    post_load_wait_ms = 3000
    scroll_on_load = True
    max_scrolls = 2

    def __init__(self, **kwargs):
        super().__init__(use_proxy_env="AUTOTRADER_PROXY_URL", **kwargs)

    def _build_url(self, query: SearchQuery, text: str, *, page: int = 1) -> str:
        # AutoTrader.ca attend des IDs internes pour `mak`/`mdl` (ex: mak=2 pour
        # Honda), pas les noms textuels — utiliser ces paramètres avec les noms
        # produit une SERP vide. On s'appuie donc systématiquement sur le
        # keyword search (`kwd`) qui accepte du texte libre et matche sur
        # marque + modèle + variantes.
        kw_parts: List[str] = []
        if query.marque:
            kw_parts.append(query.marque)
        if query.modele:
            kw_parts.append(query.modele)
        for kw in query.keywords or []:
            if kw and kw not in kw_parts:
                kw_parts.append(kw)
        keyword = " ".join(kw_parts).strip() or (text or "").strip()

        params: List[str] = ["srt=4"]  # tri par date de listing (plus récent)
        if keyword:
            params.append(f"kwd={quote_plus(keyword)}")
        if query.annee:
            params.append(f"yRng={query.annee}%2C{query.annee}")
        elif query.annee_min or query.annee_max:
            lo = query.annee_min or 1900
            hi = query.annee_max or 2100
            params.append(f"yRng={lo}%2C{hi}")
        if query.prix_max:
            params.append(f"prx={int(query.prix_max)}")
        if query.prix_min:
            params.append(f"prMn={int(query.prix_min)}")
        params.append(f"pg={page}")
        return f"https://www.autotrader.ca/cars/?{'&'.join(params)}"

    # ------------------------------------------------------------------
    # Orchestration parsing (cascade)
    # ------------------------------------------------------------------

    def _parse_listing(self, html: str, *, base_url: str) -> List[Dict[str, Any]]:
        # Détection Incapsula plus précise — la base capte 'incapsula_resource'
        # mais on log ici si on a la signature même sur un HTML "court".
        if self._has_incapsula_signature(html):
            self._log(f"Incapsula signature détectée sur {base_url} (challenge JS non résolu)")

        strategies: List[Tuple[str, List[Dict[str, Any]]]] = []

        # 1) Cards `[data-testid="list-item"]` avec data-attributes
        try:
            cards = self._parse_listing_cards(html, base_url=base_url)
        except Exception as e:
            cards = []
            self._log(f"Stratégie 1 (data-testid cards) a levé : {type(e).__name__}: {e}")
        strategies.append(("data-testid cards", cards))

        # 2) __NEXT_DATA__ SSR
        try:
            nd = self._parse_next_data(html, base_url=base_url)
        except Exception as e:
            nd = []
            self._log(f"Stratégie 2 (__NEXT_DATA__) a levé : {type(e).__name__}: {e}")
        strategies.append(("__NEXT_DATA__", nd))

        # 3) JSON-LD ItemList / Vehicle / Car
        try:
            jsonld = self._parse_jsonld(html, base_url=base_url)
        except Exception as e:
            jsonld = []
            self._log(f"Stratégie 3 (JSON-LD) a levé : {type(e).__name__}: {e}")
        strategies.append(("JSON-LD", jsonld))

        # 4) Fallback : anchors vers /a/ ou /offers/
        try:
            anchors = self._parse_listing_anchors(html, base_url=base_url)
        except Exception as e:
            anchors = []
            self._log(f"Stratégie 4 (anchors) a levé : {type(e).__name__}: {e}")
        strategies.append(("anchors /a/ /offers/", anchors))

        # Log résumé : combien chaque stratégie a trouvé
        summary = ", ".join(f"{name}={len(items)}" for name, items in strategies)
        self._log(f"Stratégies de parsing → {summary}")

        # On choisit la 1re stratégie qui rend ≥ 1 listing.
        for name, items in strategies:
            if items:
                self._log(f"Sélection : {name} ({len(items)} listings)")
                return self._post_process(items, base_url=base_url)

        # Toutes les stratégies ont échoué — dump optionnel + retour vide.
        self._dump_debug_html(html, base_url)
        snippet = (html[:300] if html else "").replace("\n", " ")
        print(
            f"[AutoTraderAdapter] 0 listings trouvés sur {base_url} "
            f"(html_len={len(html)}, preview={snippet[:160]!r})",
            file=sys.stderr,
        )
        return []

    # ------------------------------------------------------------------
    # Helpers debug / logging
    # ------------------------------------------------------------------

    def _log(self, msg: str) -> None:
        print(f"[AutoTraderAdapter] {msg}", file=sys.stderr)

    def _dump_debug_html(self, html: str, base_url: str) -> None:
        if not os.getenv("AUTOTRADER_DEBUG_DUMP"):
            return
        try:
            ts = int(time.time())
            path = f"/tmp/at_debug_{ts}.html"
            with open(path, "w", encoding="utf-8") as f:
                f.write(html)
            self._log(f"HTML dumpé pour debug → {path} (url={base_url})")
        except Exception as e:
            self._log(f"Échec du dump debug : {type(e).__name__}: {e}")

    @staticmethod
    def _has_incapsula_signature(html: str) -> bool:
        if not html:
            return False
        h = html[:20000].lower()
        return any(m in h for m in _INCAPSULA_MARKERS)

    # ------------------------------------------------------------------
    # Stratégie 1 : Cards `[data-testid='list-item']` (historique)
    # ------------------------------------------------------------------

    def _parse_listing_cards(self, html: str, *, base_url: str) -> List[Dict[str, Any]]:
        """Extrait les listings depuis les cards `[data-testid='list-item']`.

        Chaque card AutoTrader expose les métadonnées du véhicule en data
        attributes (data-make, data-model, data-model-year, data-price,
        data-mileage, data-vehicle-state…), ce qui est plus stable que le
        parsing du JSON `__NEXT_DATA__`.
        """
        try:
            from bs4 import BeautifulSoup
        except ImportError:
            return []

        soup = BeautifulSoup(html, "html.parser")
        cards = soup.select(self.item_selector)
        if not cards:
            return []

        out: List[Dict[str, Any]] = []
        for card in cards:
            make = (card.get("data-make") or "").strip()
            model = (card.get("data-model") or "").strip()
            year = self._safe_int(card.get("data-model-year"))
            price = self._safe_float(card.get("data-price"))
            mileage = self._safe_int(card.get("data-mileage"))
            state = (card.get("data-vehicle-state") or "").strip().lower()

            # URL canonique : 1er <a> avec un href absolu vers /offers/ ou /a/
            url: Optional[str] = None
            anchor = card.find("a", href=True)
            if anchor:
                href = anchor.get("href", "").strip()
                if href:
                    url = href if href.startswith("http") else urljoin(base_url, href)

            # On garde les cards qui ont au minimum marque + modèle + URL.
            # Les cards de pub (sans data-make) sont filtrées automatiquement.
            if not (make and model and url):
                continue

            image = self._extract_image(card, base_url=base_url)

            trim_section = self._extract_trim_from_url(url, make=make, model=model)

            name_parts: List[str] = []
            if year:
                name_parts.append(str(year))
            if make:
                name_parts.append(make.title())
            if model:
                name_parts.append(model.title())
            if trim_section:
                name_parts.append(trim_section)
            name = " ".join(name_parts).strip()
            if not name:
                anchors = card.find_all("a", href=True)
                if len(anchors) >= 2:
                    name = anchors[1].get_text(strip=True)[:120]
            if not name:
                continue

            etat = "neuf" if state == "new" else "occasion"

            out.append({
                "name": name,
                "marque": make.title() if make else None,
                "modele": model.title() if model else None,
                "annee": year,
                "prix": price,
                "kilometrage": mileage,
                "currency": "CAD",
                "image": image or "",
                "sourceUrl": url,
                "etat": etat,
            })

        return out

    # Mots du slug AutoTrader qui marquent la fin du trim / début des "options"
    # ou de la "queue" (couleur, transmission, sellier, GUID). Tout ce qui vient
    # APRÈS est considéré comme bruit pour l'extraction du trim.
    _TRIM_STOPWORDS = {
        "gasoline", "gas", "diesel", "electric", "hybrid", "plug",
        "phev", "ev", "fuel", "petrol", "essence", "hybride",
        "automatic", "manual", "manuelle", "automatique",
        "black", "white", "grey", "gray", "silver", "red", "blue", "green",
        "yellow", "orange", "purple", "brown", "beige", "gold", "tan",
        "noir", "blanc", "gris", "rouge", "bleu", "vert", "argent",
        "4wd", "awd", "rwd", "fwd", "2wd", "4x4", "4x2",
        "one", "owner", "accident", "free", "carfax", "certified", "low",
        "kms", "miles", "warranty", "call", "now", "wow", "must", "see",
        "clean", "title", "no", "new", "used", "best", "deal", "rare",
        "fully", "loaded", "mint", "condition", "great", "price", "good",
        "excellent", "perfect", "like", "with", "and", "the", "for",
        "sieges", "chauffants", "bluetooth", "camera", "navigation",
    }

    @classmethod
    def _extract_trim_from_url(cls, url: str, *, make: str, model: str) -> str:
        """Extrait la portion `{trim} {options}` depuis le slug AutoTrader.

        AutoTrader.ca construit ses URLs comme :
            /offers/{make}-{model}-{trim}-{options}-{fuel}-{color}-{guid}
            /a/{make}/{model}/{...}-{trim}-{...}     (forme plus récente)

        On isole tout ce qui se trouve entre le `model` et le 1er stopword
        (carburant, transmission, couleur, GUID).
        """
        if not url:
            return ""
        try:
            path = urlparse(url).path
        except Exception:
            path = url

        slug = path.rsplit("/", 1)[-1] if "/" in path else path
        slug = slug.lower().strip("-").strip()
        if not slug:
            return ""

        tokens = [t for t in slug.split("-") if t]
        if not tokens:
            return ""

        make_tokens = (make or "").lower().split() if make else []
        model_tokens = (model or "").lower().replace("-", " ").split() if model else []
        skip = set()
        idx = 0
        for needed in make_tokens + model_tokens:
            found = False
            for j in range(idx, min(idx + 4, len(tokens))):
                if tokens[j] == needed or tokens[j].startswith(needed[:3]):
                    skip.add(j)
                    idx = j + 1
                    found = True
                    break
            if not found:
                break

        trim_tokens: List[str] = []
        for i, tok in enumerate(tokens):
            if i in skip:
                continue
            if tok in cls._TRIM_STOPWORDS:
                break
            if len(tok) >= 8 and all(c in "0123456789abcdef" for c in tok):
                break
            trim_tokens.append(tok)
            if len(trim_tokens) >= 6:
                break

        if not trim_tokens:
            return ""

        out: List[str] = []
        for tok in trim_tokens:
            if len(tok) <= 3 and tok.isalpha():
                out.append(tok.upper())
            elif tok.isdigit() or (len(tok) <= 4 and any(c.isdigit() for c in tok)):
                out.append(tok.upper())
            else:
                out.append(tok.title())
        return " ".join(out)

    # ------------------------------------------------------------------
    # Extraction d'images — robuste face au lazy-loading
    # ------------------------------------------------------------------
    #
    # AutoTrader sert ses cards via Next.js Image (`next/image`), ce qui
    # produit du markup du type :
    #
    #   <picture>
    #     <source type="image/webp" srcset="https://cdn…/v1.webp 1x, …/v2.webp 2x">
    #     <img loading="lazy"
    #          src="data:image/svg+xml;base64,PHN2Zy…"      ← PLACEHOLDER
    #          data-src="https://cdn…/v1.jpg"
    #          srcset="…/v1.jpg 640w, …/v2.jpg 1080w">
    #   </picture>
    #
    # On tourne avec `block_assets=True` dans Playwright (cf. _browser_serp_base) :
    # les requêtes images sont bloquées et les lazy-loaders JS ne swappent
    # jamais `src` → on doit aller chercher l'URL réelle dans `srcset`,
    # `data-src`, `data-srcset`, `data-original`, etc. Sinon on remonte le
    # placeholder data:image/svg+xml qui est inutilisable côté front.
    #
    # `_PLACEHOLDER_MARKERS` détecte les URLs qu'on doit ignorer (data URIs,
    # gifs transparents 1×1, sentinelles textuelles « placeholder », « blank »).

    _PLACEHOLDER_MARKERS = (
        "data:image/",
        "data:application/",
        "blank.gif",
        "transparent.gif",
        "placeholder",
        "spacer.gif",
        "1x1.gif",
        "pixel.gif",
    )

    @classmethod
    def _is_valid_image_url(cls, url: str) -> bool:
        if not url:
            return False
        u = url.strip().lower()
        if not u:
            return False
        for marker in cls._PLACEHOLDER_MARKERS:
            if marker in u:
                return False
        return True

    @classmethod
    def _pick_srcset_url(cls, srcset: str) -> str:
        """Renvoie la meilleure URL d'un attribut `srcset`.

        On préfère la plus haute résolution (dernière entrée d'un srcset
        Next.js classique `…?w=384 1x, …?w=640 2x, …?w=1080 3x`) car elle
        rend bien dans une grille de cards. Si la dernière n'est pas valide
        (placeholder), on tombe sur la précédente, etc.
        """
        if not srcset:
            return ""
        candidates: List[str] = []
        for chunk in srcset.split(","):
            url = chunk.strip().split(" ", 1)[0].strip()
            if url:
                candidates.append(url)
        # Préférer haute résolution (fin du srcset), puis fallback début
        for url in reversed(candidates):
            if cls._is_valid_image_url(url):
                return url
        for url in candidates:
            if cls._is_valid_image_url(url):
                return url
        return ""

    @staticmethod
    def _absolutize(url: str, base_url: str) -> str:
        if not url:
            return ""
        url = url.strip()
        if url.startswith("//"):
            return "https:" + url
        if url.startswith("http"):
            return url
        if base_url:
            return urljoin(base_url, url)
        return url

    @classmethod
    def _extract_image(cls, scope, *, base_url: str = "") -> str:
        """Extrait l'URL de la 1re image utilisable depuis un noeud BS4.

        Ordre de priorité :
          1. `<source srcset>` (les `<picture>` ont l'URL définitive même
             sous lazy-loading agressif).
          2. Sur `<img>` : `srcset` / `data-srcset` (multi-résolution).
          3. Sur `<img>` : attributs data-* connus avant `src` (pour éviter
             les placeholders data:image/...).
          4. Sur `<img>` : `src` en dernier recours.
        """
        for source in scope.find_all("source"):
            url = cls._pick_srcset_url(source.get("srcset") or "")
            if cls._is_valid_image_url(url):
                return cls._absolutize(url, base_url)

        for img in scope.find_all("img"):
            for attr in ("srcset", "data-srcset"):
                url = cls._pick_srcset_url(img.get(attr) or "")
                if cls._is_valid_image_url(url):
                    return cls._absolutize(url, base_url)
            for attr in (
                "data-src",
                "data-lazy-src",
                "data-original",
                "data-image",
                "data-lazy",
                "src",
            ):
                url = (img.get(attr) or "").strip()
                if cls._is_valid_image_url(url):
                    return cls._absolutize(url, base_url)
        return ""

    @staticmethod
    def _safe_int(value: Any) -> Optional[int]:
        if value is None or value == "":
            return None
        try:
            return int(float(str(value).replace(",", "").strip()))
        except (TypeError, ValueError):
            return None

    @staticmethod
    def _safe_float(value: Any) -> Optional[float]:
        if value is None or value == "":
            return None
        try:
            return float(str(value).replace(",", "").strip())
        except (TypeError, ValueError):
            return None

    # ------------------------------------------------------------------
    # Stratégie 2 : __NEXT_DATA__ (Next.js SSR payload)
    # ------------------------------------------------------------------

    def _parse_next_data(self, html: str, *, base_url: str) -> List[Dict[str, Any]]:
        m = re.search(
            r'<script[^>]+id="__NEXT_DATA__"[^>]*>(.*?)</script>',
            html, re.DOTALL,
        )
        if not m:
            return []
        try:
            data = json.loads(m.group(1))
        except json.JSONDecodeError:
            return []

        out: List[Dict[str, Any]] = []
        self._walk_next_data(data, out)
        return out

    def _walk_next_data(self, node: Any, out: List[Dict[str, Any]], *, depth: int = 0) -> None:
        if depth > 30 or len(out) >= 100:
            return
        if isinstance(node, list):
            for it in node:
                self._walk_next_data(it, out, depth=depth + 1)
            return
        if not isinstance(node, dict):
            return

        make = node.get("Make") or node.get("make")
        model = node.get("Model") or node.get("model")
        year = node.get("Year") or node.get("year")
        price = node.get("Price") or node.get("price")
        vurl = node.get("VehicleUrl") or node.get("vehicleUrl") or node.get("url")
        if make and model and price is not None and vurl:
            full_url = vurl if str(vurl).startswith("http") else urljoin(
                "https://www.autotrader.ca", str(vurl)
            )
            photos = node.get("Photos") or node.get("photos") or []
            image = ""
            if isinstance(photos, list) and photos:
                # On parcourt les photos jusqu'à en trouver une valide (les
                # placeholders SVG sont parfois injectés en 1re position).
                for photo in photos:
                    if isinstance(photo, str):
                        candidate = photo
                    elif isinstance(photo, dict):
                        candidate = (
                            photo.get("url")
                            or photo.get("Photo")
                            or photo.get("LargePhoto")
                            or photo.get("MediumPhoto")
                            or photo.get("FullSize")
                            or ""
                        )
                    else:
                        candidate = ""
                    if self._is_valid_image_url(candidate):
                        image = self._absolutize(candidate, "https://www.autotrader.ca")
                        break
            try:
                price_v = (
                    float(price)
                    if not isinstance(price, dict)
                    else float(price.get("amount", 0))
                )
            except (TypeError, ValueError):
                price_v = None
            try:
                year_v = int(year) if year else None
            except (TypeError, ValueError):
                year_v = None
            km = node.get("Mileage") or node.get("Kilometres") or node.get("mileage")
            try:
                km_v = int(km) if km else None
            except (TypeError, ValueError):
                km_v = None

            out.append({
                "name": f"{year_v or ''} {make} {model}".strip(),
                "marque": str(make),
                "modele": str(model),
                "annee": year_v,
                "prix": price_v,
                "kilometrage": km_v,
                "currency": "CAD",
                "image": image,
                "sourceUrl": full_url,
                "etat": "occasion" if (km_v or 0) > 100 else "neuf",
            })
            return

        for v in node.values():
            self._walk_next_data(v, out, depth=depth + 1)

    # ------------------------------------------------------------------
    # Stratégie 3 : JSON-LD (ItemList / Vehicle / Car / Product)
    # ------------------------------------------------------------------

    def _parse_jsonld(self, html: str, *, base_url: str) -> List[Dict[str, Any]]:
        """Extrait les véhicules depuis les blocs `<script type='application/ld+json'>`.

        AutoTrader injecte un `ItemList` SEO listant les véhicules de la page.
        Le format est variable selon les déploiements ; on cherche surtout
        `@type` ∈ {Vehicle, Car, AutomobileListing, Product}.
        """
        out: List[Dict[str, Any]] = []
        for m in re.finditer(
            r'<script[^>]+type=["\']application/ld\+json["\'][^>]*>(.*?)</script>',
            html, re.DOTALL | re.IGNORECASE,
        ):
            raw = m.group(1).strip()
            if not raw:
                continue
            try:
                data = json.loads(raw)
            except json.JSONDecodeError:
                # JSON-LD peut contenir des '\n' littéraux ou des trailing commas
                # qui cassent le parser — on tente un nettoyage simple.
                cleaned = re.sub(r",(\s*[}\]])", r"\1", raw)
                try:
                    data = json.loads(cleaned)
                except json.JSONDecodeError:
                    continue
            self._walk_jsonld(data, out)
            if len(out) >= 100:
                break
        return out

    def _walk_jsonld(self, node: Any, out: List[Dict[str, Any]], *, depth: int = 0) -> None:
        if depth > 20 or len(out) >= 100:
            return
        if isinstance(node, list):
            for it in node:
                self._walk_jsonld(it, out, depth=depth + 1)
            return
        if not isinstance(node, dict):
            return

        type_field = node.get("@type") or node.get("type")
        types: List[str] = []
        if isinstance(type_field, str):
            types = [type_field]
        elif isinstance(type_field, list):
            types = [str(t) for t in type_field]

        is_vehicle = any(
            t in {"Vehicle", "Car", "AutomobileListing", "Product"} for t in types
        )
        if is_vehicle:
            listing = self._jsonld_to_listing(node)
            if listing:
                out.append(listing)
                return

        # ItemList → on traverse les itemListElement
        if any(t == "ItemList" for t in types):
            elements = node.get("itemListElement") or []
            if isinstance(elements, list):
                for el in elements:
                    if isinstance(el, dict):
                        item = el.get("item") or el
                        self._walk_jsonld(item, out, depth=depth + 1)
            return

        for v in node.values():
            self._walk_jsonld(v, out, depth=depth + 1)

    def _jsonld_to_listing(self, node: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        url = node.get("url") or node.get("URL")
        if not url:
            return None
        url = str(url)
        if not url.startswith("http"):
            url = urljoin("https://www.autotrader.ca", url)

        brand = node.get("brand") or node.get("manufacturer") or {}
        if isinstance(brand, dict):
            make = str(brand.get("name") or "").strip()
        else:
            make = str(brand).strip()

        model = str(node.get("model") or "").strip()
        # Certains JSON-LD AutoTrader mettent le modèle dans "name" en concat
        # avec la marque ("Ford F-250"). Si model vide, on dérive du name.
        name_field = str(node.get("name") or "").strip()
        if not model and name_field:
            tokens = name_field.split()
            if make and tokens and tokens[0].lower() == make.lower():
                model = " ".join(tokens[1:])
            else:
                model = name_field

        year = self._safe_int(
            node.get("modelDate") or node.get("vehicleModelDate") or node.get("releaseDate")
        )

        offer = node.get("offers") or {}
        if isinstance(offer, list):
            offer = offer[0] if offer else {}
        price = None
        if isinstance(offer, dict):
            price = self._safe_float(offer.get("price"))

        mileage = None
        odo = node.get("mileageFromOdometer")
        if isinstance(odo, dict):
            mileage = self._safe_int(odo.get("value"))
        elif odo:
            mileage = self._safe_int(odo)

        image = ""
        img_field = node.get("image")
        candidates: List[str] = []
        if isinstance(img_field, str):
            candidates.append(img_field)
        elif isinstance(img_field, list):
            for item in img_field:
                if isinstance(item, str):
                    candidates.append(item)
                elif isinstance(item, dict):
                    val = item.get("url") or item.get("contentUrl")
                    if isinstance(val, str):
                        candidates.append(val)
        elif isinstance(img_field, dict):
            val = img_field.get("url") or img_field.get("contentUrl")
            if isinstance(val, str):
                candidates.append(val)
        for candidate in candidates:
            if self._is_valid_image_url(candidate):
                image = self._absolutize(candidate, "https://www.autotrader.ca")
                break

        condition = ""
        cond_field = node.get("itemCondition") or node.get("vehicleCondition")
        if cond_field:
            condition = str(cond_field).lower()
        etat = "neuf" if "newcondition" in condition or condition == "new" else "occasion"

        # On rejette les fiches sans nom ET sans make+model — c'est du bruit
        # (le logo OG par exemple).
        if not (name_field or (make and model)):
            return None

        display_name = name_field or " ".join(
            p for p in [str(year) if year else "", make, model] if p
        ).strip()

        return {
            "name": display_name,
            "marque": make or None,
            "modele": model or None,
            "annee": year,
            "prix": price,
            "kilometrage": mileage,
            "currency": "CAD",
            "image": image or "",
            "sourceUrl": url,
            "etat": etat,
        }

    # ------------------------------------------------------------------
    # Stratégie 4 : Fallback par anchors `/a/...` ou `/offers/...`
    # ------------------------------------------------------------------

    # Pattern d'URL d'une fiche véhicule AutoTrader actuelle.
    # Forme historique : /offers/{slug}/{...}
    # Forme actuelle :   /a/{make}/{model}/{...}/{guid}
    _LISTING_URL_RE = re.compile(
        r"^/(?:a|offers)/[^?#]+", re.IGNORECASE,
    )

    def _parse_listing_anchors(self, html: str, *, base_url: str) -> List[Dict[str, Any]]:
        """Filet de sécurité : extrait les listings depuis les anchors.

        On regroupe par URL canonique de fiche (déduplique les "image link",
        "price link" et "title link" d'une même card) et on tente d'extraire
        le titre/prix depuis le texte du parent commun.
        """
        try:
            from bs4 import BeautifulSoup
        except ImportError:
            return []

        soup = BeautifulSoup(html, "html.parser")

        seen_urls: Dict[str, Dict[str, Any]] = {}
        for a in soup.find_all("a", href=True):
            href = (a.get("href") or "").strip()
            if not href:
                continue
            # On veut juste les liens internes vers une fiche
            parsed = urlparse(href if href.startswith("http") else urljoin(base_url, href))
            if parsed.netloc and "autotrader.ca" not in parsed.netloc.lower():
                continue
            if not self._LISTING_URL_RE.match(parsed.path):
                continue
            full_url = (
                href if href.startswith("http") else urljoin(base_url, href)
            )
            # Normalisation : on coupe les query strings pour dédupliquer
            canonical = full_url.split("?", 1)[0]

            if canonical in seen_urls:
                continue

            # Cherche le parent commun (card) en remontant jusqu'à trouver
            # un container qui contient à la fois un prix et un titre.
            parent = a
            for _ in range(6):
                if parent.parent is None:
                    break
                parent = parent.parent
                txt = parent.get_text(" ", strip=True)
                if txt and "$" in txt and len(txt) > 20:
                    break

            txt = parent.get_text(" ", strip=True) if parent else a.get_text(" ", strip=True)
            year, make, model = self._guess_year_make_model(canonical, txt)
            price = self._extract_price_from_text(txt)
            mileage = self._extract_mileage_from_text(txt)
            # Récupère l'image depuis le container parent commun (qui devrait
            # englober la card complète) — même logique de fallback que pour
            # les cards data-testid pour gérer le lazy-loading.
            image = self._extract_image(parent, base_url=base_url) if parent else ""

            name_parts: List[str] = []
            if year:
                name_parts.append(str(year))
            if make:
                name_parts.append(make)
            if model:
                name_parts.append(model)
            name = " ".join(name_parts).strip()
            if not name:
                # Fallback ultime : texte du anchor
                name = a.get_text(" ", strip=True)[:120]
            if not name:
                continue

            seen_urls[canonical] = {
                "name": name,
                "marque": make or None,
                "modele": model or None,
                "annee": year,
                "prix": price,
                "kilometrage": mileage,
                "currency": "CAD",
                "image": image,
                "sourceUrl": canonical,
                "etat": "occasion" if (mileage or 0) > 100 else None,
            }

        return list(seen_urls.values())

    @staticmethod
    def _guess_year_make_model(url: str, text: str) -> Tuple[Optional[int], Optional[str], Optional[str]]:
        """Dérive (année, marque, modèle) depuis l'URL et le texte du parent."""
        year: Optional[int] = None
        make: Optional[str] = None
        model: Optional[str] = None

        # URL : /a/{make}/{model}/...
        try:
            path = urlparse(url).path
        except Exception:
            path = url
        parts = [p for p in path.split("/") if p]
        # ['a', 'ford', 'f-250', ...]
        if len(parts) >= 3 and parts[0].lower() in ("a", "offers"):
            make = parts[1].replace("-", " ").title() if parts[0].lower() == "a" else None
            if parts[0].lower() == "a":
                model = parts[2].replace("-", " ").upper() if len(parts[2]) <= 6 else parts[2].replace("-", " ").title()

        # Année : 1er match 19xx/20xx dans le texte
        m = re.search(r"\b(19[5-9]\d|20[0-4]\d)\b", text or "")
        if m:
            year = int(m.group(1))

        return year, make, model

    @staticmethod
    def _extract_price_from_text(text: str) -> Optional[float]:
        if not text:
            return None
        # Cherche "$ 66,595" ou "$66595" ou "66 595 $"
        m = re.search(r"\$\s*([\d,. ]{3,12})", text)
        if not m:
            m = re.search(r"([\d,. ]{4,12})\s*\$", text)
            if not m:
                return None
        raw = m.group(1).replace(" ", "").replace(",", "").replace(".", "")
        try:
            v = float(raw)
            if v < 100:
                return None
            return v
        except (TypeError, ValueError):
            return None

    @staticmethod
    def _extract_mileage_from_text(text: str) -> Optional[int]:
        if not text:
            return None
        # "4,989 km" / "37 487 km" / "11816km"
        m = re.search(r"([\d,. ]{2,9})\s*km\b", text, re.IGNORECASE)
        if not m:
            return None
        raw = m.group(1).replace(" ", "").replace(",", "").replace(".", "")
        try:
            v = int(raw)
            if v < 1 or v > 2_000_000:
                return None
            return v
        except (TypeError, ValueError):
            return None
