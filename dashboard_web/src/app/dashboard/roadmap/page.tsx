"use client"

import Layout from "@/components/kokonutui/layout"
import RoadmapBoard from "@/components/roadmap-board"

export default function DashboardRoadmapPage() {
  return (
    <Layout>
      <section className="mb-6">
        <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">Roadmap</h1>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
          Roadmap honnête : maintenant, ensuite, plus tard.
        </p>
      </section>
      <RoadmapBoard />
    </Layout>
  )
}
