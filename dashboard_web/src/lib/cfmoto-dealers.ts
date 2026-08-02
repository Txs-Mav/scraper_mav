/**
 * Réseau des concessionnaires CFMOTO au Canada.
 *
 * `status: "active"`  → un scraper dédié alimente déjà `scraped_site_data`
 *                       (le concessionnaire est trouvable via /api/shared-scrapers).
 * `status: "coming"`  → concessionnaire « à venir » : affiché sur /concessionnaires
 *                       et proposé avec un badge « À venir » dans la recherche du
 *                       dashboard, sans être activable comme source.
 *
 * Logos récoltés depuis les sites des concessionnaires et leurs fiches
 * dealer.cfmoto.ca (voir public/dealers/). `logo: null` → pastille initiales.
 */
export interface CfmotoDealer {
  slug: string
  name: string
  city: string
  province: "QC" | "ON" | "AB" | "BC" | "SK" | "MB" | "NB" | "NS" | "PE" | "NL"
  /** Domaine du site du concessionnaire, s'il en a un */
  website: string | null
  /** Fiche dealer.cfmoto.ca / cmimotor.com ou site officiel */
  sourceUrl: string | null
  status: "active" | "coming"
  logo: string | null
}

export const PROVINCE_LABELS: Record<CfmotoDealer["province"], string> = {
  QC: "Québec",
  ON: "Ontario",
  AB: "Alberta",
  BC: "Colombie-Britannique",
  SK: "Saskatchewan",
  MB: "Manitoba",
  NB: "Nouveau-Brunswick",
  NS: "Nouvelle-Écosse",
  PE: "Île-du-Prince-Édouard",
  NL: "Terre-Neuve-et-Labrador",
}

export const PROVINCE_ORDER: CfmotoDealer["province"][] = [
  "QC", "ON", "AB", "BC", "SK", "MB", "NB", "NS", "PE", "NL",
]

