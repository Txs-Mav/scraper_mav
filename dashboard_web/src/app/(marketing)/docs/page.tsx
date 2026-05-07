"use client"

export default function DocsPage() {
  return (
    <article className="max-w-4xl mx-auto px-4 sm:px-6 pt-20 pb-24">
      <h1 className="text-5xl md:text-6xl font-black tracking-tight">Documentation</h1>
      <p className="mt-4 text-lg text-gray-600 dark:text-gray-300">
        Documentation publique à construire en français. L'API publique reste à venir tant qu'elle n'est pas stabilisée.
      </p>
      <div className="mt-10 grid sm:grid-cols-2 gap-4">
        {["Démarrage", "Configuration des scrapers", "Exports", "API publique (à venir)", "Webhooks (à venir)", "Sécurité"].map((item) => (
          <div key={item} className="rounded-2xl border border-dashed border-gray-300 dark:border-white/15 bg-white dark:bg-[#1a1c1e] p-6">
            <h2 className="text-lg font-bold">{item}</h2>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">Section à documenter avec comportement réel.</p>
          </div>
        ))}
      </div>
    </article>
  )
}
