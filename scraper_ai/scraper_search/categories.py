"""
Taxonomie de catégories pour pré-tri de la recherche.

Avant de taper sa requête, l'utilisateur peut sélectionner une catégorie dans
un arbre hiérarchique (ex: véhicule → moto → KTM, ou électronique → cellulaire).
Ce pré-tri sert à :

  1. **Routing des adapters** : si on cherche dans `electronique.cellulaire`, on
     skip les concessionnaires de moto. Si on cherche `accessoire.moto`, les
     concessionnaires de moto sont AU CONTRAIRE pertinents (ils vendent casques,
     gants, vestes, …).
  2. **Désambiguïsation du parser** : "Bell" est un casque (accessoire.moto) ou
     une marque de téléphone — la catégorie tranche.
  3. **Affinage du scoring** : on connait le contexte avant de scorer.

Format des chemins : "vehicule.moto", "accessoire.moto", "electronique.cellulaire"
(point comme séparateur, slugs kebab/snake-case lowercase).

Convention de matching :
  - "vehicule" matche "vehicule.*" (préfixe).
  - "vehicule.moto" matche "vehicule.moto" et "vehicule.moto.cross", etc.
  - L'adapter qui sert "vehicule" sert TOUTE la branche véhicules.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional


@dataclass
class Category:
    """Un nœud de la taxonomie."""
    slug: str                        # ex: "moto"
    name: str                        # ex: "Moto"
    parent: Optional[str] = None     # slug parent ("vehicule") ou None pour racine
    children: List[str] = field(default_factory=list)
    aliases: List[str] = field(default_factory=list)  # ["motocyclette", "motorcycle"]
    description: str = ""

    @property
    def path(self) -> str:
        """Chemin complet : 'vehicule.moto'. Calculé via le registry."""
        return _CATEGORIES_BY_SLUG.get(f"__path__:{self.slug}", self.slug)


# ---------------------------------------------------------------------------
# Définition de l'arbre
# ---------------------------------------------------------------------------

_TREE_DEF = [
    # ============ VÉHICULES ============
    ("vehicule", "Véhicule", None, ["véhicule", "vehicules", "véhicules"]),
    ("auto", "Auto / Voiture", "vehicule",
     ["voiture", "car", "vus", "suv", "camion", "pickup",
      "honda civic", "toyota", "ford", "chevrolet", "dodge", "ram", "jeep",
      "nissan", "mazda", "subaru", "hyundai", "kia", "volkswagen",
      "tesla", "lexus", "acura", "audi", "bmw", "mercedes"]),
    ("moto", "Moto", "vehicule",
     ["motocyclette", "motorcycle", "ktm", "yamaha", "kawasaki", "suzuki",
      "husqvarna", "ducati", "harley", "harley-davidson", "triumph",
      "aprilia", "indian", "royal enfield", "bmw moto"]),
    ("vtt", "VTT / Quad", "vehicule",
     ["atv", "quad", "polaris sportsman", "can-am outlander", "yamaha grizzly"]),
    ("motoneige", "Motoneige", "vehicule",
     ["snowmobile", "ski-doo", "skidoo", "polaris rmk", "arctic cat"]),
    ("sxs", "Côte-à-côte (SxS)", "vehicule",
     ["side-by-side", "side by side", "side x side", "côte-à-côte", "cote a cote",
      "utv", "polaris ranger", "polaris rzr", "polaris general", "ranger eps",
      "can-am maverick", "can-am commander", "can-am defender",
      "kawasaki mule", "kawasaki teryx", "yamaha wolverine", "yamaha yxz",
      "honda talon", "honda pioneer"]),
    ("nautique", "Nautique", "vehicule",
     ["bateau", "boat", "sea-doo", "seadoo", "yacht", "ponton"]),
    ("scooter-vehicule", "Scooter / Mobylette", "vehicule",
     ["scooter", "mobylette", "vespa", "piaggio"]),
    ("vehicule-electrique", "Véhicule électrique", "vehicule",
     ["ev", "electric vehicle", "tesla model", "rivian", "lucid", "polestar"]),
    ("remorque", "Remorque", "vehicule",
     ["trailer", "remorque utilitaire", "remorque fermée"]),

    # ============ ACCESSOIRES ============
    ("accessoire", "Accessoire", None, ["accessoires", "accessory", "gear", "équipement"]),
    ("accessoire-moto", "Accessoire moto", "accessoire",
     ["casque moto", "gants moto", "veste moto", "bottes moto", "intercom",
      "motorcycle jacket", "motorcycle gear", "riding jacket", "motorcycle gloves",
      "alpinestars", "dainese", "rev'it", "klim", "fox", "shoei", "arai", "agv",
      "hjc", "scorpion", "icon", "bell"]),
    ("accessoire-auto", "Accessoire auto", "accessoire",
     ["pneus", "tire", "batterie auto", "tapis auto", "porte-bagages",
      "barres de toit", "roof rack"]),
    ("accessoire-vtt", "Accessoire VTT", "accessoire",
     ["treuil", "kit boue", "support arme vtt", "remorque vtt"]),
    ("accessoire-motoneige", "Accessoire motoneige", "accessoire",
     ["chenille", "manchon motoneige", "cabine motoneige", "snowmobile",
      "snowmobile jacket", "snowmobile gloves", "ski-doo jacket", "skidoo jacket"]),
    ("accessoire-velo", "Accessoire vélo", "accessoire",
     ["casque vélo", "porte-vélo", "antivol vélo", "gourde vélo"]),
    ("accessoire-camping", "Accessoire camping", "accessoire",
     ["lampe frontale", "matelas camping", "réchaud camping", "couteau suisse"]),

    # ============ PIÈCES ============
    ("piece", "Pièce détachée", None, ["pieces", "parts", "pièce"]),
    ("piece-moto", "Pièce moto", "piece",
     ["filtre huile moto", "bougie", "chaîne moto", "pignon", "carburateur"]),
    ("piece-auto", "Pièce auto", "piece",
     ["alternateur", "démarreur", "amortisseur", "plaquette frein", "rotor",
      "filtre à air auto", "batterie voiture", "essuie-glace"]),
    ("piece-vtt", "Pièce VTT", "piece", ["pignon vtt", "chaîne vtt"]),
    ("piece-motoneige", "Pièce motoneige", "piece", ["courroie motoneige", "ski"]),

    # ============ ÉLECTRONIQUE ============
    ("electronique", "Électronique", None, ["electronics", "électronique"]),
    ("cellulaire", "Cellulaire / Téléphone", "electronique",
     ["téléphone", "phone", "smartphone", "iphone", "android",
      "samsung galaxy", "google pixel", "oneplus", "xiaomi"]),
    ("accessoire-cellulaire", "Accessoire cellulaire", "electronique",
     ["coque iphone", "case", "chargeur", "powerbank", "câble usb-c", "lightning"]),
    ("ordinateur", "Ordinateur", "electronique",
     ["laptop", "macbook", "pc gaming", "tour", "thinkpad", "dell xps"]),
    ("composant-pc", "Composant PC", "electronique",
     ["cpu", "gpu", "carte mère", "ram ddr", "ssd nvme", "rtx", "ryzen", "intel core"]),
    ("peripherique-pc", "Périphérique PC", "electronique",
     ["clavier", "souris", "casque gaming", "webcam", "microphone usb",
      "moniteur", "écran 4k", "logitech", "razer", "corsair"]),
    ("tablette", "Tablette", "electronique", ["tablet", "ipad", "galaxy tab"]),
    ("audio", "Audio / Casque", "electronique",
     ["headphones", "écouteurs", "haut-parleur", "speaker", "airpods",
      "wh-1000xm", "sony wh", "bose qc", "sennheiser", "jbl", "beats",
      "earbuds", "casque sans fil"]),
    ("tv", "Téléviseur", "electronique", ["télévision", "television", "écran tv",
                                           "oled", "qled", "smart tv", "lg tv", "samsung tv"]),
    ("console-jeux", "Console de jeux", "electronique",
     ["ps5", "ps4", "xbox", "switch", "nintendo", "steam deck"]),
    ("jeux-video", "Jeu vidéo", "electronique",
     ["jeu ps5", "jeu xbox", "jeu switch", "fifa", "call of duty", "zelda"]),
    ("photo-video", "Photo / Vidéo", "electronique",
     ["caméra", "appareil photo", "gopro", "drone", "dji", "objectif",
      "sony alpha", "canon eos", "nikon"]),
    ("montre-connectee", "Montre connectée", "electronique",
     ["smartwatch", "apple watch", "garmin", "fitbit", "samsung watch", "polar"]),
    ("domotique", "Domotique / Maison connectée", "electronique",
     ["alexa", "google home", "echo dot", "ring", "nest", "philips hue"]),
    ("imprimante", "Imprimante / Scanner", "electronique",
     ["printer", "imprimante laser", "imprimante jet", "scanner", "epson", "brother"]),
    ("reseau", "Réseau / WiFi", "electronique",
     ["routeur", "router", "modem", "switch ethernet", "mesh wifi",
      "tp-link", "asus router", "ubiquiti", "netgear"]),

    # ============ MAISON ============
    ("maison", "Maison", None, ["home", "house"]),
    ("meuble", "Meuble", "maison",
     ["furniture", "canapé", "sofa", "table", "chaise", "lit", "matelas",
      "commode", "bureau", "bibliothèque", "ikea"]),
    ("electromenager", "Électroménager", "maison",
     ["appliance", "frigo", "réfrigérateur", "lave-vaisselle", "micro-ondes",
      "aspirateur", "dyson", "robot aspirateur", "roomba", "lave-linge",
      "sécheuse", "cuisinière", "four"]),
    ("petit-electromenager", "Petit électroménager", "maison",
     ["mélangeur", "blender", "vitamix", "kitchenaid", "instant pot",
      "ninja", "robot culinaire", "machine espresso", "nespresso"]),
    ("decoration", "Décoration", "maison",
     ["lampe", "tapis", "miroir", "cadre", "rideau", "coussin"]),
    ("literie", "Literie", "maison",
     ["draps", "couette", "oreiller", "matelas mémoire"]),
    ("jardin", "Jardin / Extérieur", "maison",
     ["bbq", "barbecue", "weber", "tondeuse", "souffleur", "taille-haie",
      "table patio", "chaise patio"]),
    ("salle-de-bain", "Salle de bain", "maison",
     ["robinet", "douchette", "miroir salle de bain"]),
    ("eclairage", "Éclairage", "maison",
     ["ampoule", "led", "luminaire", "plafonnier", "lampe de chevet"]),

    # ============ MODE ============
    ("mode", "Mode / Vêtements", None, ["fashion", "clothing", "vêtement"]),
    ("chaussures", "Chaussures", "mode",
     ["shoes", "souliers", "bottes", "sneakers", "running shoes",
      "nike air", "adidas", "puma", "reebok", "new balance", "asics",
      "vans", "converse", "timberland", "sorel", "merrell"]),
    ("vetement-homme", "Vêtement homme", "mode",
     ["chemise homme", "pantalon homme", "veston", "complet", "polo"]),
    ("vetement-femme", "Vêtement femme", "mode",
     ["robe", "jupe", "blouse", "chandail femme", "pantalon femme"]),
    ("vetement-enfant", "Vêtement enfant", "mode",
     ["pyjama enfant", "manteau enfant", "vêtement bébé"]),
    ("manteau", "Manteau / Veste", "mode",
     ["jacket", "manteau hiver", "doudoune", "canada goose", "north face",
      "patagonia", "columbia"]),
    ("sac", "Sac / Bagage", "mode",
     ["bag", "sac à main", "sac à dos", "valise", "porte-document",
      "louis vuitton", "michael kors", "coach"]),
    ("montre", "Montre / Bijoux", "mode",
     ["watch", "bijou", "bracelet", "collier", "bague", "rolex", "omega"]),
    ("lunettes", "Lunettes / Solaires", "mode",
     ["lunettes de soleil", "ray-ban", "oakley", "monture lunettes"]),

    # ============ SPORT ============
    ("sport", "Sport / Plein air", None, ["outdoor", "fitness"]),
    ("velo", "Vélo", "sport",
     ["bike", "bicyclette", "bicycle", "vélo de montagne", "vélo route",
      "vélo électrique", "trek", "specialized", "giant", "cannondale"]),
    ("ski-snowboard", "Ski / Snowboard", "sport",
     ["ski", "snowboard", "raquette", "rossignol", "burton", "salomon"]),
    ("patinage-hockey", "Patin / Hockey", "sport",
     ["bauer", "ccm", "hockey", "patin", "bâton hockey", "rondelle"]),
    ("camping", "Camping / Randonnée", "sport",
     ["tente", "sac de couchage", "rando", "mec", "msr",
      "coleman", "thermos", "yeti"]),
    ("peche-chasse", "Pêche / Chasse", "sport",
     ["canne à pêche", "moulinet", "leurre", "arc", "carabine", "winchester"]),
    ("musculation", "Musculation / Gym", "sport",
     ["haltère", "kettlebell", "tapis roulant", "vélo stationnaire", "yoga",
      "rameur", "élastique"]),
    ("golf", "Golf", "sport",
     ["golf", "club golf", "balle golf", "callaway", "titleist", "ping"]),
    ("piscine-spa", "Piscine / Spa", "sport",
     ["piscine", "spa", "jacuzzi", "filtre piscine", "chlore"]),

    # ============ ENFANT / BÉBÉ ============
    ("enfant", "Enfant / Bébé", None, ["baby", "kids", "children"]),
    ("jouet", "Jouet", "enfant",
     ["jouet", "lego", "playmobil", "barbie", "hot wheels", "puzzle",
      "peluche", "poupée", "figurine"]),
    ("bebe-equipement", "Équipement bébé", "enfant",
     ["poussette", "siège auto bébé", "table à langer", "chaise haute"]),
    ("livre-enfant", "Livre enfant", "enfant",
     ["livre enfant", "livre bébé", "album illustré"]),

    # ============ CULTURE ============
    ("culture", "Culture / Loisirs", None, ["books", "music"]),
    ("livre", "Livre", "culture",
     ["livre", "roman", "essai", "bd", "manga", "livre poche"]),
    ("musique", "Musique / Vinyle", "culture",
     ["vinyle", "vinyl", "disque", "cd", "instrument musique",
      "guitare", "piano", "ukulele"]),
    ("film", "Film / Blu-ray", "culture",
     ["bluray", "blu-ray", "dvd", "film hd"]),
    ("art-collection", "Art / Collection", "culture",
     ["tableau", "peinture", "sculpture", "carte pokémon", "carte sport"]),

    # ============ BEAUTÉ / SANTÉ ============
    ("beaute-sante", "Beauté / Santé", None, ["beauty", "health"]),
    ("cosmetique", "Cosmétique", "beaute-sante",
     ["maquillage", "rouge à lèvres", "fond de teint", "mascara",
      "lancôme", "chanel", "dior", "mac"]),
    ("soin-cheveux", "Soin cheveux", "beaute-sante",
     ["shampoing", "revitalisant", "fer à friser", "sèche-cheveux", "dyson airwrap"]),
    ("parfum", "Parfum", "beaute-sante",
     ["parfum", "fragrance", "eau de toilette", "cologne"]),
    ("soin-peau", "Soin peau", "beaute-sante",
     ["crème visage", "sérum", "anti-âge", "the ordinary", "cerave"]),
    ("appareil-medical", "Appareil médical", "beaute-sante",
     ["tensiomètre", "thermomètre", "glucomètre", "oxymètre"]),
    ("supplement", "Supplément / Vitamine", "beaute-sante",
     ["vitamine", "protéine whey", "créatine", "oméga 3", "magnésium"]),

    # ============ OUTILS ============
    ("outils", "Outils / Bricolage", None, ["tools", "hardware"]),
    ("outil-electrique", "Outil électrique", "outils",
     ["perceuse", "scie", "ponceuse", "meuleuse", "milwaukee", "dewalt",
      "makita", "ryobi", "bosch"]),
    ("outil-main", "Outil à main", "outils",
     ["marteau", "tournevis", "pince", "clé", "ruban à mesurer"]),
    ("quincaillerie", "Quincaillerie", "outils",
     ["vis", "boulon", "rondelle", "ancrage"]),
    ("rangement-atelier", "Rangement atelier", "outils",
     ["coffre à outils", "boîte à outils", "établi"]),

    # ============ ANIMALERIE ============
    ("animal", "Animalerie", None, ["pet"]),
    ("chien", "Chien", "animal",
     ["nourriture chien", "laisse", "collier chien", "cage chien"]),
    ("chat", "Chat", "animal",
     ["nourriture chat", "litière", "arbre à chat"]),
    ("aquarium-reptile", "Aquarium / Reptile", "animal",
     ["aquarium", "filtre aquarium", "vivarium"]),

    # ============ AUTO PRO / INDUSTRIEL ============
    ("industriel", "Industriel / Pro", None, ["industrial"]),
    ("compresseur", "Compresseur / Génératrice", "industriel",
     ["compresseur", "génératrice", "honda eu"]),
    ("levage", "Levage / Manutention", "industriel",
     ["chariot élévateur", "transpalette", "cric"]),

    # ============ IMMOBILIER ============
    ("immobilier", "Immobilier", None, ["real estate"]),
    ("maison-vente", "Maison à vendre", "immobilier",
     ["maison à vendre", "duplex", "triplex", "condo à vendre", "bungalow"]),
    ("location", "Location", "immobilier",
     ["appartement à louer", "logement à louer", "loyer"]),
    ("terrain", "Terrain", "immobilier",
     ["terrain à vendre", "lot", "boisé"]),

    # ============ EMPLOI ============
    ("emploi", "Emploi", None, ["jobs", "career"]),
    ("emploi-informatique", "Emploi informatique", "emploi",
     ["développeur", "data scientist", "devops"]),
    ("emploi-construction", "Emploi construction", "emploi",
     ["électricien", "plombier", "menuisier"]),

    # ============ SERVICES ============
    ("service", "Service", None, ["services"]),
    ("service-auto", "Service auto", "service",
     ["mécanique", "garage", "remorquage"]),
    ("service-renovation", "Service rénovation", "service",
     ["rénovation", "entrepreneur", "peintre"]),
]


# Construction des registries
_CATEGORIES_BY_SLUG: Dict[str, Category] = {}
_PATHS_BY_SLUG: Dict[str, str] = {}


def _build_tree() -> None:
    for slug, name, parent, aliases in _TREE_DEF:
        _CATEGORIES_BY_SLUG[slug] = Category(
            slug=slug, name=name, parent=parent, aliases=list(aliases),
        )
    # Calculer les chemins complets
    for slug, cat in _CATEGORIES_BY_SLUG.items():
        if slug.startswith("__"):
            continue
        path_parts: List[str] = [slug]
        current = cat.parent
        while current:
            path_parts.append(current)
            parent_cat = _CATEGORIES_BY_SLUG.get(current)
            current = parent_cat.parent if parent_cat else None
        _PATHS_BY_SLUG[slug] = ".".join(reversed(path_parts))
    # Calculer les enfants
    for slug, cat in list(_CATEGORIES_BY_SLUG.items()):
        if slug.startswith("__") or not cat.parent:
            continue
        parent_cat = _CATEGORIES_BY_SLUG.get(cat.parent)
        if parent_cat and slug not in parent_cat.children:
            parent_cat.children.append(slug)


_build_tree()


# ---------------------------------------------------------------------------
# API publique
# ---------------------------------------------------------------------------

def get_category(slug_or_path: str) -> Optional[Category]:
    """Récupère une catégorie par son slug ('moto') ou son path ('vehicule.moto')."""
    if not slug_or_path:
        return None
    if "." in slug_or_path:
        slug = slug_or_path.split(".")[-1]
    else:
        slug = slug_or_path
    return _CATEGORIES_BY_SLUG.get(slug)


def get_path(slug: str) -> Optional[str]:
    """Renvoie le path complet pour un slug donné."""
    return _PATHS_BY_SLUG.get(slug)


def all_paths() -> List[str]:
    """Liste tous les paths disponibles."""
    return sorted(_PATHS_BY_SLUG.values())


def root_categories() -> List[Category]:
    """Catégories racines (sans parent)."""
    return [c for c in _CATEGORIES_BY_SLUG.values()
            if c.parent is None and not c.slug.startswith("__")]


def children_of(slug_or_path: str) -> List[Category]:
    """Liste les enfants directs d'une catégorie."""
    cat = get_category(slug_or_path)
    if not cat:
        return []
    return [_CATEGORIES_BY_SLUG[s] for s in cat.children if s in _CATEGORIES_BY_SLUG]