export const CFMOTO_DEALERS: CfmotoDealer[] = [
  { slug: "sm-sport", name: "SM Sport", city: "Québec", province: "QC", website: "smsport.ca", sourceUrl: "https://smsport.ca", status: "active", logo: "/dealers/sm-sport.png" },
  { slug: "motos-illimitees", name: "Motos Illimitées", city: "Terrebonne", province: "QC", website: "motosillimitees.com", sourceUrl: "https://www.motosillimitees.com", status: "active", logo: "/dealers/motos-illimitees.webp" },
  { slug: "mathias-sports", name: "Mathias Sports", city: "Saint-Mathias-sur-Richelieu", province: "QC", website: "mathiassports.com", sourceUrl: "https://mathiassports.com", status: "active", logo: "/dealers/mathias-sports.png" },
  { slug: "motoplex-mirabel", name: "Motoplex Mirabel", city: "Mirabel", province: "QC", website: "motoplexmirabel.ca", sourceUrl: "https://dealer.cfmoto.ca/concessionnaire-cfmoto-motoplex-mirabel", status: "active", logo: "/motoplex.jpg" },
  { slug: "db-moto", name: "DB Moto", city: "Sainte-Julienne", province: "QC", website: "dbmoto.ca", sourceUrl: "https://dealer.cfmoto.ca/page/db-moto-sainte-julienne", status: "active", logo: "/dealers/db-moto.png" },
  { slug: "mvm-motosport", name: "MVM Motorsport / Équipements les Chutes", city: "Shawinigan", province: "QC", website: "mvmmotosport.com", sourceUrl: "https://dealer.cfmoto.ca/page/mvm-motorsport-equipements-les-chutes", status: "active", logo: "/logo_mvm.png" },
  { slug: "sports-plus-st-casimir", name: "Sports Plus St-Casimir", city: "Saint-Casimir", province: "QC", website: "sportsplusst-casimir.com", sourceUrl: "https://www.sportsplusst-casimir.com", status: "coming", logo: "/dealers/sports-plus-st-casimir.png" },
  { slug: "ts-performance", name: "TS Performance", city: "Rimouski", province: "QC", website: "tsperformance.ca", sourceUrl: "https://tsperformance.ca", status: "coming", logo: "/dealers/ts-performance.png" },
  { slug: "univers-traction-sports", name: "Univers Traction Sports", city: "Château-Richer", province: "QC", website: "universtractionsports.com", sourceUrl: "https://universtractionsports.com", status: "coming", logo: "/dealers/univers-traction-sports.png" },
  { slug: "barbin-sport", name: "Barbin Sport", city: "Val-d'Or", province: "QC", website: "barbinsport.com", sourceUrl: "https://barbinsport.com", status: "coming", logo: null },
  { slug: "hors-bord-lafontaine", name: "Hors-Bord Lafontaine", city: "Gracefield", province: "QC", website: "hors-bordlafontaine.com", sourceUrl: "https://hors-bordlafontaine.com", status: "coming", logo: "/dealers/hors-bord-lafontaine.png" },
  { slug: "maniac-moto", name: "Maniac Moto", city: "Montmagny", province: "QC", website: "maniacmoto.ca", sourceUrl: "https://maniacmoto.ca", status: "coming", logo: "/dealers/maniac-moto.webp" },
  { slug: "electro-dan", name: "Electro-Dan", city: "Baie-Saint-Paul", province: "QC", website: null, sourceUrl: "https://dealer.cfmoto.ca/page/electro-dan", status: "coming", logo: "/dealers/electro-dan.png" },
  { slug: "saguenay-marine", name: "Saguenay Marine", city: "Jonquière", province: "QC", website: null, sourceUrl: "https://dealer.cfmoto.ca/concessionnaire-cfmoto-saguenay-marine-jonquiere", status: "coming", logo: "/dealers/saguenay-marine.png" },
  { slug: "moto-performance-2000", name: "Moto Performance 2000", city: "Plessisville", province: "QC", website: null, sourceUrl: "https://dealer.cfmoto.ca/page/moto-performance-2000", status: "coming", logo: "/dealers/moto-performance-2000.png" },
  { slug: "hors-route-104", name: "Hors-Route 104", city: "Saint-Jean-sur-Richelieu", province: "QC", website: null, sourceUrl: "https://dealer.cfmoto.ca/page/hors-route-104", status: "coming", logo: "/dealers/hors-route-104.png" },
  { slug: "pulsion-sports-motorises", name: "Pulsion Sports Motorisés", city: "Saint-Germain-de-Grantham", province: "QC", website: null, sourceUrl: "https://dealer.cfmoto.ca/page/pulsion-sports-motorises", status: "coming", logo: null },
  { slug: "vidham", name: "Vidham", city: "Scott", province: "QC", website: null, sourceUrl: "https://dealer.cfmoto.ca/page/vidham", status: "coming", logo: "/dealers/vidham.webp" },
  { slug: "aventures-138", name: "Aventures 138", city: "Sept-Îles", province: "QC", website: null, sourceUrl: "https://dealer.cfmoto.ca/page/aventures-138", status: "coming", logo: "/dealers/aventures-138.png" },
  { slug: "joel-parent-moto", name: "Joël Parent Moto", city: "Lourdes-de-Joliette", province: "QC", website: null, sourceUrl: null, status: "coming", logo: null },
  { slug: "fox-marine-gazbar-caplan", name: "Fox Marine & Sport / Gazbar Caplan", city: "Gaspé · Caplan", province: "QC", website: null, sourceUrl: null, status: "coming", logo: null },
  { slug: "inglis-cycle-center", name: "Inglis Cycle Center", city: "London", province: "ON", website: null, sourceUrl: "https://dealer.cfmoto.ca/page/inglis-cycle-center-ltd", status: "coming", logo: "/dealers/inglis-cycle-center.png" },
  { slug: "maxxim-motorsports", name: "Maxxim Motorsports", city: "Barrie · Oakville", province: "ON", website: "maxximmotorsports.com", sourceUrl: "https://maxximmotorsports.com", status: "coming", logo: "/dealers/maxxim-motorsports.png" },
  { slug: "canrp", name: "Canadian Recreational Powersports", city: "Vaughan", province: "ON", website: "canrp.ca", sourceUrl: "https://www.canrp.ca", status: "coming", logo: null },
  { slug: "dt-powersports", name: "DT Powersports & Marine", city: "Uxbridge", province: "ON", website: "dtpowersports.com", sourceUrl: "https://dtpowersports.com", status: "coming", logo: "/dealers/dt-powersports.png" },
  { slug: "throttle-powersports", name: "Throttle Powersports", city: "Almonte · Kingston", province: "ON", website: "throttlealmonte.com", sourceUrl: "https://www.throttlealmonte.com", status: "coming", logo: null },
  { slug: "clares-cycle", name: "Clare's Cycle & Sports", city: "Fenwick", province: "ON", website: null, sourceUrl: "https://product.cmimotor.com/dealer-cfmoto-clare-cycle-sports", status: "coming", logo: "/dealers/clares-cycle.jpg" },
  { slug: "rr-trail-clarington", name: "R&R Trail Motorsports", city: "Clarington", province: "ON", website: null, sourceUrl: "https://product.cmimotor.com/dealer-cfmoto-rr-trail-motorsports-clarington", status: "coming", logo: "/dealers/rr-trail-clarington.png" },
  { slug: "rr-trail-pickering", name: "R&R Trail Motorsports", city: "Pickering", province: "ON", website: null, sourceUrl: "https://product.cmimotor.com/dealer-cfmoto-r-r-trail-motorsports-pickering", status: "coming", logo: "/dealers/rr-trail-pickering.png" },
  { slug: "davidsons-sport-lawn", name: "Davidson's Sport & Lawn", city: "Norwich", province: "ON", website: null, sourceUrl: "https://dealer.cfmoto.ca/page/davidsons-sport-lawn", status: "coming", logo: "/dealers/davidsons-sport-lawn.png" },
  { slug: "rosseau-road-powersports", name: "Rosseau Road Powersports & Marine", city: "Port Sydney · Parry Sound", province: "ON", website: null, sourceUrl: "https://dealer.cfmoto.ca/page/rosseau-road-powersports-marine-port-sydney", status: "coming", logo: "/dealers/rosseau-road-powersports.png" },
  { slug: "stratford-rv-centre", name: "Stratford RV Centre 2001", city: "Mitchell", province: "ON", website: null, sourceUrl: "https://dealer.cfmoto.ca/page/1484996-ontltdstratford-rv-centre-2001", status: "coming", logo: null },
  { slug: "boyds-farm-supply", name: "Boyd's Farm Supply", city: "Fordwich", province: "ON", website: null, sourceUrl: "https://dealer.cfmoto.ca/page/boyds-farm-supply", status: "coming", logo: "/dealers/boyds-farm-supply.jpg" },
  { slug: "robinsons-marina", name: "Robinson's Marina", city: "Dorset", province: "ON", website: "robinsonsmarina.ca", sourceUrl: "https://robinsonsmarina.ca", status: "coming", logo: null },
  { slug: "robinson-motorsports", name: "Robinson Motorsports", city: "Sault Ste. Marie", province: "ON", website: "robinsonmotorsports.ca", sourceUrl: "https://robinsonmotorsports.ca", status: "coming", logo: "/dealers/robinson-motorsports.png" },
  { slug: "the-shop-industrial", name: "The Shop Industrial", city: "Lively (Sudbury)", province: "ON", website: "theshopindustrial.com", sourceUrl: "https://theshopindustrial.com", status: "coming", logo: "/dealers/the-shop-industrial.webp" },
  { slug: "choppers-custom-works", name: "Choppers Custom Works", city: "Dunnville", province: "ON", website: null, sourceUrl: null, status: "coming", logo: null },
  { slug: "mid-city-motorsports", name: "Mid City Motorsports", city: "Sudbury", province: "ON", website: null, sourceUrl: null, status: "coming", logo: null },
  { slug: "basecamp-motorsports", name: "Basecamp Motorsports", city: "Calgary", province: "AB", website: null, sourceUrl: "https://dealer.cfmoto.ca/page/basecamp-motorsports-inc", status: "coming", logo: "/dealers/basecamp-motorsports.png" },
  { slug: "cycle-works-calgary", name: "Cycle Works", city: "Calgary", province: "AB", website: null, sourceUrl: "https://product.cmimotor.com/dealer-cfmoto-cycle-works-calgary", status: "coming", logo: null },
  { slug: "cycle-works-red-deer", name: "Cycle Works", city: "Red Deer", province: "AB", website: null, sourceUrl: "https://dealer.cfmoto.ca/page/cycle-works-red-deer", status: "coming", logo: "/dealers/cycle-works-red-deer.png" },
  { slug: "windsor-motorsports", name: "Windsor Motorsports", city: "Grande Prairie", province: "AB", website: null, sourceUrl: "https://dealer.cfmoto.ca/page/windsor-motorsports", status: "coming", logo: "/dealers/windsor-motorsports.png" },
  { slug: "free-spirit-sherwood", name: "Free Spirit Marine / Sherwood Powersports", city: "Sherwood Park", province: "AB", website: null, sourceUrl: "https://dealer.cfmoto.ca/page/free-spirit-marine-sherwood-powersports-and-marine", status: "coming", logo: null },
  { slug: "es-conlon-motorsports", name: "E&S / Conlon Motorsports", city: "Fort Saskatchewan", province: "AB", website: null, sourceUrl: "https://dealer.cfmoto.ca/page/es-conlon-motorsports-fort-saskatchewan", status: "coming", logo: null },
  { slug: "conlon-fort-mcmurray", name: "Conlon Motorsports", city: "Fort McMurray", province: "AB", website: null, sourceUrl: "https://dealer.cfmoto.ca/page/fort-mac-motorsports-conlon-motorsports-fort-mcmurray", status: "coming", logo: "/dealers/conlon-fort-mcmurray.png" },
  { slug: "ojs-leisure-products", name: "OJ's Leisure Products", city: "Wainwright", province: "AB", website: null, sourceUrl: "https://dealer.cfmoto.ca/page/ojs-leisure-products-ltd", status: "coming", logo: null },
  { slug: "srt-motorsports", name: "SRT Motorsports", city: "Leduc", province: "AB", website: "srtmotorsports.ca", sourceUrl: "https://srtmotorsports.ca", status: "coming", logo: "/dealers/srt-motorsports.png" },
  { slug: "rcm-auto", name: "RCM Auto", city: "Edmonton", province: "AB", website: null, sourceUrl: null, status: "coming", logo: null },
  { slug: "fraser-valley-powersports", name: "Fraser Valley Powersports", city: "Abbotsford", province: "BC", website: "fraservalleypowersports.com", sourceUrl: "https://fraservalleypowersports.com", status: "coming", logo: null },
  { slug: "s2s-motorsports", name: "S2S Motorsports", city: "Langley", province: "BC", website: null, sourceUrl: "https://dealer.cfmoto.ca/page/s2s-motorsports-sea-to-sky-motorsports-2016-inc", status: "coming", logo: null },
  { slug: "all-seasons-motor-sports", name: "All Seasons Motor Sports", city: "Cranbrook", province: "BC", website: null, sourceUrl: "https://dealer.cfmoto.ca/page/all-seasons-motor-sports-2023-ltd", status: "coming", logo: null },
  { slug: "kickstart-motorsports", name: "Kickstart Motorsports", city: "Terrace", province: "BC", website: null, sourceUrl: "https://dealer.cfmoto.ca/page/kickstart-motorsports", status: "coming", logo: "/dealers/kickstart-motorsports.png" },
  { slug: "cmx-powersports", name: "CMX Powersports", city: "Swift Current", province: "SK", website: null, sourceUrl: "https://dealer.cfmoto.ca/page/cmx-powersports", status: "coming", logo: null },
  { slug: "prairie-recreation", name: "Prairie Recreation", city: "Prince Albert", province: "SK", website: "prairierecreation.com", sourceUrl: "https://prairierecreation.com", status: "coming", logo: null },
  { slug: "cg-open-road-outlet", name: "CG Open Road Outlet", city: "Winnipeg", province: "MB", website: null, sourceUrl: "https://dealer.cfmoto.ca/page/cg-open-road-outlet-winnipeg", status: "coming", logo: null },
  { slug: "faurschou-ag-center", name: "Faurschou Ag Center", city: "Portage la Prairie", province: "MB", website: null, sourceUrl: null, status: "coming", logo: null },
  { slug: "grey-rock-motosports", name: "Grey Rock Motosports", city: "Edmundston", province: "NB", website: null, sourceUrl: "https://product.cmimotor.com/dealer-cfmoto-grey-rock-motosports", status: "coming", logo: null },
  { slug: "g-bourque", name: "G. Bourque", city: "Dieppe", province: "NB", website: "gbourque.com", sourceUrl: "https://www.gbourque.com", status: "coming", logo: "/dealers/g-bourque.png" },
  { slug: "quali-tech", name: "Quali-Tech", city: "Inkerman", province: "NB", website: null, sourceUrl: "https://dealer.cfmoto.ca/page/quali-tech", status: "coming", logo: "/dealers/quali-tech.png" },
  { slug: "corey-car-center", name: "Corey Car Center", city: "Hartford", province: "NB", website: null, sourceUrl: "https://dealer.cfmoto.ca/page/corey-car-center-ltd", status: "coming", logo: null },
  { slug: "lj-patterson-sales", name: "L.J. Patterson Sales", city: "Beresford", province: "NB", website: "ljpattersonsales.com", sourceUrl: "https://ljpattersonsales.com", status: "coming", logo: "/dealers/lj-patterson-sales.jpg" },
  { slug: "premier-trailer-atlantic", name: "Premier Trailer Atlantic", city: "Quispamsis", province: "NB", website: "premiertraileratlantic.ca", sourceUrl: "https://premiertraileratlantic.ca", status: "coming", logo: "/dealers/premier-trailer-atlantic.png" },
  { slug: "raes-trailer-sports", name: "Rae's Trailer & Sports", city: "Miramichi", province: "NB", website: "raestrailerandsports.com", sourceUrl: "https://raestrailerandsports.com", status: "coming", logo: "/dealers/raes-trailer-sports.png" },
  { slug: "ocr-motorsports", name: "OCR Motorsports", city: "Oak Hill", province: "NS", website: "ocronline.ca", sourceUrl: "https://www.ocronline.ca", status: "coming", logo: "/dealers/ocr-motorsports.png" },
  { slug: "canmac-powersports", name: "Canmac Powersports", city: "Elmsdale", province: "NS", website: "canmacwatercraft.ca", sourceUrl: "https://canmacwatercraft.ca", status: "coming", logo: null },
  { slug: "toymaster", name: "Toymaster", city: "Charlottetown", province: "PE", website: null, sourceUrl: "https://product.cmimotor.com/dealer-cfmoto-toymaster", status: "coming", logo: null },
  { slug: "gaudets-engine-repair", name: "Gaudet's Engine Repair", city: "Tignish", province: "PE", website: null, sourceUrl: null, status: "coming", logo: null },
  { slug: "adventure-sales-service", name: "Adventure Sales & Service", city: "Gander", province: "NL", website: null, sourceUrl: "https://dealer.cfmoto.ca/page/adventure-sales-service-central-recreation-gander", status: "coming", logo: "/dealers/adventure-sales-service.png" },
  { slug: "coastal-outdoors", name: "Coastal Outdoors", city: "Carbonear", province: "NL", website: null, sourceUrl: "https://dealer.cfmoto.ca/page/coastal-outdoors-carbonear", status: "coming", logo: "/dealers/coastal-outdoors.png" },
  { slug: "rugged-edge", name: "Rugged Edge", city: "Corner Brook", province: "NL", website: "ruggededge.ca", sourceUrl: "https://ruggededge.ca", status: "coming", logo: "/dealers/rugged-edge.png" },
  { slug: "rugged-terrain", name: "Rugged Terrain", city: "Marystown", province: "NL", website: null, sourceUrl: null, status: "coming", logo: null },
]

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
}

/**
 * Concessionnaires « à venir » correspondant à une recherche (nom, ville ou
 * domaine), pour les afficher avec un badge « À venir » dans la recherche de
 * sources du dashboard. Les concessionnaires `active` passent déjà par
 * `/api/shared-scrapers/search`.
 */
export function searchComingCfmotoDealers(query: string, limit = 5): CfmotoDealer[] {
  const q = normalize(query.trim())
  if (q.length < 2) return []
  return CFMOTO_DEALERS.filter(
    (d) =>
      d.status === "coming" &&
      (normalize(d.name).includes(q) ||
        normalize(d.city).includes(q) ||
        (d.website !== null && normalize(d.website).includes(q))),
  ).slice(0, limit)
}
