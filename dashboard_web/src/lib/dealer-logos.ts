/**
 * Logos locaux des concessionnaires (public/dealers/ et racine public/),
 * indexés par domaine. Sert de complément quand `shared_scrapers.logo_url`
 * est vide en base — le logo en base a toujours priorité.
 */
export const DEALER_LOGOS: Record<string, string> = {
  "dbmoto.ca": "/dealers/db-moto.png",
  "evasion-sport.com": "/dealers/evasion-sport.jpg",
  "evolutionxjonquiere.ca": "/dealers/evolution-x-jonquiere.png",
  "excelmoto.com": "/dealers/excelmoto.png",
  "gobeilequipement.ca": "/dealers/gobeil-equipement.png",
  "jeandumasmaximumsport.ca": "/dealers/jean-dumas-maximum-sport.png",
  "mathiassports.com": "/dealers/mathias-sports.png",
  "morinsports.com": "/dealers/morin-sports.png",
  "motofalardeau.com": "/dealers/moto-falardeau.png",
  "motoplex.ca": "/motoplex.jpg",
  "motoplexmirabel.ca": "/motoplex.jpg",
  "motosillimitees.com": "/dealers/motos-illimitees.webp",
  "mvmmotosport.com": "/logo_mvm.png",
  "saguenaymarine.com": "/dealers/saguenay-marine.webp",
  "smsport.ca": "/dealers/sm-sport.png",
  "sportcgr.com": "/dealers/sport-cgr.png",
  "sportsdrc.com": "/dealers/sports-drc.png",
}

/** Logo d'un concessionnaire : priorité au logo en base, sinon logo local. */
export function getDealerLogo(domain: string, dbLogo?: string | null): string | null {
  return dbLogo || DEALER_LOGOS[domain.replace(/^www\./, "")] || null
}
