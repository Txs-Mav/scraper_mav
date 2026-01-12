import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getCurrentUser } from "@/lib/supabase/helpers"

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const supabase = await createClient()
    const { id } = await params
    const scrapingId = id

    // Récupérer le scraping ciblé (products + user_id pour contrôle)
    const { data: scraping, error } = await supabase
      .from("scrapings")
      .select("id, user_id, products")
      .eq("id", scrapingId)
      .single()

    if (error || !scraping) {
      return NextResponse.json({ error: "Scraping not found" }, { status: 404 })
    }

    // Vérification d'accès : main account peut voir ses employés
    if (scraping.user_id !== user.id) {
      if (user.role !== "main") {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 })
      }

      const { data: employees } = await supabase
        .from("employees")
        .select("employee_id")
        .eq("main_account_id", user.id)

      const allowedIds = new Set([user.id, ...(employees?.map(e => e.employee_id) || [])])
      if (!allowedIds.has(scraping.user_id)) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 })
      }
    }

    return NextResponse.json({
      products: scraping.products || [],
      count: scraping.products?.length || 0,
    })
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "Internal server error" },
      { status: 500 }
    )
  }
}

