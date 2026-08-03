import type { MetadataRoute } from "next"

// Date de dernière modification réelle du contenu — à bumper manuellement.
// Un lastModified recalculé à chaque requête apprend à Google à ignorer
// le champ sur tout le site.
const LAST_MODIFIED = new Date("2026-08-02")

export default function sitemap(): MetadataRoute.Sitemap {
  const siteUrl = process.env.NEXT_PUBLIC_APP_URL || "https://go-data.co"

  // Retirés volontairement (autoplan SEO 2026-08) : /compare/* et /scrape/*
  // (contenu préparatoire / notes internes), pages placeholder (/careers,
  // /press, /academy, /datasets, /customers) et pages d'auth (/login,
  // /create-account). Les réintégrer quand leur contenu réel sera publié.
  const staticRoutes = [
    "",
    "/pricing",
    "/demo",
    "/concessionnaires",
    "/solutions/dealers",
    "/solutions/ecommerce",
    "/solutions/agencies",
    "/solutions/developers",
    "/trust",
    "/security",
    "/status",
    "/about",
    "/contact",
    "/partners",
    "/affiliate",
    "/blog",
    "/resources",
    "/glossary",
    "/free-tools",
    "/help",
    "/changelog",
    "/roadmap",
    "/docs",
    "/legal/privacy",
    "/legal/terms",
    "/legal/dpa",
    "/legal/sla",
    "/legal/cookies",
  ]

  return staticRoutes.map((route) => ({
    url: `${siteUrl}${route}`,
    lastModified: LAST_MODIFIED,
    changeFrequency: "weekly" as const,
    priority: route === "" ? 1 : route.startsWith("/legal") ? 0.3 : 0.7,
  }))
}
