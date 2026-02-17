/**
 * Utilitaires d'export : impression, Excel et partage par courriel
 * pour le comparatif de prix et la page analyse.
 */
import * as XLSX from "xlsx"

// ── Types ──

export interface ComparisonRow {
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

// ── Impression ──

/**
 * Imprime une section spécifique de la page en isolant son contenu.
 * @param elementId   ID de l'élément HTML à imprimer
 * @param title       Titre affiché en haut de la page imprimée
 */
export function printSection(elementId: string, title: string) {
  const element = document.getElementById(elementId)
  if (!element) {
    console.warn(`[print] Élément #${elementId} introuvable.`)
    return
  }

  const printWindow = window.open("", "_blank")
  if (!printWindow) {
    alert("Veuillez autoriser les popups pour imprimer.")
    return
  }

  const now = new Date()
  const dateStr = now.toLocaleDateString("fr-CA", {
    day: "numeric",
    month: "long",
    year: "numeric",
  })
  const timeStr = now.toLocaleTimeString("fr-CA", {
    hour: "2-digit",
    minute: "2-digit",
  })

  printWindow.document.write(`<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8"/>
  <title>${title} – Go-Data</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      color: #111;
      padding: 24px 32px;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .print-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 2px solid #e5e7eb;
      padding-bottom: 12px;
      margin-bottom: 20px;
    }
    .print-header h1 {
      font-size: 22px;
      font-weight: 700;
    }
    .print-header .meta {
      font-size: 12px;
      color: #6b7280;
      text-align: right;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
    }
    th {
      background: #f9fafb;
      text-align: left;
      padding: 8px 10px;
      font-weight: 600;
      font-size: 11px;
      color: #6b7280;
      border-bottom: 2px solid #e5e7eb;
      white-space: nowrap;
    }
    th.text-right, td.text-right { text-align: right; }
    td {
      padding: 8px 10px;
      border-bottom: 1px solid #f3f4f6;
      vertical-align: middle;
    }
    tr:hover { background: #fafafa; }
    .badge {
      display: inline-block;
      font-size: 10px;
      font-weight: 600;
      padding: 2px 6px;
      border-radius: 4px;
    }
    .badge-neuf { background: #d1fae5; color: #065f46; }
    .badge-occasion { background: #fef3c7; color: #92400e; }
    .badge-demo { background: #dbeafe; color: #1e40af; }
    .delta-positive { color: #059669; font-weight: 600; }
    .delta-negative { color: #dc2626; font-weight: 600; }
    .delta-neutral { color: #6b7280; }
    .print-footer {
      margin-top: 20px;
      padding-top: 12px;
      border-top: 1px solid #e5e7eb;
      font-size: 11px;
      color: #9ca3af;
      text-align: center;
    }
    img { max-width: 40px; max-height: 40px; border-radius: 6px; }
    @media print {
      body { padding: 12px 16px; }
      .print-header h1 { font-size: 18px; }
    }
  </style>
</head>
<body>
  <div class="print-header">
    <h1>${title}</h1>
    <div class="meta">
      <div>Go-Data</div>
      <div>${dateStr} à ${timeStr}</div>
    </div>
  </div>
  ${element.innerHTML}
  <div class="print-footer">
    Généré par Go-Data &middot; ${dateStr}
  </div>
  <script>
    window.onload = function() {
      setTimeout(function() { window.print(); window.close(); }, 400);
    };
  </script>
</body>
</html>`)
  printWindow.document.close()
}

/**
 * Imprime la page entière (analytics).
 * Ajoute une classe temporaire au body qui masque la sidebar, header, etc.
 */
export function printCurrentPage(title: string) {
  // Injecter un style print temporaire
  const styleId = "__go_data_print_style"
  let style = document.getElementById(styleId) as HTMLStyleElement | null
  if (!style) {
    style = document.createElement("style")
    style.id = styleId
    document.head.appendChild(style)
  }
  style.textContent = `
    @media print {
      body * { visibility: hidden; }
      #analytics-print-area, #analytics-print-area * { visibility: visible; }
      #analytics-print-area {
        position: absolute;
        left: 0;
        top: 0;
        width: 100%;
      }
      /* Cacher sidebar & nav */
      nav, aside, [data-sidebar], header { display: none !important; }
    }
  `
  window.print()
  // Retirer le style après impression
  setTimeout(() => style?.remove(), 1000)
}

// ── Export Excel ──

/**
 * Exporte les données du comparatif de prix dans un fichier Excel (.xlsx).
 * @param rows         Données tabulaires du comparatif
 * @param competitors  Liste des noms de concurrents (colonnes)
 * @param filename     Nom du fichier (sans extension)
 */
export function exportComparisonToExcel(
  rows: ComparisonRow[],
  competitors: string[],
  filename = "comparatif_prix"
) {
  // Construire les en-têtes
  const headers = ["Produit", "Modèle", "Marque", "État", "Prix référence ($)"]
  competitors.forEach(c => {
    headers.push(`${c} – Prix ($)`)
    headers.push(`${c} – Écart ($)`)
  })

  // Construire les lignes
  const data = rows.map(row => {
    const etatLabel = getEtatLabel(row.etat || row.sourceCategorie || "")
    const line: (string | number | null)[] = [
      row.displayName,
      row.modele || "",
      row.marque || "",
      etatLabel,
      row.reference,
    ]
    competitors.forEach(c => {
      const entry = row.prices.find(p => p.dealer === c)
      line.push(entry?.price ?? null)
      line.push(entry?.delta ?? null)
    })
    return line
  })

  // Créer le workbook
  const ws = XLSX.utils.aoa_to_sheet([headers, ...data])

  // Largeurs de colonnes auto
  ws["!cols"] = headers.map((h, i) => ({
    wch: Math.max(h.length, i < 4 ? 20 : 14),
  }))

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, "Comparatif des prix")

