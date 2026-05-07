export type Customer = {
  name: string
  industry: string
  country: string
  logo?: string
}

export type Testimonial = {
  quote: string
  author: string
  role: string
  company: string
  avatar?: string
  metric?: string
}

export type CaseStudy = {
  slug: string
  title: string
  customer: string
  industry: string
  vertical: "dealers" | "ecommerce" | "agencies" | "developers"
  excerpt: string
  metrics: { label: string; value: string }[]
  body?: string
  logo?: string
  publishedAt?: string
}

export const CUSTOMERS: Customer[] = [
  { name: "MVM Motosport", industry: "Concessionnaire moto / sports motorisés", country: "Canada", logo: "/logo_mvm.png" },
  { name: "DB Moto", industry: "Données moto", country: "Canada", logo: "/logo_moto_db.png" },
]

export const METRICS = [
  { value: "2", label: "clients réels" },
  { value: "FR", label: "langue prioritaire" },
  { value: "B2B", label: "focus actuel" },
  { value: "UI", label: "fonctionnalités en préparation" },
]

export const TESTIMONIALS: Testimonial[] = []

export const CASE_STUDIES: CaseStudy[] = [
  {
    slug: "mvm-motosport",
    title: "MVM Motosport",
    customer: "MVM Motosport",
    industry: "Concessionnaire moto / sports motorisés",
    vertical: "dealers",
    excerpt:
      "Client réel de Go-Data. La fiche détaillée, les chiffres et le témoignage seront ajoutés seulement après validation client.",
    metrics: [],
  },
  {
    slug: "moto-db",
    title: "DB Moto",
    customer: "DB Moto",
    industry: "Données moto",
    vertical: "dealers",
    excerpt:
      "Client réel de Go-Data. Les preuves publiques seront complétées lorsque les informations publiables seront confirmées.",
    metrics: [],
  },
]

export const COMPARE_TABLE = [
  { feature: "Dashboard de comparaison de prix", goData: true, apify: false, brightData: false, octoparse: true, scraperApi: false },
  { feature: "Orientation no-code", goData: true, apify: false, brightData: false, octoparse: true, scraperApi: false },
  { feature: "API publique", goData: "prévu", apify: true, brightData: true, octoparse: false, scraperApi: true },
  { feature: "Webhooks", goData: "prévu", apify: true, brightData: true, octoparse: false, scraperApi: false },
  { feature: "Intégrations e-commerce", goData: "prévu", apify: false, brightData: false, octoparse: false, scraperApi: false },
  { feature: "Gestion équipe / rôles", goData: "prévu", apify: true, brightData: true, octoparse: false, scraperApi: false },
  { feature: "Trust center public", goData: "à préparer", apify: true, brightData: true, octoparse: false, scraperApi: false },
]

export const FAQ_MAIN = [
  {
    q: "À qui s'adresse Go-Data aujourd'hui ?",
    a: "La priorité actuelle est le marché des concessionnaires moto / sports motorisés et les cas d'usage de comparaison de prix. Les autres verticales sont présentées comme des pistes de croissance, pas comme des preuves déjà acquises.",
  },
  {
    q: "Est-ce que Go-Data a déjà une API publique ?",
    a: "Pas comme promesse publique finalisée dans cette UI. L'écran API et la documentation peuvent être préparés, mais ils doivent rester marqués comme « à venir » tant que le backend et les limites commerciales ne sont pas prêts.",
  },
  {
    q: "Pourquoi retirer les témoignages et statistiques ?",
    a: "Parce qu'une marque B2B solide se construit sur des preuves vérifiables. Les chiffres, logos et citations seront ajoutés uniquement lorsqu'ils seront validés avec les clients concernés.",
  },
  {
    q: "Le site doit-il rester en français ?",
    a: "Oui. Le français reste prioritaire. L'anglais et les autres langues peuvent exister comme préparation, mais l'expérience principale doit rester claire pour le marché francophone actuel.",
  },
]

export const PROGRAMMATIC_SITES = [
  { slug: "moto", name: "Sites de concessionnaires moto", category: "Concessionnaires" },
  { slug: "pieces-moto", name: "Sites de pièces moto", category: "Pièces et accessoires" },
  { slug: "vehicules-recreatifs", name: "Sites de véhicules récréatifs", category: "Sports motorisés" },
]

export const COMPETITORS_FOR_COMPARE = [
  {
    slug: "apify",
    name: "Apify",
    positioning: "Plateforme de scraping orientée développeurs",
    oneLiner:
      "Apify est puissant pour des équipes techniques. Go-Data doit se différencier par une expérience métier plus simple pour les opérateurs.",
  },
  {
    slug: "bright-data",
    name: "Bright Data",
    positioning: "Infrastructure proxy et data enterprise",
    oneLiner:
      "Bright Data est très mature côté infrastructure. Go-Data doit éviter de prétendre être équivalent tant que les couches enterprise ne sont pas en place.",
  },
  {
    slug: "octoparse",
    name: "Octoparse",
    positioning: "Scraper visuel no-code",
    oneLiner:
      "Octoparse couvre le no-code généraliste. Go-Data peut être plus verticalisé sur la comparaison de prix et les marchés ciblés.",
  },
  {
    slug: "scraperapi",
    name: "ScraperAPI",
    positioning: "API proxy / scraping",
    oneLiner:
      "ScraperAPI répond surtout aux développeurs. Go-Data peut préparer une API, mais le dashboard métier reste la priorité.",
  },
]
