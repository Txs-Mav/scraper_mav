import type { MetadataRoute } from "next"
import { COMPETITORS_FOR_COMPARE, PROGRAMMATIC_SITES } from "@/lib/marketing-data"

export default function sitemap(): MetadataRoute.Sitemap {
  const siteUrl = process.env.NEXT_PUBLIC_APP_URL || "https://www.go-data.co"
  const now = new Date()

  const staticRoutes = [
    "",
    "/pricing",
    "/solutions/dealers",
    "/solutions/ecommerce",
    "/solutions/agencies",
    "/solutions/developers",
    "/customers",
    "/trust",
    "/security",
    "/status",
    "/about",
    "/careers",
    "/press",
    "/contact",
    "/partners",
    "/affiliate",
    "/blog",
    "/resources",
    "/glossary",
    "/academy",
    "/datasets",
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
    "/login",
    "/create-account",
  ]

  return [
    ...staticRoutes.map((route) => ({
      url: `${siteUrl}${route}`,
      lastModified: now,
      changeFrequency: "weekly" as const,
      priority: route === "" ? 1 : route.startsWith("/legal") ? 0.3 : 0.7,
    })),
    ...COMPETITORS_FOR_COMPARE.map((competitor) => ({
      url: `${siteUrl}/compare/${competitor.slug}`,
      lastModified: now,
      changeFrequency: "monthly" as const,
      priority: 0.5,
    })),
    ...PROGRAMMATIC_SITES.map((site) => ({
      url: `${siteUrl}/scrape/${site.slug}`,
      lastModified: now,
      changeFrequency: "monthly" as const,
      priority: 0.4,
    })),
  ]
}
