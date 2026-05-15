/**
 * Suggestions de trims / finitions / variantes par catégorie de véhicule.
 *
 * Affichées dans le `<datalist>` du champ « Trim / Finition » de la page
 * « Recherche par produit ». Le but est de proposer des autocomplétions
 * COHÉRENTES avec la catégorie sélectionnée — un utilisateur en Moto ne doit
 * pas voir « Lariat » ou « XLT » (trims Ford pickups), et inversement.
 *
 * Ces listes sont SEULEMENT des suggestions UI. Le matching réel de trim
 * lors de l'évaluation de valeur passe par `variant-premiums.ts`, qui doit
 * rester l'autorité technique.
 */

/**
 * Trims/finitions courants en AUTO (pickup, VUS, berline) au marché canadien.
 *
 * L'ordre privilégie les marques populaires au Québec en premier. Doit rester
 * aligné avec les `aliases` de `variant-premiums.ts` pour que la détection
 * trouve une correspondance.
 */
const AUTO_TRIMS: string[] = [
  // Ford pickups & SUV
  "XL", "STX", "XLT", "Lariat", "King Ranch", "Tremor", "Platinum",
  "Raptor", "Lightning", "Titanium", "ST Line",
  // Chevrolet
  "WT (Work Truck)", "LS", "LT", "RST", "LTZ", "Z71", "Trail Boss",
  "High Country", "ZR2", "ZL1", "SS", "Custom",
  // GMC
  "SLE", "SLT", "AT4", "AT4X", "Denali", "Elevation",
  // RAM
  "Tradesman", "Express", "Big Horn", "Lone Star", "Laramie", "Rebel",
  "Longhorn", "Limited", "TRX", "Power Wagon", "Warlock",
  // Toyota
  "SR", "SR5", "TRD Sport", "TRD Off-Road", "TRD Pro", "1794 Edition",
  "LE", "XLE", "XSE", "Limited Toyota", "Platinum Toyota",
  // Honda
  "DX", "LX", "EX", "EX-L", "Sport", "Touring", "Type R", "Si",
  "TrailSport", "Black Edition",
  // Hyundai
  "Essential", "Preferred", "Luxury", "Ultimate", "N Line", "N",
  // Kia
  "LX Kia", "EX Kia", "SX", "GT-Line", "GT",
  // Nissan
  "S", "SV", "SL", "Platinum Nissan", "Pro-4X", "Pro-X", "Nismo",
  "Midnight Edition",
  // Volkswagen
  "Trendline", "Comfortline", "Highline", "Execline", "R-Line", "GTI",
  "GLI", "Golf R",
  // Audi
  "Audi Premium", "Premium Plus", "Prestige", "S-Line", "RS",
  "Komfort", "Progressiv", "Technik",
  // BMW
  "M Sport", "xDrive", "M3", "M4", "M5", "M340i", "M440i",
  // Mercedes-Benz
  "AMG", "4MATIC", "AMG Line",
  // Subaru
  "Convenience", "Touring Subaru", "Sport Subaru", "Limited Subaru",
  "Wilderness", "WRX", "STI",
  // Jeep
  "Sport Jeep", "Sahara", "Rubicon", "Trailhawk", "Overland", "Summit",
  "High Altitude", "Altitude",
  // Génériques / motorisations
  "Diesel", "Hybrid", "Plug-in Hybrid", "Electric", "Off-Road",
  "Crew Cab", "Supercrew", "Quad Cab", "King Cab",
]

/**
 * Trims/variantes/éditions courants en MOTO (route et off-road).
 *
 * Les "trims" moto correspondent typiquement à :
 *  - gammes (SX, EXC, Ninja, CBR, MT…)
 *  - éditions limitées (Factory, Heritage, Rockstar, Six Days…)
 *  - configurations roues (19/16, 17/14 pour jeunes)
 *  - variantes (ABS, SP, RR)
 */