  // Ajouter une feuille de métadonnées
  const metaWs = XLSX.utils.aoa_to_sheet([
    ["Rapport généré par", "Go-Data"],
    ["Date", new Date().toLocaleDateString("fr-CA")],
    ["Nombre de produits", rows.length],
    ["Nombre de concurrents", competitors.length],
  ])
  metaWs["!cols"] = [{ wch: 24 }, { wch: 30 }]
  XLSX.utils.book_append_sheet(wb, metaWs, "Info")

  // Téléchargement
  const dateStr = new Date().toISOString().split("T")[0]
  XLSX.writeFile(wb, `${filename}_${dateStr}.xlsx`)
}

// ── Partage par courriel (côté client) ──

export interface ShareEmailPayload {
  to: string[]
  subject?: string
  message?: string
  rows: ComparisonRow[]
  competitors: string[]
}

/**
 * Envoie les données du comparatif par courriel via l'API.
 */
export async function shareComparisonByEmail(payload: ShareEmailPayload): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await fetch("/api/share-comparison", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
    const data = await response.json()
    if (!response.ok) {
      return { success: false, error: data.error || "Erreur lors de l'envoi" }
    }
    return { success: true }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Erreur réseau"
    return { success: false, error: message }
  }
}

// ── Helpers ──

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

/**
 * Génère le HTML du tableau comparatif pour l'email.
 */
export function generateComparisonHtml(
  rows: ComparisonRow[],
  competitors: string[],
  customMessage?: string
): string {
  const dateStr = new Date().toLocaleDateString("fr-CA", {
    day: "numeric",
    month: "long",
    year: "numeric",
  })

  const headerCells = competitors
    .map(c => `<th style="padding:8px 10px;text-align:right;font-size:11px;color:#6b7280;border-bottom:2px solid #e5e7eb;white-space:nowrap;">${c}</th>`)
    .join("")

  const bodyRows = rows
    .map(row => {
      const etatLabel = getEtatLabel(row.etat || row.sourceCategorie || "")
      const etatBadge = etatLabel
        ? `<span style="display:inline-block;font-size:10px;font-weight:600;padding:2px 6px;border-radius:4px;background:#d1fae5;color:#065f46;">${etatLabel}</span>`
        : ""

      const priceCells = competitors
        .map(c => {
          const entry = row.prices.find(p => p.dealer === c)
          if (!entry || entry.price === null) {
            return `<td style="padding:8px 10px;text-align:right;border-bottom:1px solid #f3f4f6;color:#9ca3af;">—</td>`
          }
          const deltaColor =
            entry.delta === null ? "#6b7280" : entry.delta > 0 ? "#059669" : entry.delta < 0 ? "#dc2626" : "#6b7280"
          const deltaStr =
            entry.delta === null ? "—" : `${entry.delta > 0 ? "+" : ""}${entry.delta.toFixed(0)} $`
          return `<td style="padding:8px 10px;text-align:right;border-bottom:1px solid #f3f4f6;">
            <div>${entry.price.toFixed(0)} $</div>
            <div style="font-size:11px;font-weight:600;color:${deltaColor};">${deltaStr}</div>
          </td>`
        })
        .join("")

      return `<tr>
        <td style="padding:8px 10px;border-bottom:1px solid #f3f4f6;">
          <strong>${row.displayName}</strong> ${etatBadge}
          ${row.modele ? `<br/><span style="font-size:11px;color:#6b7280;">Modèle: ${row.modele}</span>` : ""}
        </td>
        <td style="padding:8px 10px;text-align:right;border-bottom:1px solid #f3f4f6;font-weight:600;">
          ${row.reference !== null ? `${row.reference.toFixed(0)} $` : "—"}
        </td>
        ${priceCells}
      </tr>`
    })
    .join("")

  return `
<!DOCTYPE html>
<html lang="fr">
<head><meta charset="utf-8"/></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#111;padding:24px;background:#ffffff;">
  <div style="max-width:900px;margin:0 auto;">
    <div style="border-bottom:2px solid #e5e7eb;padding-bottom:16px;margin-bottom:20px;">
      <h1 style="font-size:22px;font-weight:700;margin:0 0 4px 0;">Comparatif des prix</h1>
      <p style="font-size:13px;color:#6b7280;margin:0;">Go-Data &middot; ${dateStr}</p>
    </div>
    ${customMessage ? `<p style="font-size:14px;color:#374151;margin-bottom:20px;padding:12px 16px;background:#f9fafb;border-radius:8px;border-left:3px solid #8b5cf6;">${customMessage}</p>` : ""}
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
    <div style="margin-top:24px;padding-top:12px;border-top:1px solid #e5e7eb;font-size:11px;color:#9ca3af;text-align:center;">
      Généré par Go-Data &middot; ${dateStr}
    </div>
  </div>
</body>
</html>`
}
