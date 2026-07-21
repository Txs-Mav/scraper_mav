import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getCurrentUser } from "@/lib/supabase/helpers"
import { sendEmail } from "@/lib/resend"

const VALID_TYPES = new Set(["question", "suggestion", "bug", "other"])

/** Boîte qui reçoit une copie de chaque message du centre d'aide. */
const SUPPORT_NOTIFY_EMAIL = "mavmenard@gmail.com"

const TYPE_LABELS: Record<string, string> = {
  question: "Question",
  suggestion: "Suggestion",
  bug: "Problème",
  other: "Autre",
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
}

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

    // Notification courriel au fondateur — best-effort : un échec d'envoi
    // ne doit jamais faire échouer la création du message.
    try {
      const typeLabel = TYPE_LABELS[type] ?? type
      const senderEmail = user.email || "utilisateur inconnu"
      const senderName = (user as { name?: string }).name || senderEmail
      await sendEmail({
        to: SUPPORT_NOTIFY_EMAIL,
        subject: `[Centre d'aide] ${typeLabel} — ${subject}`,
        replyTo: user.email || undefined,
        text: `${typeLabel} de ${senderName} (${senderEmail})\n\nSujet : ${subject}\n\n${message}\n\nRépondre dans /admin/support`,
        html: `
          <div style="font-family:sans-serif;max-width:600px">
            <p style="color:#EA580C;font-weight:bold;margin:0 0 4px">Centre d'aide Go-Data</p>
            <h2 style="margin:0 0 12px">${escapeHtml(typeLabel)} — ${escapeHtml(subject)}</h2>
            <p style="color:#555;margin:0 0 16px">
              De : <strong>${escapeHtml(senderName)}</strong> (${escapeHtml(senderEmail)})
            </p>
            <div style="border-left:3px solid #EA580C;padding:8px 12px;background:#fafafa;white-space:pre-wrap">${escapeHtml(message)}</div>
            <p style="color:#999;font-size:12px;margin-top:16px">Répondre depuis le panneau admin support.</p>
          </div>`,
      })
    } catch (notifyError) {
      console.error("[support] Échec de la notification courriel:", notifyError)
    }

    return NextResponse.json({ message: data }, { status: 201 })
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Erreur serveur" }, { status: 500 })
  }
}
