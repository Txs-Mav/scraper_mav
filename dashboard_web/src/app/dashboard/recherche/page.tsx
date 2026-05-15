"use client"

import { Suspense } from "react"
import Layout from "@/components/kokonutui/layout"
import ProductSearch from "@/components/product-search/product-search"
import { DashboardSkeleton } from "@/components/skeleton-loader"

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
        <ProductSearch />
      </Layout>
    </Suspense>
  )
}