def is_under(child_path: str, parent_path: str) -> bool:
    """True si `child_path` est sous `parent_path` (ou égal).

    Exemples :
      is_under('vehicule.moto', 'vehicule')    → True
      is_under('vehicule.moto', 'vehicule.moto') → True
      is_under('vehicule.moto', 'electronique') → False
      is_under('vehicule', 'vehicule.moto')    → False (parent n'est pas sous enfant)
    """
    if not child_path or not parent_path:
        return False
    c = child_path.lower().strip().strip(".")
    p = parent_path.lower().strip().strip(".")
    if c == p:
        return True
    return c.startswith(p + ".")


def category_matches(query_path: str, served_paths: List[str]) -> bool:
    """True si l'une des catégories servies par un adapter couvre la requête.

    `query_path` : ce que cherche l'utilisateur (ex: 'accessoire.accessoire-moto').
    `served_paths` : ce que l'adapter sert (ex: ['vehicule.moto', 'accessoire.accessoire-moto']).

    Matching :
      - Si `served = "vehicule"` → couvre TOUTE la sous-arbre véhicules
        (donc "vehicule.moto" matche).
      - Si `served = "vehicule.moto"` → couvre EXACTEMENT moto (ou plus spécifique).
      - "*" en wildcard couvre tout.
    """
    if not query_path:
        return True
    if not served_paths:
        return True  # adapter sans contrainte = accepte tout
    for served in served_paths:
        if served == "*" or served == "all":
            return True
        # L'adapter sert `served` (ex: 'vehicule') → couvre query si query est sous served
        if is_under(query_path, served):
            return True
        # OU la requête est plus large que l'adapter (ex: query='vehicule', served='vehicule.moto')
        # → l'adapter est pertinent (il sert un sous-ensemble de ce que veut l'utilisateur)
        if is_under(served, query_path):
            return True
    return False


