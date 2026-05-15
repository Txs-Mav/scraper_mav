export interface VariantPremium {
  key: string
  label: string
  aliases: string[]
  premium: number
}

const COMMON_VARIANTS: VariantPremium[] = [
  { key: "eps", label: "EPS", aliases: ["eps"], premium: 500 },
  { key: "winch", label: "Treuil", aliases: ["treuil", "winch"], premium: 600 },
  { key: "roof", label: "Toit", aliases: ["toit", "roof"], premium: 700 },
  { key: "windshield", label: "Pare-brise", aliases: ["pare brise", "pare-brise", "windshield"], premium: 400 },
  { key: "tracks", label: "Chenilles", aliases: ["chenilles", "track kit", "tracks"], premium: 2500 },
  { key: "premium", label: "Premium", aliases: ["premium", "le"], premium: 200 },
  { key: "crew", label: "Crew", aliases: ["crew"], premium: 1500 },
  { key: "limited", label: "Limited", aliases: ["limited", "ltd"], premium: 1200 },
  { key: "turbo", label: "Turbo", aliases: ["turbo"], premium: 2500 },
  { key: "xmr", label: "X mr", aliases: ["xmr", "x mr"], premium: 1000 },
  { key: "xt", label: "XT", aliases: ["xt"], premium: 600 },
  { key: "xtp", label: "XTP", aliases: ["xtp", "x tp"], premium: 900 },
]

// ---------------------------------------------------------------------------
// Trims auto (pickups, SUV, berlines, sport)
// ---------------------------------------------------------------------------
//
// Les premiums sont des ordres de grandeur (en CAD, par rapport au modèle
// "de base" de la même gamme). Ils servent surtout à filtrer les comparables
// par trim — l'algo de valuation gardera UNIQUEMENT les comparables du même
// trim que le véhicule à évaluer, donc on évite de comparer un XLT à 50k$
// avec un Platinum à 100k$.
//
// Chaque entrée doit avoir des aliases qui couvrent les variantes textuelles
// rencontrées dans les noms de listings (case-insensitive, accent-insensitive,
// tirets normalisés). Les aliases sont matchés via `text.includes(alias)`,
// donc il faut éviter les ambiguïtés ("se" matcherait "sedan" — on préfère
// des aliases avec contexte comme "se trim").
//
// NB: l'ordre influence la détection. Les aliases longs/spécifiques d'abord
// pour éviter qu'un alias court (ex: "lt") matche un alias long
// (ex: "lt premium"). On laisse `parseValuationQuery` consommer le 1er match.

