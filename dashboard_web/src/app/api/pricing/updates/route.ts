import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getCurrentUser } from "@/lib/supabase/helpers"

type SupabaseLikeError = {
  code?: string
  message?: string
}

const PRICING_MIGRATION_REQUIRED_MESSAGE =
  "La migration Supabase pricing n'a pas encore été appliquée. Exécutez dashboard_web/supabase/migration_pricing_strategy.sql dans Supabase, puis rechargez le schéma."

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Internal server error"
}

function isMissingPricingTable(error: SupabaseLikeError | null) {
  if (!error) return false
  const message = error.message || ""
  return error.code === "42P01" || error.code === "PGRST205" || message.includes("schema cache") || message.includes("pricing_price_updates")
}

export async function GET(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const url = new URL(request.url)
    const scrapingId = url.searchParams.get("scrapingId")
    const supabase = await createClient()

    let query = supabase
      .from("pricing_price_updates")
      .select("*")
      .eq("user_id", user.id)
      .order("applied_at", { ascending: false })
      .limit(500)

    if (scrapingId) {
      query = query.eq("scraping_id", scrapingId)
    }

    const { data, error } = await query
    if (isMissingPricingTable(error)) {
      return NextResponse.json({
        updates: [],
        setupRequired: true,
        message: PRICING_MIGRATION_REQUIRED_MESSAGE,
      })
    }

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ updates: data || [] })
  } catch (error: unknown) {
    return NextResponse.json(
      { error: getErrorMessage(error) },
      { status: 500 }
    )
  }
}
