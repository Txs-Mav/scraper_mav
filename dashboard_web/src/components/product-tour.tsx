"use client"

import { useState } from "react"

const STEPS = [
  "Créer ou choisir un scraper.",
  "Lancer une collecte sur un cas réel.",
  "Comparer les prix et vérifier les écarts.",
  "Exporter les données ou préparer une alerte.",
]

export default function ProductTour() {
  const [open, setOpen] = useState(() => {
    if (typeof window === "undefined") return false
    const seen = localStorage.getItem("go-data-product-tour-seen")
    return !seen
  })

  function close() {
    localStorage.setItem("go-data-product-tour-seen", "true")
    setOpen(false)
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[80] bg-black/40 flex items-end sm:items-center justify-center p-4">
      <div className="w-full max-w-lg rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#1a1c1e] p-6 shadow-2xl">
        <h2 className="text-xl font-bold text-gray-900 dark:text-white">Bienvenue dans Go-Data</h2>
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
          Tour produit simple, centré sur le cas réel actuel : comparer des données concurrentielles.
        </p>
        <ol className="mt-5 space-y-2">
          {STEPS.map((step, index) => (
            <li key={step} className="flex gap-3 text-sm text-gray-700 dark:text-gray-200">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 text-xs font-bold">
                {index + 1}
              </span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
        <button
          type="button"
          onClick={close}
          className="mt-6 w-full rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-700"
        >
          Compris
        </button>
      </div>
    </div>
  )
}
