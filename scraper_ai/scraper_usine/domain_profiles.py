"""
Profils de domaine pour scraper_usine.

Découple le moteur de scraping du domaine métier (auto, ecommerce général,
immobilier, emplois, recettes…). Chaque profil définit :
  - les mots-clés de navigation pour découvrir les listings
  - les chemins d'URL exclus
  - les champs cibles à extraire
  - les types JSON-LD pertinents
  - les patterns de prix / valeurs cohérentes
  - le scoring (poids des champs)

Un profil est sélectionné automatiquement par DomainDetector ou imposé via
SiteAnalysis.domain_profile_key.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from enum import Enum
from typing import Dict, List, Optional, Pattern, Tuple


class DomainType(Enum):
    AUTO = "auto"                # Concessionnaires véhicules (auto, moto, VTT, motoneige…)
    ECOMMERCE = "ecommerce"      # E-commerce généraliste (vêtements, électronique, déco…)
    REAL_ESTATE = "real_estate"  # Immobilier (maisons, condos, terrains)
    JOBS = "jobs"                # Emplois / offres
    GENERIC = "generic"          # Fallback : extraction minimale (name, image, prix, url)


@dataclass
class FieldSpec:
    """Spécification d'un champ cible à extraire."""
    name: str                                   # nom de sortie (ex: 'marque')
    required: bool = False                      # champ obligatoire pour score plein
    weight: int = 0                             # poids dans le scoring (0-10)
    coverage_threshold: float = 0.5             # couverture min attendue
    jsonld_keys: List[str] = field(default_factory=list)   # chemins JSON-LD possibles
    css_hints: List[str] = field(default_factory=list)     # sélecteurs typiques
    api_keys: List[str] = field(default_factory=list)      # clés API typiques (lowercase)
    parser: str = "text"                        # 'text' | 'price' | 'int' | 'year' | 'url' | 'image_list'


@dataclass
class ValidationRanges:
    """Bornes de cohérence pour validation."""
    price_min: float = 1.0
    price_max: float = 1_000_000.0
    year_min: int = 1900
    year_max: int = 2100


@dataclass
class DomainProfile:
    """Profil complet d'un domaine métier."""
    domain_type: DomainType
    name: str

    # --- Découverte ---
    nav_keywords: List[str] = field(default_factory=list)
    excluded_paths: List[str] = field(default_factory=list)

    # --- Détection produit ---
    listing_item_hints: List[str] = field(default_factory=list)
    detail_url_patterns: List[str] = field(default_factory=list)

    # --- JSON-LD ---
    jsonld_types: List[str] = field(default_factory=list)

    # --- Champs cibles ---
    fields: List[FieldSpec] = field(default_factory=list)

    # --- Validation ---
    ranges: ValidationRanges = field(default_factory=ValidationRanges)

    # --- Catégories par défaut pour scrape() ---
    default_categories: List[str] = field(default_factory=lambda: ["all"])

    def field_by_name(self, name: str) -> Optional[FieldSpec]:
        for f in self.fields:
            if f.name == name:
                return f
        return None

    def required_fields(self) -> List[FieldSpec]:
        return [f for f in self.fields if f.required]

    def total_weight(self) -> int:
        return sum(f.weight for f in self.fields)


# ---------------------------------------------------------------------------
# AUTO (rétrocompat avec le pipeline existant)
# ---------------------------------------------------------------------------

