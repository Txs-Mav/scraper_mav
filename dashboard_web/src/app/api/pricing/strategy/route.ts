import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getCurrentUser } from "@/lib/supabase/helpers"
import { DEFAULT_PRICING_SETTINGS, normalizePricingSettings } from "@/lib/pricing-strategy"

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
  return error.code === "42P01" || error.code === "PGRST205" || message.includes("schema cache") || message.includes("pricing_strategy_settings")
}

export async function GET() {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const supabase = await createClient()
    const { data, error } = await supabase
      .from("pricing_strategy_settings")
      .select("apply_enabled, default_strategy, vehicle_type_strategies")
      .eq("user_id", user.id)
      .maybeSingle()

    if (isMissingPricingTable(error)) {
      return NextResponse.json({
        settings: normalizePricingSettings(DEFAULT_PRICING_SETTINGS),
        setupRequired: true,
        message: PRICING_MIGRATION_REQUIRED_MESSAGE,
      })
    }

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ settings: normalizePricingSettings(data || DEFAULT_PRICING_SETTINGS) })
  } catch (error: unknown) {
    return NextResponse.json(
      { error: getErrorMessage(error) },
      { status: 500 }
    )
  }
}

export async function PUT(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json()
    const settings = normalizePricingSettings(body?.settings || body)
    const supabase = await createClient()

    const { data, error } = await supabase
      .from("pricing_strategy_settings")
      .upsert(
        {
          user_id: user.id,
          apply_enabled: settings.apply_enabled,
          default_strategy: settings.default_strategy,
          vehicle_type_strategies: settings.vehicle_type_strategies,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" }
      )
      .select("apply_enabled, default_strategy, vehicle_type_strategies")
      .single()

    if (isMissingPricingTable(error)) {
      return NextResponse.json(
        {
          error: PRICING_MIGRATION_REQUIRED_MESSAGE,
          setupRequired: true,
        },
        { status: 424 }
      )
    }

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, settings: normalizePricingSettings(data) })
  } catch (error: unknown) {
    return NextResponse.json(
      { error: getErrorMessage(error) },
      { status: 500 }
    )
  }
}