const AUTO_TRIMS: VariantPremium[] = [
  // ────────── Ford pickups & SUV ──────────
  { key: "ford-xl", label: "Ford XL (base)", aliases: ["ford xl ", " xl trim"], premium: 0 },
  { key: "ford-stx", label: "Ford STX", aliases: ["stx"], premium: 0 },
  { key: "ford-xlt", label: "Ford XLT", aliases: ["xlt"], premium: 5000 },
  { key: "ford-lariat", label: "Ford Lariat", aliases: ["lariat"], premium: 15000 },
  { key: "ford-king-ranch", label: "Ford King Ranch", aliases: ["king ranch", "kingranch"], premium: 22000 },
  { key: "ford-tremor", label: "Ford Tremor", aliases: ["tremor"], premium: 18000 },
  { key: "ford-platinum", label: "Ford Platinum", aliases: ["platinum"], premium: 28000 },
  { key: "ford-raptor", label: "Ford Raptor", aliases: ["raptor"], premium: 32000 },
  { key: "ford-lightning", label: "Ford Lightning (EV)", aliases: ["lightning"], premium: 25000 },
  { key: "ford-st", label: "Ford ST", aliases: [" st line", " st-line"], premium: 8000 },
  { key: "ford-titanium", label: "Ford Titanium", aliases: ["titanium"], premium: 6000 },

  // ────────── Chevrolet / GMC pickups & SUV ──────────
  { key: "gm-wt", label: "Work Truck", aliases: [" wt ", "work truck"], premium: 0 },
  { key: "gm-ls", label: "Chevy LS", aliases: [" ls "], premium: 2000 },
  { key: "gm-lt", label: "Chevy LT", aliases: [" lt ", "lt premium"], premium: 5000 },
  { key: "gm-rst", label: "Chevy RST", aliases: ["rst"], premium: 9000 },
  { key: "gm-ltz", label: "Chevy LTZ", aliases: ["ltz"], premium: 14000 },
  { key: "gm-z71", label: "Chevy Z71", aliases: ["z71"], premium: 5000 },
  { key: "gm-trail-boss", label: "Chevy Trail Boss", aliases: ["trail boss", "trailboss"], premium: 12000 },
  { key: "gm-high-country", label: "Chevy High Country", aliases: ["high country", "highcountry"], premium: 22000 },
  { key: "gm-zr2", label: "Chevy ZR2", aliases: ["zr2"], premium: 20000 },
  { key: "gm-zl1", label: "Chevy ZL1", aliases: ["zl1"], premium: 28000 },
  { key: "gm-ss", label: "Chevy SS", aliases: [" ss "], premium: 8000 },
  { key: "gmc-sle", label: "GMC SLE", aliases: ["sle"], premium: 3000 },
  { key: "gmc-slt", label: "GMC SLT", aliases: ["slt"], premium: 8000 },
  { key: "gmc-at4", label: "GMC AT4", aliases: ["at4 ", "at4x"], premium: 16000 },
  { key: "gmc-denali", label: "GMC Denali", aliases: ["denali"], premium: 24000 },
  { key: "gmc-elevation", label: "GMC Elevation", aliases: ["elevation"], premium: 4000 },

  // ────────── RAM ──────────
  { key: "ram-tradesman", label: "RAM Tradesman", aliases: ["tradesman"], premium: 0 },
  { key: "ram-express", label: "RAM Express", aliases: ["express"], premium: 2000 },
  { key: "ram-big-horn", label: "RAM Big Horn", aliases: ["big horn", "bighorn"], premium: 6000 },
  { key: "ram-lone-star", label: "RAM Lone Star", aliases: ["lone star", "lonestar"], premium: 6000 },
  { key: "ram-laramie", label: "RAM Laramie", aliases: ["laramie"], premium: 14000 },
  { key: "ram-rebel", label: "RAM Rebel", aliases: ["rebel"], premium: 13000 },
  { key: "ram-longhorn", label: "RAM Longhorn", aliases: ["longhorn"], premium: 22000 },
  { key: "ram-limited", label: "RAM Limited", aliases: ["ram limited"], premium: 26000 },
  { key: "ram-trx", label: "RAM TRX", aliases: ["trx"], premium: 35000 },
  { key: "ram-power-wagon", label: "RAM Power Wagon", aliases: ["power wagon", "powerwagon"], premium: 20000 },

  // ────────── Toyota / Lexus ──────────
  { key: "toyota-sr", label: "Toyota SR", aliases: [" sr "], premium: 0 },
  { key: "toyota-sr5", label: "Toyota SR5", aliases: ["sr5"], premium: 4000 },
  { key: "toyota-trd-sport", label: "TRD Sport", aliases: ["trd sport", "trdsport"], premium: 7000 },
  { key: "toyota-trd-off-road", label: "TRD Off-Road", aliases: ["trd off road", "trd off-road", "trdor"], premium: 8000 },
  { key: "toyota-trd-pro", label: "TRD Pro", aliases: ["trd pro", "trdpro"], premium: 18000 },
  { key: "toyota-1794", label: "Toyota 1794 Edition", aliases: ["1794"], premium: 22000 },
  { key: "toyota-le", label: "Toyota LE", aliases: [" le "], premium: 2000 },
  { key: "toyota-xle", label: "Toyota XLE", aliases: ["xle"], premium: 6000 },
  { key: "toyota-xse", label: "Toyota XSE", aliases: ["xse"], premium: 8000 },
  { key: "toyota-limited", label: "Toyota Limited", aliases: ["toyota limited"], premium: 14000 },
  { key: "toyota-platinum", label: "Toyota Platinum", aliases: ["toyota platinum"], premium: 22000 },

  // ────────── Honda / Acura ──────────
  { key: "honda-dx", label: "Honda DX", aliases: [" dx "], premium: 0 },
  { key: "honda-lx", label: "Honda LX", aliases: [" lx "], premium: 0 },
  { key: "honda-ex", label: "Honda EX", aliases: [" ex "], premium: 2500 },
  { key: "honda-ex-l", label: "Honda EX-L", aliases: ["ex-l", "exl"], premium: 4500 },
  { key: "honda-sport", label: "Honda Sport", aliases: [" sport "], premium: 3000 },
  { key: "honda-touring", label: "Honda Touring", aliases: ["touring"], premium: 6000 },
  { key: "honda-type-r", label: "Honda Type R", aliases: ["type r", "type-r", "typer"], premium: 18000 },
  { key: "honda-si", label: "Honda Si", aliases: [" si "], premium: 4000 },
  { key: "honda-trailsport", label: "Honda TrailSport", aliases: ["trailsport", "trail sport"], premium: 7000 },
  { key: "honda-black-edition", label: "Honda Black Edition", aliases: ["black edition"], premium: 8000 },

  // ────────── Hyundai / Kia / Genesis ──────────
  { key: "hyundai-essential", label: "Essential (base)", aliases: ["essential"], premium: 0 },
  { key: "hyundai-preferred", label: "Preferred", aliases: ["preferred"], premium: 3000 },
  { key: "hyundai-luxury", label: "Luxury", aliases: ["luxury"], premium: 7000 },
  { key: "hyundai-ultimate", label: "Ultimate", aliases: ["ultimate"], premium: 12000 },
  { key: "hyundai-n-line", label: "N Line", aliases: ["n line", "n-line"], premium: 6000 },
  { key: "hyundai-n", label: "Hyundai N", aliases: [" n "], premium: 9000 },
  { key: "kia-lx", label: "Kia LX", aliases: ["kia lx"], premium: 0 },
  { key: "kia-ex", label: "Kia EX", aliases: ["kia ex"], premium: 3000 },
  { key: "kia-sx", label: "Kia SX", aliases: ["sx"], premium: 9000 },
  { key: "kia-gt-line", label: "Kia GT-Line", aliases: ["gt line", "gt-line"], premium: 7000 },

  // ────────── Nissan ──────────
  { key: "nissan-s", label: "Nissan S", aliases: ["nissan s"], premium: 0 },
  { key: "nissan-sv", label: "Nissan SV", aliases: [" sv "], premium: 3000 },
  { key: "nissan-sl", label: "Nissan SL", aliases: [" sl "], premium: 6000 },
  { key: "nissan-platinum", label: "Nissan Platinum", aliases: ["nissan platinum"], premium: 12000 },
  { key: "nissan-pro4x", label: "Nissan Pro-4X", aliases: ["pro 4x", "pro-4x", "pro4x"], premium: 10000 },
  { key: "nissan-nismo", label: "Nismo", aliases: ["nismo"], premium: 14000 },

  // ────────── Volkswagen / Audi ──────────
  { key: "vw-trendline", label: "VW Trendline", aliases: ["trendline"], premium: 0 },
  { key: "vw-comfortline", label: "VW Comfortline", aliases: ["comfortline"], premium: 4000 },
  { key: "vw-highline", label: "VW Highline", aliases: ["highline"], premium: 8000 },
  { key: "vw-execline", label: "VW Execline", aliases: ["execline"], premium: 12000 },
  { key: "vw-r-line", label: "VW R-Line", aliases: ["r line", "r-line"], premium: 5000 },
  { key: "vw-gti", label: "VW GTI", aliases: ["gti"], premium: 10000 },
  { key: "vw-golf-r", label: "VW Golf R", aliases: ["golf r"], premium: 18000 },
  { key: "audi-premium", label: "Audi Premium", aliases: ["audi premium"], premium: 0 },
  { key: "audi-premium-plus", label: "Audi Premium Plus", aliases: ["premium plus"], premium: 6000 },
  { key: "audi-prestige", label: "Audi Prestige", aliases: ["prestige"], premium: 12000 },
  { key: "audi-rs", label: "Audi RS", aliases: [" rs "], premium: 25000 },
  { key: "audi-s-line", label: "Audi S-line", aliases: ["s line", "s-line"], premium: 6000 },

  // ────────── BMW / Mercedes ──────────
  { key: "bmw-m-sport", label: "BMW M Sport", aliases: ["m sport", "m-sport"], premium: 6000 },
  { key: "bmw-m", label: "BMW M", aliases: [" m3", " m4", " m5", " m340", " m440", " m550"], premium: 20000 },
  { key: "bmw-x-drive", label: "BMW xDrive", aliases: ["xdrive"], premium: 3000 },
  { key: "mb-amg", label: "Mercedes AMG", aliases: ["amg"], premium: 25000 },
  { key: "mb-4matic", label: "Mercedes 4MATIC", aliases: ["4matic"], premium: 3500 },

  // ────────── Subaru ──────────
  { key: "subaru-convenience", label: "Subaru Convenience", aliases: ["convenience"], premium: 0 },
  { key: "subaru-touring", label: "Subaru Touring", aliases: ["subaru touring"], premium: 4000 },
  { key: "subaru-sport", label: "Subaru Sport", aliases: ["subaru sport"], premium: 5500 },
  { key: "subaru-limited", label: "Subaru Limited", aliases: ["subaru limited"], premium: 9000 },
  { key: "subaru-wilderness", label: "Subaru Wilderness", aliases: ["wilderness"], premium: 7000 },
  { key: "subaru-sti", label: "Subaru STI", aliases: ["sti"], premium: 14000 },
  { key: "subaru-wrx", label: "Subaru WRX", aliases: ["wrx"], premium: 10000 },

  // ────────── Jeep ──────────
  { key: "jeep-sport", label: "Jeep Sport", aliases: ["jeep sport"], premium: 0 },
  { key: "jeep-altitude", label: "Jeep Altitude", aliases: ["altitude"], premium: 3000 },
  { key: "jeep-high-altitude", label: "Jeep High Altitude", aliases: ["high altitude", "highaltitude"], premium: 8000 },
  { key: "jeep-sahara", label: "Jeep Sahara", aliases: ["sahara"], premium: 6000 },
  { key: "jeep-rubicon", label: "Jeep Rubicon", aliases: ["rubicon"], premium: 12000 },
  { key: "jeep-overland", label: "Jeep Overland", aliases: ["overland"], premium: 9000 },
  { key: "jeep-summit", label: "Jeep Summit", aliases: ["summit"], premium: 15000 },
  { key: "jeep-trailhawk", label: "Jeep Trailhawk", aliases: ["trailhawk"], premium: 6000 },

  // ────────── Cab types (utile pour pickups) ──────────
  { key: "supercrew", label: "Supercrew", aliases: ["supercrew", "super crew"], premium: 3000 },
  { key: "crew-cab", label: "Crew Cab", aliases: ["crew cab", "crewcab"], premium: 2500 },
  { key: "quad-cab", label: "Quad Cab", aliases: ["quad cab", "quadcab"], premium: 2000 },
  { key: "king-cab", label: "King Cab", aliases: ["king cab", "kingcab"], premium: 1500 },

  // ────────── Moteurs (impact très significatif) ──────────
  { key: "engine-2-7-ecoboost", label: "2.7L V6 EcoBoost", aliases: ["2 7l ecoboost", "27 ecoboost", "2.7l"], premium: 0 },
  { key: "engine-3-5-ecoboost", label: "3.5L V6 EcoBoost", aliases: ["3 5l ecoboost", "35 ecoboost", "3.5l"], premium: 2500 },
  { key: "engine-5-0-v8", label: "5.0L V8", aliases: ["5 0l v8", "5.0l v8", "50 v8"], premium: 3500 },
  { key: "engine-6-2-v8", label: "6.2L V8", aliases: ["6 2l v8", "6.2l v8"], premium: 4500 },
  { key: "engine-powerboost", label: "PowerBoost Hybrid", aliases: ["powerboost", "power boost"], premium: 5500 },
  { key: "engine-hemi", label: "Hemi V8", aliases: ["hemi"], premium: 3500 },
  { key: "engine-cummins", label: "Cummins Diesel", aliases: ["cummins"], premium: 8000 },
  { key: "engine-duramax", label: "Duramax Diesel", aliases: ["duramax"], premium: 8000 },
  { key: "engine-powerstroke", label: "PowerStroke Diesel", aliases: ["powerstroke", "power stroke"], premium: 9000 },

  // ────────── Packages Ford (101A-502A) ──────────
  // Le 1er chiffre est le tier d'équipement. 502A est le plus haut sur F-150
  // Lariat — diff de 5-8k$ vs 301A pour la même année/km.
  { key: "pkg-101a", label: "Package 101A", aliases: ["101a"], premium: 0 },
  { key: "pkg-201a", label: "Package 201A", aliases: ["201a"], premium: 800 },
  { key: "pkg-301a", label: "Package 301A", aliases: ["301a"], premium: 1500 },
  { key: "pkg-302a", label: "Package 302A", aliases: ["302a"], premium: 2500 },
  { key: "pkg-401a", label: "Package 401A", aliases: ["401a"], premium: 3500 },
  { key: "pkg-501a", label: "Package 501A", aliases: ["501a"], premium: 5000 },
  { key: "pkg-502a", label: "Package 502A", aliases: ["502a"], premium: 8000 },
  { key: "pkg-600a", label: "Package 600A", aliases: ["600a"], premium: 6000 },

  // ────────── Drivetrain & off-road ──────────
  { key: "drv-4x4", label: "4x4 / 4WD", aliases: [" 4x4 ", "4 wheel drive"], premium: 2500 },
  { key: "drv-awd", label: "AWD", aliases: [" awd "], premium: 1800 },
  { key: "drv-fx4", label: "FX4 Off-Road", aliases: ["fx4"], premium: 1500 },

  // ────────── Équipement (calibré $) ──────────
  { key: "eq-leather", label: "Cuir", aliases: ["cuir", "leather"], premium: 1000 },
  { key: "eq-heated-seats", label: "Sièges chauffants", aliases: ["heated seats", "sieges chauffants"], premium: 400 },
  { key: "eq-ventilated-seats", label: "Sièges ventilés", aliases: ["ventilated seats", "cooled seats"], premium: 600 },
  { key: "eq-moonroof", label: "Toit ouvrant", aliases: ["moonroof", "sunroof"], premium: 1500 },
  { key: "eq-panoramic", label: "Toit panoramique", aliases: ["panoramic roof", "toit panoramique"], premium: 2200 },
  { key: "eq-nav", label: "Navigation", aliases: ["navigation", " nav "], premium: 500 },
  { key: "eq-adaptive-cruise", label: "Cruise adaptatif", aliases: ["adaptive cruise"], premium: 700 },
  { key: "eq-blind-spot", label: "Angles morts", aliases: ["blind spot", " bsm "], premium: 400 },
  { key: "eq-360-camera", label: "Caméra 360°", aliases: ["360 camera"], premium: 800 },
  { key: "eq-head-up", label: "Head-up display", aliases: ["head up display"], premium: 600 },
  { key: "eq-tow-pkg", label: "Tow Package", aliases: ["tow package", "trailer tow"], premium: 1200 },
  { key: "eq-max-tow", label: "Max Tow Package", aliases: ["max tow"], premium: 1800 },
  { key: "eq-bedliner", label: "Bedliner", aliases: ["bedliner"], premium: 400 },
  { key: "eq-running-boards", label: "Marchepieds", aliases: ["running boards", "marchepieds"], premium: 500 },

  // ────────── Génériques (toutes marques) ──────────
  // Conservés en bas pour ne pas masquer les trims spécifiques au-dessus.
  { key: "limited", label: "Limited (générique)", aliases: ["limited", "ltd"], premium: 8000 },
  { key: "premium-pkg", label: "Premium Package", aliases: ["premium plus", "premium package"], premium: 5000 },
  { key: "diesel", label: "Diesel", aliases: ["diesel", "tdi", "ecodiesel", "powerstroke", "duramax", "cummins", "bluetec"], premium: 7000 },
  { key: "hybrid", label: "Hybrid", aliases: ["hybrid", "hybride", "phev"], premium: 4000 },
  { key: "electric", label: "Electric", aliases: ["electric", "ev "], premium: 8000 },
  { key: "off-road", label: "Off-Road", aliases: ["off road", "off-road", "trailhawk", "rubicon"], premium: 6000 },
]

