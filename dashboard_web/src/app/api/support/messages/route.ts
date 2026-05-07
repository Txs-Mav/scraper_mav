import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getCurrentUser } from "@/lib/supabase/helpers"

const VALID_TYPES = new Set(["question", "suggestion", "bug", "other"])

function cleanText(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : ""
}

export async function GET() {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Non authentifié" }, { status: 401 })
    }

    const supabase = await createClient()
    const { data, error } = await supabase
      .from("support_messages")
      .select("id, type, subject, message, status, admin_reply, admin_replied_at, created_at, updated_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ messages: data || [] })
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Erreur serveur" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Non authentifié" }, { status: 401 })
    }

    const body = await request.json().catch(() => ({}))
    const type = VALID_TYPES.has(body.type) ? body.type : "question"
    const subject = cleanText(body.subject, 140)
    const message = cleanText(body.message, 5000)

    if (!subject) {
      return NextResponse.json({ error: "Sujet requis" }, { status: 400 })
    }
    if (!message || message.length < 10) {
      return NextResponse.json({ error: "Message requis (minimum 10 caractères)" }, { status: 400 })
    }

    const supabase = await createClient()
    const { data, error } = await supabase
      .from("support_messages")
      .insert({
        user_id: user.id,
        type,
        subject,
        message,
      })
      .select("id, type, subject, message, status, admin_reply, admin_replied_at, created_at, updated_at")
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ message: data }, { status: 201 })
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Erreur serveur" }, { status: 500 })
  }
}
