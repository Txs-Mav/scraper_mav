"use client"

import { Suspense } from "react"
import Layout from "@/components/kokonutui/layout"
import ScraperDashboard from "@/components/scraper-dashboard"
import { DashboardSkeleton } from "@/components/skeleton-loader"

export default function DashboardComparaisonsPage() {
  return (
    <Suspense
      fallback={
        <Layout>
          <DashboardSkeleton />
        </Layout>
      }
    >
      <Layout>
        <ScraperDashboard view="comparaisons" />
      </Layout>
    </Suspense>
  )
}
