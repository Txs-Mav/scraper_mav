"use client"

import { Suspense } from "react"
import Layout from "@/components/kokonutui/layout"
import ProductSearch from "@/components/product-search/product-search"
import { DashboardSkeleton } from "@/components/skeleton-loader"
import SurveillanceBackground from "@/components/kokonutui/surveillance-background"

export default function DashboardRecherchePage() {
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
        <ProductSearch />
      </Layout>
    </Suspense>
  )
}
