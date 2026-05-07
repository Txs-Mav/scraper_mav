"use client"

import { use } from "react"
import Link from "next/link"
import { PROGRAMMATIC_SITES } from "@/lib/marketing-data"

export default function ScrapeSitePage({ params }: { params: Promise<{ site: string }> }) {
  const { site } = use(params)
  const item = PROGRAMMATIC_SITES.find((s) => s.slug === site)
  const name = item?.name ?? site

  return (
    <article className="max-w-3xl mx-auto px-4 sm:px-6 pt-20 pb-24">
      <Link href="/blog" className="text-sm text-emerald-600 dark:text-emerald-400 hover:underline">Retour au blog</Link>
      <h1 className="mt-4 text-4xl md:text-5xl font-black tracking-tight">Scraper {name}</h1>
      <p className="mt-5 text-lg text-gray-600 dark:text-gray-300">
        Page SEO préparatoire. Le contenu détaillé doit être rédigé avec des exemples réels, une analyse juridique et des limites claires avant publication.
      </p>
      <div className="mt-10 rounded-2xl border border-dashed border-gray-300 dark:border-white/15 bg-white dark:bg-[#1a1c1e] p-6">
        <h2 className="text-2xl font-bold">À rédiger</h2>
        <ul className="mt-4 space-y-2 text-sm text-gray-600 dark:text-gray-300 list-disc pl-5">
          <li>Ce qui est public et collectable.</li>
          <li>Limites légales et techniques.</li>
          <li>Exemple de structure de données.</li>
          <li>Cas d'usage relié au marché moto / sports motorisés quand pertinent.</li>
        </ul>
      </div>
    </article>
  )
}
