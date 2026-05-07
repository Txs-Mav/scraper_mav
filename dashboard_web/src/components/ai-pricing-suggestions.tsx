"use client"

export default function AiPricingSuggestions() {
  return (
    <div className="rounded-2xl border border-dashed border-emerald-300 dark:border-emerald-800 bg-emerald-50/40 dark:bg-emerald-950/20 p-5">
      <h2 className="font-semibold text-emerald-900 dark:text-emerald-100">Suggestions IA (à valider)</h2>
      <p className="mt-2 text-sm text-emerald-800/80 dark:text-emerald-200/80">
        Cette zone pourra aider à interpréter les écarts de prix, mais ne doit pas promettre de gains ou d'actions automatiques sans validation humaine.
      </p>
    </div>
  )
}
