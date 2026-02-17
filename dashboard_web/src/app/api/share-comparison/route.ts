/**
 * API Route : Partage du comparatif de prix par courriel via Resend.
 * POST /api/share-comparison
 *
 * Body JSON:
 * {
 *   to: string[],           // Adresses email destinataires
 *   subject?: string,       // Sujet personnalisé (optionnel)
 *   message?: string,       // Message d'accompagnement (optionnel)
 *   rows: ComparisonRow[],  // Données du tableau
 *   competitors: string[]   // Noms des colonnes concurrents
 * }
 */
import { NextResponse } from "next/server"
import { sendEmail } from "@/lib/resend"
import { createClient } from "@/lib/supabase/server"

interface ComparisonRow {
  displayName: string
  modele?: string
  marque?: string
  etat?: string
  sourceCategorie?: string
  reference: number | null
  prices: {
    dealer: string
    price: number | null
    delta: number | null
    etat?: string
  }[]
}

interface SharePayload {
  to: string[]
  subject?: string
  message?: string
  rows: ComparisonRow[]
  competitors: string[]
}

function getEtatLabel(etat: string): string {
  const labels: Record<string, string> = {
    neuf: "Neuf",
    occasion: "Usagé",
    demonstrateur: "Démo",
    inventaire: "Inventaire",
    catalogue: "Catalogue",
    vehicules_occasion: "Usagé",
  }
  return labels[etat] || etat || ""
}

