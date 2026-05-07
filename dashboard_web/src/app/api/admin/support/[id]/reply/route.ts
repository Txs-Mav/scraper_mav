import { NextResponse } from "next/server"
import { isDevAdminUser } from "@/lib/auth/admin"
import { createServiceClient } from "@/lib/supabase/service"
import { getCurrentUser } from "@/lib/supabase/helpers"

type RouteContext = {
  params: Promise<{ id: string }>
}

function cleanText(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : ""
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Non authentifié" }, { status: 401 })
    }
    if (!isDevAdminUser(user)) {
      return NextResponse.json({ error: "Accès réservé au compte dev" }, { status: 403 })
    }

    const { id } = await context.params
    const body = await request.json().catch(() => ({}))
    const reply = cleanText(body.reply, 5000)
    const shouldClose = body.status === "closed"

    if (!reply) {
      return NextResponse.json({ error: "Réponse requise" }, { status: 400 })
    }

    const supabase = createServiceClient()
    const { data, error } = await supabase
      .from("support_messages")
      .update({
        admin_reply: reply,
        admin_replied_by: user.id,
        admin_replied_at: new Date().toISOString(),
        status: shouldClose ? "closed" : "answered",
      })
      .eq("id", id)
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
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ message: data })
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Erreur serveur" }, { status: 500 })
  }
}
