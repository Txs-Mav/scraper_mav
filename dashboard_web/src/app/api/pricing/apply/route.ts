import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getCurrentUser } from "@/lib/supabase/helpers"
import {
  DEFAULT_PRICING_SETTINGS,
  buildPricingRowsFromProducts,
  calculatePricingRecommendation,
  normalizePricingSettings,
  type PricingProduct,
} from "@/lib/pricing-strategy"
import type { MatchMode } from "@/lib/analytics-calculations"

type ScrapingRow = {
  id: string
  reference_url: string
  competitor_urls?: string[]
  products?: PricingProduct[]
}

type SupabaseLikeError = {
  code?: string
  message?: string
}

const PRICING_MIGRATION_REQUIRED_MESSAGE =
  "La migration Supabase pricing n'a pas encore été appliquée. Exécutez dashboard_web/supabase/migration_pricing_strategy.sql dans Supabase, puis rechargez le schéma."

function normalizeRefUrl(url: string) {
  try {
    const parsed = new URL(url)
    return `${parsed.protocol}//${parsed.hostname.replace(/^www\./, "").toLowerCase()}${parsed.pathname.replace(/\/+$/, "")}`
  } catch {
    return url.toLowerCase().replace(/\/+$/, "").replace(/^https?:\/\/www\./, "https://")
  }
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Internal server error"
}

function isMissingPricingTable(error: SupabaseLikeError | null) {
  if (!error) return false
  const message = error.message || ""
  return error.code === "42P01" || error.code === "PGRST205" || message.includes("schema cache") || message.includes("pricing_")
}

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json().catch(() => ({}))
    const requestedProductKeys = Array.isArray(body?.productKeys)
      ? new Set(body.productKeys.filter((key: unknown): key is string => typeof key === "string"))
      : null
    const matchMode: MatchMode = body?.matchMode || "exact"

    const supabase = await createClient()
    const { data: strategyRow, error: strategyError } = await supabase
      .from("pricing_strategy_settings")
      .select("apply_enabled, default_strategy, vehicle_type_strategies")
      .eq("user_id", user.id)
      .maybeSingle()

    if (isMissingPricingTable(strategyError)) {
      return NextResponse.json(
        {
          error: PRICING_MIGRATION_REQUIRED_MESSAGE,
          setupRequired: true,
        },
        { status: 424 }
      )
    }

    if (strategyError) {
      return NextResponse.json({ error: strategyError.message }, { status: 500 })
    }

    const settings = normalizePricingSettings(strategyRow || DEFAULT_PRICING_SETTINGS)

    const { data: config } = await supabase
      .from("scraper_config")
      .select("reference_url")
      .eq("user_id", user.id)
      .maybeSingle()

    let scrapingsQuery = supabase
      .from("scrapings")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1)

    if (config?.reference_url) {
      scrapingsQuery = scrapingsQuery.eq("reference_url", config.reference_url)
    }

    let { data: scrapings, error: scrapingsError } = await scrapingsQuery

    if ((!scrapings || scrapings.length === 0) && config?.reference_url) {
      const { data: recentScrapings, error: recentError } = await supabase
        .from("scrapings")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(5)

      const normalizedConfigUrl = normalizeRefUrl(config.reference_url)
      const matched = (recentScrapings as ScrapingRow[] | null)?.find(scraping => normalizeRefUrl(scraping.reference_url) === normalizedConfigUrl)
      scrapings = matched ? [matched] : recentScrapings
      scrapingsError = recentError
    }

    if (scrapingsError) {
      return NextResponse.json({ error: scrapingsError.message }, { status: 500 })
    }

    const latestScraping = scrapings?.[0]
    if (!latestScraping) {
      return NextResponse.json({ error: "Aucun scraping disponible." }, { status: 404 })
    }

    const rows = buildPricingRowsFromProducts(
      latestScraping.products || [],
      latestScraping.competitor_urls || [],
      matchMode
    )
    const recommendations = rows
      .map(row => calculatePricingRecommendation(row, settings))
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
      .filter(item => !requestedProductKeys || requestedProductKeys.has(item.productKey))

    if (recommendations.length === 0) {
      return NextResponse.json({ success: true, applied: 0, updates: [] })
    }

    const now = new Date().toISOString()
    const rowsToUpsert = recommendations.map(item => ({
      user_id: user.id,
      scraping_id: latestScraping.id,
      product_key: item.productKey,
      product_name: item.productName,
      reference_url: item.referenceUrl,
      vehicle_type: item.vehicleType,
      old_price: item.oldPrice,
      recommended_price: item.recommendedPrice,
      strategy_key: item.strategy.key,
      basis: {
        ...item.basis,
        strategy: item.strategy,
        difference: item.difference,
      },
      status: "applied",
      applied_at: now,
      updated_at: now,
    }))

    const { data: updates, error: upsertError } = await supabase
      .from("pricing_price_updates")
      .upsert(rowsToUpsert, { onConflict: "user_id,scraping_id,product_key" })
      .select("*")

    if (isMissingPricingTable(upsertError)) {
      return NextResponse.json(
        {
          error: PRICING_MIGRATION_REQUIRED_MESSAGE,
          setupRequired: true,
        },
        { status: 424 }
      )
    }

    if (upsertError) {
      return NextResponse.json({ error: upsertError.message }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      applied: updates?.length || 0,
      updates: updates || [],
    })
  } catch (error: unknown) {
    return NextResponse.json(
      { error: getErrorMessage(error) },
      { status: 500 }
    )
  }
}
