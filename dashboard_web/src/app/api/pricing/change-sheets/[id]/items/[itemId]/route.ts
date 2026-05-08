import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getCurrentUser } from "@/lib/supabase/helpers"

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Internal server error"
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string; itemId: string }> }
) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { id, itemId } = await context.params
    const body = await request.json().catch(() => ({}))

    const updates: Record<string, unknown> = {}
    if (typeof body?.applied === "boolean") {
      updates.applied = body.applied
      updates.applied_at = body.applied ? new Date().toISOString() : null
    }
    if (typeof body?.new_price === "number" && Number.isFinite(body.new_price) && body.new_price >= 0) {
      updates.new_price = body.new_price
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "Aucune mise à jour fournie." }, { status: 400 })
    }

    const supabase = await createClient()
    const { data, error } = await supabase
      .from("pricing_change_sheet_items")
      .update(updates)
      .eq("id", itemId)
      .eq("sheet_id", id)
      .eq("user_id", user.id)
      .select("*")
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ item: data })
  } catch (error: unknown) {
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 })
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string; itemId: string }> }
) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { id, itemId } = await context.params
    const supabase = await createClient()

    const { error } = await supabase
      .from("pricing_change_sheet_items")
      .delete()
      .eq("id", itemId)
      .eq("sheet_id", id)
      .eq("user_id", user.id)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error: unknown) {
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 })
  }
}
