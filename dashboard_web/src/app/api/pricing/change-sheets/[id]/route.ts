import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getCurrentUser } from "@/lib/supabase/helpers"

type SupabaseLikeError = {
  code?: string
  message?: string
}

const PRICING_MIGRATION_REQUIRED_MESSAGE =
  "La migration Supabase pricing_change_sheets n'a pas encore été appliquée. Exécutez dashboard_web/supabase/migration_pricing_change_sheets.sql dans Supabase, puis rechargez le schéma."

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

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { id } = await context.params
    const supabase = await createClient()

    const { data: sheet, error: sheetError } = await supabase
      .from("pricing_change_sheets")
      .select("*")
      .eq("id", id)
      .eq("user_id", user.id)
      .maybeSingle()

    if (isMissingPricingTable(sheetError)) {
      return NextResponse.json(
        { error: PRICING_MIGRATION_REQUIRED_MESSAGE, setupRequired: true },
        { status: 424 }
      )
    }
    if (sheetError) {
      return NextResponse.json({ error: sheetError.message }, { status: 500 })
    }
    if (!sheet) {
      return NextResponse.json({ error: "Fiche introuvable." }, { status: 404 })
    }

    const { data: items, error: itemsError } = await supabase
      .from("pricing_change_sheet_items")
      .select("*")
      .eq("sheet_id", id)
      .eq("user_id", user.id)
      .order("created_at", { ascending: true })

    if (itemsError) {
      return NextResponse.json({ error: itemsError.message }, { status: 500 })
    }

    return NextResponse.json({ sheet, items: items || [] })
  } catch (error: unknown) {
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 })
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { id } = await context.params
    const body = await request.json().catch(() => ({}))
    const supabase = await createClient()

    const updates: Record<string, unknown> = {}
    if (typeof body?.name === "string" && body.name.trim()) {
      updates.name = body.name.trim()
    }
    if (typeof body?.notes === "string") {
      updates.notes = body.notes
    }
    if (typeof body?.status === "string" && ["pending", "completed", "archived"].includes(body.status)) {
      updates.status = body.status
      if (body.status === "completed") {
        updates.completed_at = new Date().toISOString()
      } else if (body.status === "pending") {
        updates.completed_at = null
      }
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "Aucune mise à jour fournie." }, { status: 400 })
    }

    const { data, error } = await supabase
      .from("pricing_change_sheets")
      .update(updates)
      .eq("id", id)
      .eq("user_id", user.id)
      .select("*")
      .single()

    if (isMissingPricingTable(error)) {
      return NextResponse.json(
        { error: PRICING_MIGRATION_REQUIRED_MESSAGE, setupRequired: true },
        { status: 424 }
      )
    }
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ sheet: data })
  } catch (error: unknown) {
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 })
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { id } = await context.params
    const supabase = await createClient()

    const { error } = await supabase
      .from("pricing_change_sheets")
      .delete()
      .eq("id", id)
      .eq("user_id", user.id)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error: unknown) {
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 })
  }
}