function buildEmailHtml(rows: ComparisonRow[], competitors: string[], customMessage?: string, senderName?: string): string {
  const dateStr = new Date().toLocaleDateString("fr-CA", {
    day: "numeric",
    month: "long",
    year: "numeric",
  })

  const headerCells = competitors
    .map(
      c =>
        `<th style="padding:8px 10px;text-align:right;font-size:11px;color:#6b7280;border-bottom:2px solid #e5e7eb;white-space:nowrap;">${c}</th>`
    )
    .join("")

  const bodyRows = rows
    .map(row => {
      const etatLabel = getEtatLabel(row.etat || row.sourceCategorie || "")
      const etatBadge = etatLabel
        ? ` <span style="display:inline-block;font-size:10px;font-weight:600;padding:2px 6px;border-radius:4px;background:#d1fae5;color:#065f46;margin-left:4px;">${etatLabel}</span>`
        : ""

      const priceCells = competitors
        .map(c => {
          const entry = row.prices.find(p => p.dealer === c)
          if (!entry || entry.price === null) {
            return `<td style="padding:8px 10px;text-align:right;border-bottom:1px solid #f3f4f6;color:#9ca3af;">—</td>`
          }
          const deltaColor =
            entry.delta === null
              ? "#6b7280"
              : entry.delta > 0
                ? "#059669"
                : entry.delta < 0
                  ? "#dc2626"
                  : "#6b7280"
          const deltaStr =
            entry.delta === null
              ? "—"
              : `${entry.delta > 0 ? "+" : ""}${entry.delta.toFixed(0)} $`
          return `<td style="padding:8px 10px;text-align:right;border-bottom:1px solid #f3f4f6;">
            <div style="font-size:13px;">${entry.price.toFixed(0)} $</div>
            <div style="font-size:11px;font-weight:600;color:${deltaColor};">${deltaStr}</div>
          </td>`
        })
        .join("")

      return `<tr>
        <td style="padding:8px 10px;border-bottom:1px solid #f3f4f6;">
          <strong style="font-size:13px;">${row.displayName}</strong>${etatBadge}
          ${row.modele ? `<br/><span style="font-size:11px;color:#6b7280;">Modèle: ${row.modele}</span>` : ""}
        </td>
        <td style="padding:8px 10px;text-align:right;border-bottom:1px solid #f3f4f6;font-weight:600;font-size:13px;">
          ${row.reference !== null ? `${row.reference.toFixed(0)} $` : "—"}
        </td>
        ${priceCells}
      </tr>`
    })
    .join("")

  const senderInfo = senderName ? ` par ${senderName}` : ""

  return `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#111;padding:0;margin:0;background:#f3f4f6;">
  <div style="max-width:960px;margin:0 auto;padding:32px 24px;">
    <div style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
      <!-- Header -->
      <div style="background:linear-gradient(135deg,#7c3aed 0%,#6366f1 100%);padding:24px 28px;">
        <h1 style="font-size:22px;font-weight:700;color:#ffffff;margin:0 0 4px 0;">Comparatif des prix</h1>
        <p style="font-size:13px;color:rgba(255,255,255,0.8);margin:0;">Partagé${senderInfo} via Go-Data &middot; ${dateStr}</p>
      </div>

      <div style="padding:24px 28px;">
        ${customMessage ? `<div style="font-size:14px;color:#374151;margin-bottom:20px;padding:14px 18px;background:#f9fafb;border-radius:8px;border-left:3px solid #8b5cf6;">${customMessage}</div>` : ""}

        <!-- Résumé -->
        <div style="display:flex;gap:16px;margin-bottom:20px;">
          <div style="flex:1;background:#f9fafb;border-radius:8px;padding:12px 16px;text-align:center;">
            <div style="font-size:24px;font-weight:700;color:#111;">${rows.length}</div>
            <div style="font-size:12px;color:#6b7280;">Produits</div>
          </div>
          <div style="flex:1;background:#f9fafb;border-radius:8px;padding:12px 16px;text-align:center;">
            <div style="font-size:24px;font-weight:700;color:#111;">${competitors.length}</div>
            <div style="font-size:12px;color:#6b7280;">Concurrents</div>
          </div>
        </div>

        <!-- Tableau -->
        <div style="overflow-x:auto;">
          <table style="width:100%;border-collapse:collapse;font-size:13px;">
            <thead>
              <tr style="background:#f9fafb;">
                <th style="padding:8px 10px;text-align:left;font-size:11px;color:#6b7280;border-bottom:2px solid #e5e7eb;min-width:200px;">Produit</th>
                <th style="padding:8px 10px;text-align:right;font-size:11px;color:#6b7280;border-bottom:2px solid #e5e7eb;white-space:nowrap;">Prix réf</th>
                ${headerCells}
              </tr>
            </thead>
            <tbody>
              ${bodyRows || `<tr><td colspan="${2 + competitors.length}" style="text-align:center;padding:20px;color:#9ca3af;">Aucun produit à afficher.</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>

      <!-- Footer -->
      <div style="padding:16px 28px;background:#f9fafb;border-top:1px solid #e5e7eb;text-align:center;">
        <p style="font-size:11px;color:#9ca3af;margin:0;">Généré par Go-Data &middot; ${dateStr}</p>
      </div>
    </div>
  </div>
</body>
</html>`
}

export async function POST(request: Request) {
  try {
    // Vérifier l'authentification
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Non authentifié" }, { status: 401 })
    }

    const body: SharePayload = await request.json()

    // Validation
    if (!body.to || !Array.isArray(body.to) || body.to.length === 0) {
      return NextResponse.json(
        { error: "Au moins une adresse courriel est requise" },
        { status: 400 }
      )
    }

    // Valider les emails
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    const invalidEmails = body.to.filter(e => !emailRegex.test(e))
    if (invalidEmails.length > 0) {
      return NextResponse.json(
        { error: `Adresse(s) invalide(s): ${invalidEmails.join(", ")}` },
        { status: 400 }
      )
    }

    // Limiter le nombre de destinataires
    if (body.to.length > 10) {
      return NextResponse.json(
        { error: "Maximum 10 destinataires par envoi" },
        { status: 400 }
      )
    }

    if (!body.rows || !Array.isArray(body.rows)) {
      return NextResponse.json(
        { error: "Les données du comparatif sont requises" },
        { status: 400 }
      )
    }

    // Récupérer le nom de l'expéditeur
    const { data: profile } = await supabase
      .from("users")
      .select("name")
      .eq("id", user.id)
      .single()

    const senderName = profile?.name || user.email || "Un utilisateur"

    // Générer le HTML de l'email
    const html = buildEmailHtml(
      body.rows,
      body.competitors || [],
      body.message,
      senderName
    )

    const subject =
      body.subject || `Comparatif des prix – Go-Data (${new Date().toLocaleDateString("fr-CA")})`

    // Envoyer via Resend
    await sendEmail({
      to: body.to,
      subject,
      html,
      replyTo: user.email || undefined,
    })

    return NextResponse.json({
      success: true,
      message: `Courriel envoyé à ${body.to.length} destinataire${body.to.length > 1 ? "s" : ""}`,
    })
  } catch (error: unknown) {
    console.error("[share-comparison] Error:", error)
    const message = error instanceof Error ? error.message : "Erreur serveur"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
