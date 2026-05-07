import { NextResponse } from "next/server"
import { isDevAdminUser } from "@/lib/auth/admin"
import { createServiceClient } from "@/lib/supabase/service"
import { getCurrentUser } from "@/lib/supabase/helpers"

export async function GET(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Non authentifié" }, { status: 401 })
    }
    if (!isDevAdminUser(user)) {
      return NextResponse.json({ error: "Accès réservé au compte dev" }, { status: 403 })
    }

    const url = new URL(request.url)
    const status = url.searchParams.get("status")
    const supabase = createServiceClient()

    let query = supabase
      .from("support_messages")
      .select(`
        id,
        user_id,
        type,
        subject,
        message,
        status,
        admin_reply,
        admin_replied_at,
        created_at,
        updated_at,
        users:user_id (
          id,
          name,
          email,
          subscription_plan,
          business_type
        )
      `)
      .order("created_at", { ascending: false })
      .limit(200)

    if (status && ["open", "answered", "closed"].includes(status)) {
      query = query.eq("status", status)
    }

    const { data, error } = await query

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ messages: data || [] })
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Erreur serveur" }, { status: 500 })
  }
}