AUTO_PROFILE = DomainProfile(
    domain_type=DomainType.AUTO,
    name="Concessionnaire (auto, moto, powersport)",
    nav_keywords=[
        "inventaire", "inventory", "en-stock", "en stock", "in stock", "in-stock",
        "neufs", "neuf", "new", "occasions", "occasion", "used",
        "usagé", "usages", "pre-owned", "preowned", "certified",
        "catalogue", "catalog",
        "véhicules", "vehicules", "vehicles",
        "motos", "moto", "motocyclettes", "motorcycle",
        "vtt", "quad", "atv",
        "motoneiges", "motoneige", "snowmobile",
        "side-by-side", "côte-à-côte", "utilitaires", "utility",
        "cars", "car", "auto", "autos", "automobile", "automobiles",
        "trucks", "truck", "camion", "camions", "pickup",
        "suv", "suvs", "vus",
        "sedan", "berline", "berlines",
        "coupe", "coupé",
        "convertible", "cabriolet", "décapotable",
        "minivan", "fourgonnette", "van", "fourgon",
        "crossover", "hatchback",
        "hybrid", "hybride", "electric", "électrique", "phev", "ev",
        "luxury", "sport",
        "search", "recherche", "browse", "parcourir", "showroom",
    ],
    excluded_paths=[
        "/contact", "/nous-contacter", "/about", "/a-propos",
        "/content/", "/blog", "/nouvelles", "/news",
        "/emploi", "/carrieres", "/careers",
        "/politique", "/privacy", "/terms", "/conditions",
        "/evenement", "/event",
        "/heures", "/hours",
        "/login", "/compte", "/account", "/panier", "/cart",
        "/temoignages", "/testimonials", "/reviews",
        "/directions", "/map", "/carte",
        "/faq", "/aide", "/help",
        "/gallery", "/galerie", "/photos",
        "/media", "/presse", "/press",
    ],
    listing_item_hints=[
        "article.product-miniature", "li.product", ".product-card",
        ".vehicle-card", ".pg-vehicle-card", ".inventory-item",
        ".vehicle", ".srp-vehicle", ".vdp-vehicle",
        "[data-vehicle-id]", "[data-vin]",
    ],
    detail_url_patterns=[
        r"/neuf/", r"/occasion/", r"/usage/",
        r"/inventory/", r"/inventaire/", r"/vehicle/",
        r"/vehicule/", r"/detail/", r"/-vin-", r"/-id\d+",
    ],
    jsonld_types=["Vehicle", "Car", "AutomotiveVehicle", "MotorizedBicycle",
                  "Product", "IndividualProduct"],
    fields=[
        FieldSpec("name", required=True, weight=8,
                  jsonld_keys=["name"], css_hints=["h1"],
                  api_keys=["name", "nom", "title", "titre", "vehiclename", "vehicle_name"]),
        FieldSpec("prix", weight=7, coverage_threshold=0.7, parser="price",
                  jsonld_keys=["offers.price", "price"],
                  css_hints=[".price", ".prix", ".product-price", "[itemprop='price']"],
                  api_keys=["prix", "price", "msrp", "saleprice", "sale_price", "askingprice"]),
        FieldSpec("marque", weight=5, coverage_threshold=0.7,
                  jsonld_keys=["brand.name", "brand", "manufacturer"],
                  css_hints=[".brand", "[itemprop='brand']"],
                  api_keys=["brand", "marque", "make", "manufacturer", "brandname"]),
        FieldSpec("modele", weight=5, coverage_threshold=0.7,
                  jsonld_keys=["model"],
                  css_hints=[".model", "[itemprop='model']"],
                  api_keys=["model", "modele", "modelname", "model_name"]),
        FieldSpec("annee", weight=5, coverage_threshold=0.6, parser="year",
                  jsonld_keys=["modelDate", "vehicleModelDate", "productionDate"],
                  css_hints=[".year", ".annee", "[itemprop='vehicleModelDate']"],
                  api_keys=["year", "annee", "modelyear", "model_year"]),
        FieldSpec("kilometrage", weight=4, coverage_threshold=0.5, parser="int",
                  jsonld_keys=["mileageFromOdometer.value", "mileage"],
                  css_hints=[".mileage", ".kilometrage", ".km"],
                  api_keys=["mileage", "kilometrage", "km", "odometer"]),
        FieldSpec("vin", weight=3, coverage_threshold=0.5,
                  jsonld_keys=["vehicleIdentificationNumber", "vin"],
                  css_hints=["[itemprop='vehicleIdentificationNumber']", ".vin"],
                  api_keys=["vin", "vinnumber", "vin_number"]),
        FieldSpec("couleur", weight=3, coverage_threshold=0.5,
                  jsonld_keys=["color"],
                  css_hints=[".color", ".couleur"],
                  api_keys=["color", "colour", "couleur", "exteriorcolor"]),
        FieldSpec("image", weight=5, coverage_threshold=0.8, parser="image_list",
                  jsonld_keys=["image"],
                  css_hints=[".gallery img", ".main-image img", "img[itemprop='image']"],
                  api_keys=["image", "photo", "thumbnail", "img", "imageurl", "image_url", "mainphoto"]),
        FieldSpec("description", weight=2,
                  jsonld_keys=["description"],
                  css_hints=[".description", "[itemprop='description']"],
                  api_keys=["description", "desc"]),
    ],
    ranges=ValidationRanges(price_min=500.0, price_max=500_000.0,
                            year_min=1990, year_max=2030),
    default_categories=["inventaire", "occasion"],
)


