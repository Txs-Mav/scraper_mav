"use client"

import { Suspense } from "react"
import Layout from "@/components/kokonutui/layout"
import ScraperDashboard from "@/components/scraper-dashboard"
import { DashboardSkeleton } from "@/components/skeleton-loader"
import SurveillanceBackground from "@/components/kokonutui/surveillance-background"

export default function DashboardSurveillancePage() {
  return (
    <Suspense
      fallback={
        <Layout>
          <DashboardSkeleton />
        </Layout>
      }
    >
      <Layout>
        <SurveillanceBackground />
        <ScraperDashboard view="surveillance" />
      </Layout>
    </Suspense>
  )
}