const MOTO_TRIMS: string[] = [
  // Éditions premium (toutes marques) — souvent +1000$ à +2500$
  "Factory Edition", "Heritage", "Rockstar Edition", "Six Days",
  "Limited Edition", "Anniversary Edition", "Trophy Edition",
  // Configurations de roues motocross (jeunes / adultes)
  "19/16", "17/14", "16/14", "14/12",
  // KTM
  "SX", "SX-F", "XC", "XC-F", "XC-W", "EXC", "EXC-F", "SMR",
  "Adventure", "Duke", "RC", "Super Duke",
  // Husqvarna (gammes off-road + supermoto)
  "TC", "FC", "TX", "TE", "FE", "FX", "FS", "EE",
  // Gas Gas
  "MC", "EC", "EX",
  // Beta
  "RR", "RX", "X-Trainer",
  // Yamaha
  "YZ", "YZ-F", "WR", "WR-F", "YZF-R", "R1", "R6", "R7",
  "MT-07", "MT-09", "MT-10", "Ténéré", "Tracer", "Bolt", "Super Ténéré",
  // Honda
  "CRF", "CRF-R", "CRF-X", "CRF-RX", "CRF-RWE",
  "CBR", "CB", "NC", "Fireblade", "Rebel", "Africa Twin", "Gold Wing",
  "Grom", "Monkey", "Trail125",
  // Kawasaki
  "KX", "KX-F", "KLX", "Ninja",
  "ZX-6R", "ZX-10R", "ZX-14R", "Z650", "Z900", "Z H2",
  "Versys", "Vulcan", "Concours",
  // Suzuki
  "RM-Z", "DR-Z", "DR",
  "GSX-R", "GSX-S", "Hayabusa", "V-Strom", "Boulevard", "Katana",
  // BMW
  "R 1250 GS", "R nineT", "S 1000 RR", "S 1000 XR", "F 850 GS", "G 310",
  "K 1600",
  // Ducati
  "Panigale", "Monster", "Multistrada", "Diavel", "Streetfighter",
  "Hypermotard", "Scrambler", "DesertX",
  // Triumph
  "Daytona", "Speed Triple", "Street Triple", "Tiger", "Bonneville",
  "Speed Twin", "Rocket 3",
  // Harley-Davidson
  "Sportster", "Softail", "Touring", "Pan America", "Street Glide",
  "Road King", "Road Glide", "Fat Boy", "Heritage Classic", "LiveWire",
  // Aprilia / MV Agusta / Indian
  "RSV4", "Tuono", "RS 660",
  "F3", "Brutale", "Turismo Veloce",
  "Scout", "Chief", "Chieftain", "Roadmaster", "Springfield",
  // Variantes / suffixes courants
  "ABS", "Non-ABS", "SP", "SP1", "SP2", "RR", "RWE", "GT",
]

/**
 * Trims/gammes courants en VTT (quad) et SxS (côte-à-côte).
 */
const VTT_SXS_TRIMS: string[] = [
  // Variantes / packages communs
  "EPS", "DPS", "DS", "Pro", "Premium", "Limited", "XT", "XT-P",
  "X mr", "X3 RS", "X RS", "X DS", "MAX", "RT", "LE", "Highlifter",
  "Sport", "Northstar",
  // Can-Am VTT
  "Outlander", "Renegade", "DS 90",
  // Can-Am SxS
  "Defender", "Maverick", "Maverick X3", "Commander",
  // Polaris VTT
  "Sportsman", "Scrambler",
  // Polaris SxS
  "RZR", "RZR XP", "RZR Pro", "RZR Turbo R",
  "Ranger", "Ranger XP", "General",
  // Yamaha VTT
  "Grizzly", "Kodiak", "Raptor", "YFZ",
  // Yamaha SxS
  "Wolverine", "Wolverine RMAX", "YXZ",
  // Honda VTT
  "Rancher", "Foreman", "Rubicon", "TRX",
  // Honda SxS
  "Pioneer", "Talon",
  // Kawasaki
  "Brute Force", "Mule", "Mule PRO", "Teryx", "KRX",
  // Arctic Cat
  "Alterra", "Wildcat", "Prowler", "Tracker",
  // CFMOTO
  "CForce", "UForce", "ZForce",
]

/**
 * Trims/gammes courants en MOTONEIGE.
 */
const MOTONEIGE_TRIMS: string[] = [
  // Ski-Doo gammes
  "Summit", "MXZ", "Renegade", "Backcountry", "Freeride", "Skandic",
  "Tundra", "Expedition", "GSX", "Grand Touring",
  // Ski-Doo variantes / packages
  "X-RS", "X", "Adrenaline", "Sport", "Sport SE", "TNT", "Neo",
  "Edge", "Limited", "Enduro", "Sport Special",
  // Ski-Doo motorisations
  "850 E-TEC", "850 E-TEC Turbo R", "900 ACE", "900 ACE Turbo",
  "600R E-TEC", "600 EFI",
  // Polaris
  "RMK", "Pro-RMK", "Indy", "Switchback", "Rush", "Voyageur", "Titan",
  "Patriot Boost",
  // Arctic Cat
  "ZR", "M", "Norseman", "Bearcat", "Riot", "Blast",
  // Yamaha
  "Sidewinder", "Apex", "Vector", "Phazer", "Venture",
  // Variantes communes
  "Mountain", "Trail", "Crossover", "Utility", "Turbo",
  "137", "146", "154", "165",  // longueurs de chenille
]