# ---------------------------------------------------------------------------
# E-COMMERCE GÉNÉRAL
# ---------------------------------------------------------------------------

ECOMMERCE_PROFILE = DomainProfile(
    domain_type=DomainType.ECOMMERCE,
    name="E-commerce généraliste",
    nav_keywords=[
        "shop", "boutique", "store", "magasin",
        "products", "produits", "catalogue", "catalog",
        "collections", "collection", "categories", "categorie",
        "all", "tous", "toutes",
        "new", "nouveau", "nouveautes", "nouveautés", "nouveau-arrivage",
        "sale", "soldes", "promo", "promotion", "deals", "outlet",
        "bestsellers", "meilleures-ventes", "popular",
        "men", "homme", "hommes", "women", "femme", "femmes",
        "kids", "enfants", "junior",
        "shop-all", "shop-by",
        "search", "recherche", "browse", "parcourir",
    ],
    excluded_paths=[
        "/contact", "/about", "/a-propos",
        "/blog", "/news", "/journal",
        "/login", "/account", "/compte", "/mon-compte",
        "/cart", "/panier", "/checkout", "/commande",
        "/wishlist", "/favoris",
        "/policies", "/politique", "/privacy", "/terms", "/conditions",
        "/shipping", "/livraison", "/returns", "/retour",
        "/faq", "/aide", "/help", "/support",
        "/store-locator", "/magasins", "/boutiques",
        "/gift-card", "/carte-cadeau",
    ],
    listing_item_hints=[
        ".product-card", ".product-tile", ".product-item",
        "li.product", "article.product", ".product-miniature",
        ".grid__item", ".collection-product",
        "[data-product-id]", "[data-product-handle]",
    ],
    detail_url_patterns=[
        r"/products/", r"/product/", r"/produit/", r"/produits/",
        r"/p/", r"/-p-", r"/item/",
    ],
    jsonld_types=["Product", "IndividualProduct", "ProductGroup"],
    fields=[
        FieldSpec("name", required=True, weight=10,
                  jsonld_keys=["name"], css_hints=["h1", ".product-title"],
                  api_keys=["name", "title", "productname", "product_name"]),
        FieldSpec("prix", weight=10, coverage_threshold=0.85, parser="price",
                  jsonld_keys=["offers.price", "offers.lowPrice", "price"],
                  css_hints=[".price", "[itemprop='price']", ".product-price",
                             ".money", ".price__current"],
                  api_keys=["price", "prix", "amount", "saleprice", "sale_price",
                            "currentprice", "current_price"]),
        FieldSpec("marque", weight=5, coverage_threshold=0.4,
                  jsonld_keys=["brand.name", "brand", "manufacturer"],
                  css_hints=[".brand", ".product-brand", "[itemprop='brand']"],
                  api_keys=["brand", "marque", "vendor", "manufacturer"]),
        FieldSpec("sku", weight=3, coverage_threshold=0.5,
                  jsonld_keys=["sku", "mpn", "gtin"],
                  css_hints=["[itemprop='sku']", ".sku"],
                  api_keys=["sku", "mpn", "gtin", "gtin13", "ean", "upc"]),
        FieldSpec("description", weight=3,
                  jsonld_keys=["description"],
                  css_hints=[".description", ".product-description", "[itemprop='description']"],
                  api_keys=["description", "desc", "body_html"]),
        FieldSpec("image", weight=8, coverage_threshold=0.85, parser="image_list",
                  jsonld_keys=["image"],
                  css_hints=[".product-image img", ".gallery img", "img[itemprop='image']"],
                  api_keys=["image", "image_url", "images", "photos", "media",
                            "featured_image", "thumbnail"]),
        FieldSpec("availability", weight=3,
                  jsonld_keys=["offers.availability"],
                  css_hints=[".availability", "[itemprop='availability']"],
                  api_keys=["available", "in_stock", "stock", "availability"]),
        FieldSpec("rating", weight=2, parser="text",
                  jsonld_keys=["aggregateRating.ratingValue"],
                  api_keys=["rating", "stars", "score"]),
        FieldSpec("category", weight=2,
                  jsonld_keys=["category"],
                  api_keys=["category", "categorie", "type", "product_type"]),
    ],
    ranges=ValidationRanges(price_min=0.5, price_max=50_000.0),
    default_categories=["all"],
)