def detect_category_from_text(text: str) -> Optional[str]:
    """Heuristique : devine la catégorie depuis du texte libre.
    Renvoie un path ('electronique.cellulaire') ou None si pas de match clair.

    Utilisé en fallback quand l'utilisateur n'a pas pré-sélectionné de catégorie."""
    if not text:
        return None
    t = text.lower()
    best: Optional[tuple] = None  # (specificity, path)
    for slug, cat in _CATEGORIES_BY_SLUG.items():
        if slug.startswith("__") or not cat.parent:
            continue  # on ne match que les feuilles
        for kw in cat.aliases + [cat.name.lower(), slug]:
            if not kw:
                continue
            kw_clean = kw.replace("-", " ")
            if (kw_clean in t or kw in t) and (
                best is None or len(kw) > best[0]
            ):
                best = (len(kw), _PATHS_BY_SLUG[slug])
    return best[1] if best else None


# ---------------------------------------------------------------------------
# Helpers d'affichage CLI
# ---------------------------------------------------------------------------

def render_tree(indent: int = 0, parent: Optional[str] = None,
                 buf: Optional[List[str]] = None) -> str:
    """Rendu en arbre pour la CLI (utile pour --browse)."""
    if buf is None:
        buf = []
    nodes = ([_CATEGORIES_BY_SLUG[s] for s in _CATEGORIES_BY_SLUG[parent].children]
             if parent and parent in _CATEGORIES_BY_SLUG
             else root_categories())
    for cat in nodes:
        marker = "▸" if cat.children else "·"
        path = _PATHS_BY_SLUG.get(cat.slug, cat.slug)
        buf.append(f"{'  ' * indent}{marker} {cat.name:30s} [{path}]")
        if cat.children:
            render_tree(indent + 1, parent=cat.slug, buf=buf)
    return "\n".join(buf)
