"use client"

export default function DatasetsPage() {
  return (
    <>
      <section className="max-w-4xl mx-auto px-4 sm:px-6 pt-20 pb-10 text-center">
        <h1 className="text-5xl md:text-6xl font-black tracking-tight">Datasets</h1>
        <p className="mt-4 text-lg text-gray-600 dark:text-gray-300">
          Datasets publics à publier uniquement lorsqu'ils seront anonymisés, validés et légalement partageables.
        </p>
      </section>
      <section className="max-w-3xl mx-auto px-4 sm:px-6 py-12">
        <div className="rounded-2xl border border-dashed border-gray-300 dark:border-white/15 bg-white dark:bg-[#1a1c1e] p-8 text-center">
          <h2 className="text-2xl font-bold">Aucun dataset public pour l'instant</h2>
          <p className="mt-3 text-sm text-gray-600 dark:text-gray-300">
            Cette page reste prête pour plus tard, sans inventer de fichiers ou volumes.
          </p>
        </div>
      </section>
    </>
  )
}