# ---------------------------------------------------------------------------
# IMMOBILIER
# ---------------------------------------------------------------------------

REAL_ESTATE_PROFILE = DomainProfile(
    domain_type=DomainType.REAL_ESTATE,
    name="Immobilier",
    nav_keywords=[
        "properties", "proprietes", "propriétés", "biens",
        "listings", "annonces", "fiches",
        "houses", "maisons", "homes",
        "condos", "appartements", "apartments", "lofts",
        "duplex", "triplex", "plex",
        "terrains", "land", "lots",
        "commercial", "commerce", "industrial", "industriel",
        "rent", "louer", "location", "for-rent",
        "sale", "vendre", "vente", "for-sale", "a-vendre",
        "buy", "acheter",
        "search", "recherche", "browse", "parcourir",
        "neighborhoods", "quartiers", "regions", "cities", "villes",
    ],
    excluded_paths=[
        "/contact", "/about", "/a-propos", "/equipe", "/team",
        "/blog", "/news", "/actualites",
        "/login", "/account", "/compte",
        "/agents", "/courtiers",
        "/calculator", "/calculatrice", "/mortgage", "/hypotheque",
        "/policies", "/privacy", "/terms",
        "/faq", "/aide",
    ],
    listing_item_hints=[
        ".property-card", ".listing-card", ".property", ".listing",
        ".result", ".result-item",
        "[data-listing-id]", "[data-mls]",
    ],
    detail_url_patterns=[
        r"/property/", r"/listing/", r"/propriete/",
        r"/maison/", r"/condo/", r"/mls",
    ],
    jsonld_types=["Residence", "House", "Apartment", "RealEstateListing",
                  "SingleFamilyResidence", "Product"],
    fields=[
        FieldSpec("name", required=True, weight=6,
                  jsonld_keys=["name"], css_hints=["h1"],
                  api_keys=["title", "name", "address", "addresstext"]),
        FieldSpec("prix", required=True, weight=10, coverage_threshold=0.85, parser="price",
                  jsonld_keys=["offers.price", "price"],
                  css_hints=[".price", ".listing-price", "[itemprop='price']"],
                  api_keys=["price", "askingprice", "asking_price", "listprice", "list_price"]),
        FieldSpec("address", weight=8, coverage_threshold=0.9,
                  jsonld_keys=["address.streetAddress", "address"],
                  css_hints=[".address", "[itemprop='address']"],
                  api_keys=["address", "addresstext", "street", "fulladdress"]),
        FieldSpec("city", weight=5, coverage_threshold=0.8,
                  jsonld_keys=["address.addressLocality"],
                  css_hints=[".city", "[itemprop='addressLocality']"],
                  api_keys=["city", "ville", "municipality"]),
        FieldSpec("bedrooms", weight=5, coverage_threshold=0.7, parser="int",
                  jsonld_keys=["numberOfBedrooms", "numberOfRooms"],
                  css_hints=[".bedrooms", ".bed-count"],
                  api_keys=["bedrooms", "beds", "chambres", "nbchambres"]),
        FieldSpec("bathrooms", weight=4, coverage_threshold=0.7, parser="int",
                  jsonld_keys=["numberOfBathroomsTotal"],
                  css_hints=[".bathrooms", ".bath-count"],
                  api_keys=["bathrooms", "baths", "sallesdebain", "nbsallesdebain"]),
        FieldSpec("area_sqft", weight=4, coverage_threshold=0.6, parser="int",
                  jsonld_keys=["floorSize.value"],
                  css_hints=[".area", ".sqft", ".square-feet"],
                  api_keys=["sqft", "area", "size", "superficie", "livingarea"]),
        FieldSpec("year_built", weight=2, coverage_threshold=0.5, parser="year",
                  jsonld_keys=["yearBuilt"],
                  api_keys=["yearbuilt", "year_built", "annee_construction"]),
        FieldSpec("image", weight=6, coverage_threshold=0.9, parser="image_list",
                  jsonld_keys=["image"],
                  css_hints=[".gallery img", ".property-photo img"],
                  api_keys=["image", "images", "photos", "media", "thumbnail"]),
        FieldSpec("description", weight=2,
                  jsonld_keys=["description"],
                  api_keys=["description", "remarks", "publicremarks"]),
    ],
    ranges=ValidationRanges(price_min=10_000.0, price_max=50_000_000.0,
                            year_min=1800, year_max=2030),
    default_categories=["all"],
)


