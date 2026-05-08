import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getCurrentUser } from "@/lib/supabase/helpers"
import {
  DEFAULT_PRICING_SETTINGS,
  buildPricingRowsFromProducts,
  calculatePricingRecommendation,
  getStrategyLabel,
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
  "La migration Supabase pricing n'a pas encore été appliquée. Exécutez dashboard_web/supabase/migration_pricing_strategy.sql et migration_pricing_change_sheets.sql dans Supabase, puis rechargez le schéma."

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Internal server error"
}

function isMissingPricingTable(error: SupabaseLikeError | null) {
  if (!error) return false
  const message = error.message || ""
  return (
    error.code === "42P01" ||
    error.code === "PGRST205" ||
    message.includes("schema cache") ||
    message.includes("pricing_")
  )
}

function normalizeRefUrl(url: string) {
  try {
    const parsed = new URL(url)
    return `${parsed.protocol}//${parsed.hostname.replace(/^www\./, "").toLowerCase()}${parsed.pathname.replace(/\/+$/, "")}`
  } catch {
    return url.toLowerCase().replace(/\/+$/, "").replace(/^https?:\/\/www\./, "https://")
  }
}

function defaultSheetName(now: Date) {
  const formatter = new Intl.DateTimeFormat("fr-CA", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  })
  return `Fiche du ${formatter.format(now)}`
}

export async function GET(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const url = new URL(request.url)
    const statusFilter = url.searchParams.get("status")

    const supabase = await createClient()
    let query = supabase
      .from("pricing_change_sheets")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(200)

    if (statusFilter && ["pending", "completed", "archived"].includes(statusFilter)) {
      query = query.eq("status", statusFilter)
    }

    const { data, error } = await query

    if (isMissingPricingTable(error)) {
      return NextResponse.json({
        sheets: [],
        pendingCount: 0,
        setupRequired: true,
        message: PRICING_MIGRATION_REQUIRED_MESSAGE,
      })
    }

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const sheets = data || []
    const pendingSheets = sheets.filter(sheet => sheet.status === "pending")
    const pendingCount = pendingSheets.reduce(
      (sum, sheet) => sum + Math.max(0, (sheet.items_count || 0) - (sheet.applied_count || 0)),
      0
    )

    return NextResponse.json({
      sheets,
      pendingCount,
    })
  } catch (error: unknown) {
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json().catch(() => ({}))
    const productKeys = Array.isArray(body?.productKeys)
      ? body.productKeys.filter((key: unknown): key is string => typeof key === "string")
      : []
    const matchMode: MatchMode = body?.matchMode || "exact"
    const sheetName = typeof body?.name === "string" && body.name.trim() ? body.name.trim() : null

    if (productKeys.length === 0) {
      return NextResponse.json(
        { error: "Sélectionnez au moins un véhicule à inclure dans la fiche." },
        { status: 400 }
      )
    }

    const supabase = await createClient()

    const { data: strategyRow, error: strategyError } = await supabase
      .from("pricing_strategy_settings")
      .select("apply_enabled, default_strategy, vehicle_type_strategies")
      .eq("user_id", user.id)
      .maybeSingle()

    if (isMissingPricingTable(strategyError)) {
      return NextResponse.json(
        { error: PRICING_MIGRATION_REQUIRED_MESSAGE, setupRequired: true },
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
      const matched = (recentScrapings as ScrapingRow[] | null)?.find(
        scraping => normalizeRefUrl(scraping.reference_url) === normalizedConfigUrl
      )
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

    const requestedKeys = new Set(productKeys)
    const rows = buildPricingRowsFromProducts(
      latestScraping.products || [],
      latestScraping.competitor_urls || [],
      matchMode
    )
    const recommendations = rows
      .map(row => calculatePricingRecommendation(row, settings))
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
      .filter(item => requestedKeys.has(item.productKey))

    if (recommendations.length === 0) {
      return NextResponse.json(
        { error: "Aucune recommandation de prix calculable pour les véhicules sélectionnés." },
        { status: 400 }
      )
    }

    const now = new Date()

    const { data: createdSheet, error: createError } = await supabase
      .from("pricing_change_sheets")
      .insert({
        user_id: user.id,
        scraping_id: latestScraping.id,
        name: sheetName || defaultSheetName(now),
        status: "pending",
      })
      .select("*")
      .single()

    if (isMissingPricingTable(createError)) {
      return NextResponse.json(
        { error: PRICING_MIGRATION_REQUIRED_MESSAGE, setupRequired: true },
        { status: 424 }
      )
    }
    if (createError || !createdSheet) {
      return NextResponse.json(
        { error: createError?.message || "Création de la fiche impossible." },
        { status: 500 }
      )
    }

    const itemRows = recommendations.map(item => ({
      sheet_id: createdSheet.id,
      user_id: user.id,
      product_key: item.productKey,
      product_name: item.productName,
      reference_url: item.referenceUrl,
      vehicle_type: item.vehicleType,
      old_price: item.oldPrice,
      new_price: item.recommendedPrice,
      strategy_key: item.strategy.key,
      strategy_label: getStrategyLabel(item.strategy),
      basis: {
        ...item.basis,
        strategy: item.strategy,
        difference: item.difference,
        recommendedPrice: item.recommendedPrice,
      },
      applied: false,
    }))

    const { data: insertedItems, error: itemsError } = await supabase
      .from("pricing_change_sheet_items")
      .insert(itemRows)
      .select("*")

    if (itemsError) {
      await supabase.from("pricing_change_sheets").delete().eq("id", createdSheet.id)
      return NextResponse.json({ error: itemsError.message }, { status: 500 })
    }

    const { data: refreshedSheet } = await supabase
      .from("pricing_change_sheets")
      .select("*")
      .eq("id", createdSheet.id)
      .single()

    return NextResponse.json({
      success: true,
      sheet: refreshedSheet || createdSheet,
      items: insertedItems || [],
    })
  } catch (error: unknown) {
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 })
  }
}
