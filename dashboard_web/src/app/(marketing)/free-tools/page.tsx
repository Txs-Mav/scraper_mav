"use client"

import { useMemo, useState } from "react"
import { useLanguage } from "@/contexts/language-context"

export default function FreeToolsPage() {
  const { t } = useLanguage()
  const [input, setInput] = useState("")
  const urls = useMemo(() => {
    return Array.from(input.matchAll(/https?:\/\/[^\s"')]+/g)).map((m) => m[0])
  }, [input])

  return (
    <>
      <section className="max-w-4xl mx-auto px-4 sm:px-6 pt-20 pb-10 text-center">
        <h1 className="text-5xl md:text-6xl font-black tracking-tight">{t("freetools.title")}</h1>
        <p className="mt-4 text-lg text-gray-600 dark:text-gray-300">{t("freetools.subtitle")}</p>
      </section>
      <section className="max-w-3xl mx-auto px-4 sm:px-6 py-12">
        <div className="rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#1a1c1e] p-6">
          <h2 className="text-2xl font-bold">Extracteur d'URLs</h2>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
            Collez du texte, l'outil extrait les URLs côté navigateur. Aucune donnée n'est envoyée.
          </p>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            rows={8}
            className="mt-5 w-full rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-white/[0.04] p-3 text-sm"
            placeholder="Collez votre texte ici..."
          />
          <div className="mt-5 rounded-xl bg-gray-50 dark:bg-white/[0.04] p-4">
            <div className="text-sm font-semibold">{urls.length} URL(s) trouvée(s)</div>
            <ul className="mt-2 space-y-1 text-xs text-gray-600 dark:text-gray-300 break-all">
              {urls.map((url) => (
                <li key={url}>{url}</li>
              ))}
            </ul>
          </div>
        </div>
      </section>
    </>
  )
}