# ---------------------------------------------------------------------------
# EMPLOIS
# ---------------------------------------------------------------------------

JOBS_PROFILE = DomainProfile(
    domain_type=DomainType.JOBS,
    name="Offres d'emploi",
    nav_keywords=[
        "jobs", "emplois", "carrieres", "careers", "carrière", "carrières",
        "openings", "opportunities", "opportunites",
        "positions", "postes", "vacancies",
        "search", "recherche", "browse", "parcourir",
        "remote", "teletravail", "télétravail", "hybrid", "hybride",
        "full-time", "temps-plein", "part-time", "temps-partiel",
        "internship", "stage", "stages",
    ],
    excluded_paths=[
        "/contact", "/about", "/a-propos",
        "/blog", "/news",
        "/login", "/account", "/compte", "/profile", "/profil",
        "/employer", "/employeur", "/post-job", "/poster",
        "/policies", "/privacy", "/terms",
        "/faq", "/aide",
    ],
    listing_item_hints=[
        ".job-card", ".job-listing", ".job-item", ".job",
        "article.job", "[data-job-id]",
    ],
    detail_url_patterns=[
        r"/jobs/", r"/job/", r"/emploi/", r"/emplois/",
        r"/career/", r"/posting/", r"/-jobid",
    ],
    jsonld_types=["JobPosting"],
    fields=[
        FieldSpec("name", required=True, weight=10,
                  jsonld_keys=["title"], css_hints=["h1", ".job-title"],
                  api_keys=["title", "jobtitle", "name"]),
        FieldSpec("company", weight=8, coverage_threshold=0.9,
                  jsonld_keys=["hiringOrganization.name"],
                  css_hints=[".company", ".employer"],
                  api_keys=["company", "employer", "hiringorganization", "companyname"]),
        FieldSpec("location", weight=8, coverage_threshold=0.8,
                  jsonld_keys=["jobLocation.address.addressLocality",
                               "jobLocation.address"],
                  css_hints=[".location", ".job-location"],
                  api_keys=["location", "city", "jobLocation"]),
        FieldSpec("description", weight=5,
                  jsonld_keys=["description"],
                  api_keys=["description", "summary", "body"]),
        FieldSpec("employment_type", weight=3,
                  jsonld_keys=["employmentType"],
                  api_keys=["employmenttype", "type", "schedule"]),
        FieldSpec("salary", weight=3, parser="price",
                  jsonld_keys=["baseSalary.value.value", "baseSalary"],
                  api_keys=["salary", "compensation", "pay"]),
        FieldSpec("posted_date", weight=2,
                  jsonld_keys=["datePosted"],
                  api_keys=["posteddate", "date_posted", "publisheddate"]),
        FieldSpec("remote", weight=2,
                  jsonld_keys=["jobLocationType"],
                  api_keys=["remote", "telecommute", "workfromhome"]),
    ],
    ranges=ValidationRanges(price_min=0.0, price_max=10_000_000.0),
    default_categories=["all"],
)


