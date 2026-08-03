import type { MetadataRoute } from "next"

export default function robots(): MetadataRoute.Robots {
  const siteUrl = process.env.NEXT_PUBLIC_APP_URL || "https://go-data.co"

  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // Sans slash final : "/dashboard/" ne bloque pas /dashboard lui-même
        // (préfixe robots). Ne jamais utiliser "/c" sans slash (bloquerait
        // /contact, /careers, /compare…) ; /c/ reste crawlable exprès pour
        // que Google voie un éventuel noindex.
        disallow: ["/dashboard", "/admin", "/api/", "/auth/"],
      },
    ],
    sitemap: `${siteUrl}/sitemap.xml`,
  }
}