/**
 * Trims/gammes courants en NAUTIQUE (bateaux à moteur, ponton, sport).
 *
 * En nautique, le « trim » correspond plutôt :
 *  - au type de coque (Bowrider, Cuddy Cabin, Pontoon, Wake/Ski…)
 *  - à la série (Flight Series, VR4, SDX…)
 *  - à la motorisation (Outboard, Inboard, Sterndrive…)
 */
const NAUTIQUE_TRIMS: string[] = [
  // Types de coques
  "Bowrider", "Cuddy Cabin", "Walkaround", "Center Console", "Pontoon",
  "Tritoon", "Deck Boat", "Jet Boat", "Wakeboard", "Ski Boat",
  "Fishing", "Bass Boat", "Aluminum Fishing", "Pontoon Sport",
  "Bay Boat", "Express Cruiser",
  // Bayliner séries
  "Flight Series", "Element", "VR4", "VR5", "VR6",
  "DX2000", "DX2050", "M15", "M17", "M19",
  // Sea Ray séries
  "SLX", "SDX", "SPX", "Sundancer", "Sundeck", "Sport Boat",
  // Chaparral séries
  "SSi", "SSX", "Suncoast", "Surf", "VRX", "OSX",
  // Crownline / Larson / Four Winns
  "Eclipse", "FS Series", "Vista", "TS Series", "Surf Series", "Horizon",
  // MasterCraft / Malibu / Tigé (wake)
  "ProStar", "X-Series", "NXT", "XT", "Wakesetter",
  "M Series", "LXi", "VLX", "VTX", "RZR Boat",
  // Yamaha jet boat
  "AR", "SX", "FSH",
  // Motorisations
  "Outboard", "Inboard", "Inboard/Outboard", "Sterndrive", "Jet Drive",
]

/**
 * Trims pour scooters (segment plus modeste — peu de variations).
 */
const SCOOTER_TRIMS: string[] = [
  "ABS", "Sport", "Premium", "Limited",
  // Vespa
  "Primavera", "Sprint", "GTS", "GTV", "LX",
  // Honda
  "PCX", "ADV", "Forza", "SH", "Dio",
  // Yamaha
  "NMAX", "XMAX", "Zuma", "Vino",
  // Piaggio / Kymco
  "Liberty", "BV", "MP3",
  "Like", "Agility", "People",
]

/**
 * Catégorie → liste de trims correspondante.
 * Les clés correspondent à des préfixes de `categoryPath`.
 */
const TRIMS_BY_CATEGORY: Record<string, string[]> = {
  "vehicule.auto": AUTO_TRIMS,
  "vehicule.moto": MOTO_TRIMS,
  "vehicule.vtt": VTT_SXS_TRIMS,
  "vehicule.sxs": VTT_SXS_TRIMS,
  "vehicule.motoneige": MOTONEIGE_TRIMS,
  "vehicule.nautique": NAUTIQUE_TRIMS,
  "vehicule.scooter": SCOOTER_TRIMS,
}

/**
 * Placeholder du champ « Trim / Finition » par catégorie.
 * Affiche des exemples cohérents avec ce que l'utilisateur cherche.
 */
const PLACEHOLDER_BY_CATEGORY: Record<string, string> = {
  "vehicule.auto": "ex: Lariat, XLT, Sport, Limited",
  "vehicule.moto": "ex: Factory Edition, 19/16, ABS, SP",
  "vehicule.vtt": "ex: EPS, XT, X mr, Limited",
  "vehicule.sxs": "ex: Maverick X3 RS, RZR XP, Pro",
  "vehicule.motoneige": "ex: X-RS, 850 E-TEC, Adrenaline",
  "vehicule.nautique": "ex: Flight Series, Bowrider, SLX",
  "vehicule.scooter": "ex: GTS, Primavera, ABS",
}

const DEFAULT_PLACEHOLDER = "ex: Sport, Limited, Pro, Edition"

/**
 * Retourne la liste de trims pour une catégorie donnée.
 * Si la catégorie n'est pas reconnue (ou null), renvoie une liste vide
 * pour ne pas suggérer de trims hors-sujet.
 */
export function trimsForCategory(
  categoryPath: string | null | undefined,
): string[] {
  if (!categoryPath) return []
  for (const [prefix, trims] of Object.entries(TRIMS_BY_CATEGORY)) {
    if (categoryPath === prefix || categoryPath.startsWith(prefix + ".")) {
      return trims
    }
  }
  return []
}

/**
 * Retourne le placeholder du champ trim pour une catégorie donnée.
 */
export function trimPlaceholderForCategory(
  categoryPath: string | null | undefined,
): string {
  if (!categoryPath) return DEFAULT_PLACEHOLDER
  for (const [prefix, placeholder] of Object.entries(PLACEHOLDER_BY_CATEGORY)) {
    if (categoryPath === prefix || categoryPath.startsWith(prefix + ".")) {
      return placeholder
    }
  }
  return DEFAULT_PLACEHOLDER
}