# ---------------------------------------------------------------------------
# GENERIC (fallback minimal)
# ---------------------------------------------------------------------------

GENERIC_PROFILE = DomainProfile(
    domain_type=DomainType.GENERIC,
    name="Générique",
    nav_keywords=[
        "products", "produits", "items", "articles",
        "shop", "store", "boutique",
        "catalogue", "catalog",
        "all", "tous",
        "search", "recherche", "browse",
    ],
    excluded_paths=[
        "/contact", "/about", "/a-propos",
        "/login", "/account", "/cart", "/panier",
        "/privacy", "/terms",
    ],
    listing_item_hints=[
        ".product", ".item", ".card", ".tile",
        "article", "li.item",
    ],
    detail_url_patterns=[
        r"/products/", r"/product/", r"/p/", r"/item/", r"/detail/",
    ],
    jsonld_types=["Product", "Thing"],
    fields=[
        FieldSpec("name", required=True, weight=12,
                  jsonld_keys=["name", "headline"], css_hints=["h1"],
                  api_keys=["name", "title", "label"]),
        FieldSpec("prix", weight=6, coverage_threshold=0.5, parser="price",
                  jsonld_keys=["offers.price", "price"],
                  css_hints=[".price", ".prix", "[itemprop='price']"],
                  api_keys=["price", "prix", "amount"]),
        FieldSpec("description", weight=3,
                  jsonld_keys=["description"],
                  api_keys=["description", "desc", "summary"]),
        FieldSpec("image", weight=6, coverage_threshold=0.6, parser="image_list",
                  jsonld_keys=["image"],
                  css_hints=["img[itemprop='image']", ".main-image img"],
                  api_keys=["image", "photo", "thumbnail", "img"]),
    ],
    ranges=ValidationRanges(),
    default_categories=["all"],
)


PROFILES: Dict[DomainType, DomainProfile] = {
    DomainType.AUTO: AUTO_PROFILE,
    DomainType.ECOMMERCE: ECOMMERCE_PROFILE,
    DomainType.REAL_ESTATE: REAL_ESTATE_PROFILE,
    DomainType.JOBS: JOBS_PROFILE,
    DomainType.GENERIC: GENERIC_PROFILE,
}


# ---------------------------------------------------------------------------
# DomainDetector — choisit le profil adapté à un site
# ---------------------------------------------------------------------------

