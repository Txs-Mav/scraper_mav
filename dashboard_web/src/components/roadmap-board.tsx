"use client"

const COLUMNS = [
  {
    title: "Maintenant",
    items: ["Clarifier le positionnement moto / sports motorisés", "Nettoyer les preuves clients", "Renforcer le dashboard existant"],
  },
  {
    title: "Ensuite",
    items: ["API publique à cadrer", "Webhooks", "Gestion équipe et rôles", "Trust center juridiquement validé"],
  },
  {
    title: "Plus tard",
    items: ["Intégrations e-commerce", "Marketplace de scrapers", "Programme partenaires", "Internationalisation avancée"],
  },
]

export default function RoadmapBoard() {
  return (
    <section className="max-w-6xl mx-auto px-4 sm:px-6 py-12">
      <div className="grid md:grid-cols-3 gap-4">
        {COLUMNS.map((column) => (
          <div key={column.title} className="rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#1a1c1e] p-5">
            <h2 className="text-lg font-bold">{column.title}</h2>
            <div className="mt-4 space-y-3">
              {column.items.map((item) => (
                <div key={item} className="rounded-xl bg-gray-50 dark:bg-white/[0.04] p-3 text-sm text-gray-700 dark:text-gray-200">
                  {item}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
