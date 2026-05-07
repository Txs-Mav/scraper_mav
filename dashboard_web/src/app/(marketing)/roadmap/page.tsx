"use client"

import RoadmapBoard from "@/components/roadmap-board"
import { useLanguage } from "@/contexts/language-context"

export default function RoadmapPage() {
  const { t } = useLanguage()
  return (
    <>
      <section className="max-w-4xl mx-auto px-4 sm:px-6 pt-20 pb-10 text-center">
        <h1 className="text-5xl md:text-6xl font-black tracking-tight">{t("roadmap.title")}</h1>
        <p className="mt-4 text-lg text-gray-600 dark:text-gray-300">{t("roadmap.subtitle")}</p>
      </section>
      <RoadmapBoard />
    </>
  )
}