export const VARIANT_PREMIUMS: Record<string, VariantPremium[]> = {
  moto: [
    { key: "grande-roue", label: "Grande roue", aliases: ["grande roue", "19/16", "1916"], premium: 300 },
    { key: "petite-roue", label: "Petite roue", aliases: ["petite roue", "17/14", "1714"], premium: 0 },
    { key: "factory", label: "Factory Edition", aliases: ["factory", "factory edition"], premium: 1200 },
    { key: "heritage", label: "Heritage", aliases: ["heritage"], premium: 500 },
  ],
  vtt: [
    ...COMMON_VARIANTS,
    { key: "northstar", label: "Northstar", aliases: ["northstar", "north star"], premium: 3000 },
    { key: "xp", label: "XP", aliases: ["xp"], premium: 900 },
    { key: "ranger", label: "Ranger", aliases: ["ranger"], premium: 0 },
  ],
  sxs: [
    ...COMMON_VARIANTS,
    { key: "northstar", label: "Northstar", aliases: ["northstar", "north star"], premium: 3000 },
    { key: "xp", label: "XP", aliases: ["xp"], premium: 900 },
    { key: "ranger", label: "Ranger", aliases: ["ranger"], premium: 0 },
    { key: "defender", label: "Defender", aliases: ["defender"], premium: 0 },
    { key: "maverick", label: "Maverick", aliases: ["maverick"], premium: 1500 },
  ],
  motoneige: [
    { key: "turbo", label: "Turbo", aliases: ["turbo"], premium: 2500 },
    { key: "adrenaline", label: "Adrenaline", aliases: ["adrenaline"], premium: 1200 },
    { key: "xrs", label: "X-RS", aliases: ["x-rs", "xrs", "x rs"], premium: 1200 },
    { key: "summit", label: "Summit", aliases: ["summit"], premium: 0 },
  ],
  nautique: COMMON_VARIANTS,
  auto: AUTO_TRIMS,
  // Pickups, SUV/VUS et berlines partagent la même grille auto.
  pickup: AUTO_TRIMS,
  vus: AUTO_TRIMS,
}

export function getVariantPremiums(categoryKey: string): VariantPremium[] {
  return VARIANT_PREMIUMS[categoryKey] || COMMON_VARIANTS
}