# Signaux JSON-LD (forts) qui imposent un profil
JSONLD_TYPE_TO_PROFILE: Dict[str, DomainType] = {
    "Vehicle": DomainType.AUTO,
    "Car": DomainType.AUTO,
    "AutomotiveVehicle": DomainType.AUTO,
    "MotorizedBicycle": DomainType.AUTO,
    "Motorcycle": DomainType.AUTO,
    "JobPosting": DomainType.JOBS,
    "Residence": DomainType.REAL_ESTATE,
    "House": DomainType.REAL_ESTATE,
    "Apartment": DomainType.REAL_ESTATE,
    "RealEstateListing": DomainType.REAL_ESTATE,
    "SingleFamilyResidence": DomainType.REAL_ESTATE,
    "Product": DomainType.ECOMMERCE,
    "IndividualProduct": DomainType.ECOMMERCE,
    "ProductGroup": DomainType.ECOMMERCE,
}

# Patterns d'URL caractéristiques par profil
_URL_PATTERN_HINTS: List[Tuple[Pattern, DomainType, int]] = [
    (re.compile(r"/(neuf|occasion|vehicle|vehicule|inventaire|inventory)/", re.I),
     DomainType.AUTO, 3),
    (re.compile(r"/(properties|listings|maison|condo|mls)", re.I),
     DomainType.REAL_ESTATE, 3),
    (re.compile(r"/(jobs|emplois|carrieres|careers)/", re.I),
     DomainType.JOBS, 3),
    (re.compile(r"/(products?|produits?|collections?|shop|boutique)/", re.I),
     DomainType.ECOMMERCE, 2),
]

# Mots-clés à compter dans le HTML
_HTML_KEYWORD_HINTS: Dict[DomainType, List[str]] = {
    DomainType.AUTO: ["vin", "kilometrage", "mileage", "odometer", "moteur",
                      "transmission", "carrosserie", "concessionnaire", "dealer",
                      "test drive", "essai routier"],
    DomainType.REAL_ESTATE: ["mls", "chambres", "bedrooms", "bathrooms", "salles de bain",
                             "pieds carrés", "square feet", "courtier", "realtor",
                             "centris", "duplex", "condo"],
    DomainType.JOBS: ["job description", "responsibilities", "qualifications",
                      "apply now", "postuler", "salary range", "remote work",
                      "full-time", "temps plein"],
    DomainType.ECOMMERCE: ["add to cart", "ajouter au panier", "checkout", "commander",
                           "in stock", "en stock", "free shipping", "livraison gratuite",
                           "size", "taille", "color", "couleur"],
}


def detect_domain_profile(html: str, url: str,
                          jsonld_types: Optional[List[str]] = None) -> DomainProfile:
    """
    Détecte le profil de domaine le mieux adapté à un site.
    Priorité : JSON-LD > URL patterns > mots-clés HTML.
    Retourne GENERIC en l'absence de signal.
    """
    scores: Dict[DomainType, int] = {dt: 0 for dt in DomainType}

    # 1) JSON-LD : signal le plus fort
    if jsonld_types:
        for t in jsonld_types:
            if t in JSONLD_TYPE_TO_PROFILE:
                scores[JSONLD_TYPE_TO_PROFILE[t]] += 10

    # 2) URL patterns
    for pat, dt, weight in _URL_PATTERN_HINTS:
        if pat.search(url):
            scores[dt] += weight

    # 3) Mots-clés HTML
    html_lower = (html or "").lower()[:200_000]  # évite scan complet sur HTML monstrueux
    for dt, keywords in _HTML_KEYWORD_HINTS.items():
        hits = sum(1 for kw in keywords if kw in html_lower)
        scores[dt] += hits

    best = max(scores.items(), key=lambda x: x[1])
    if best[1] < 3:
        return GENERIC_PROFILE
    return PROFILES[best[0]]


def get_profile(key: str) -> DomainProfile:
    """Récupère un profil par sa clé string (ex: 'auto', 'ecommerce')."""
    try:
        dt = DomainType(key)
        return PROFILES[dt]
    except (ValueError, KeyError):
        return GENERIC_PROFILE
