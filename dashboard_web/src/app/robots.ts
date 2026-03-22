import type { MetadataRoute } from "next"

export default function robots(): MetadataRoute.Robots {
  const siteUrl = process.env.NEXT_PUBLIC_APP_URL || "https://www.go-data.co"

  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/dashboard/", "/api/", "/auth/"],
      },
    ],
    sitemap: `${siteUrl}/sitemap.xml`,
  }
}
