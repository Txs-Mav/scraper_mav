"use client"

import React, { useMemo, useState, useEffect, useCallback } from "react"
import { X, Printer, FileSpreadsheet, Mail, Send, Loader2, Check, AlertCircle } from "lucide-react"
import { useLanguage } from "@/contexts/language-context"
import { createPortal } from "react-dom"
import { deepNormalize, normalizeProductGroupKey } from "@/lib/analytics-calculations"
import { printSection, exportComparisonToExcel, shareComparisonByEmail, type ComparisonRow } from "@/lib/export-utils"

type Product = {
  name: string
  modele?: string
  marque?: string
  annee?: number | null
  image?: string
  prix?: number
  prixReference?: number | null
  sourceSite?: string
  sourceUrl?: string
  siteReference?: string
  sourceCategorie?: string
  etat?: string
  competitors?: Record<string, number | null>
  produitReference?: { sourceUrl?: string; name?: string; prix?: number; image?: string; inventaire?: string }
  quantity?: number
  inventaire?: string
  groupedUrls?: string[]
}

type PriceComparisonTableProps = {
  products: Product[]
  competitorsUrls?: string[]
  ignoreColors?: boolean
}

function hostnameFromUrl(url: string) {
  try {
    const h = new URL(url).hostname.replace(/^www\./, "")
    return h || url
  } catch {
    return url
  }
}

// Extraire la marque depuis "Manufacturier :CFMOTO" → "CFMOTO"
function extractMarque(marqueField: string | undefined): string {
  if (!marqueField) return ""
  return marqueField.replace(/^Manufacturier\s*:\s*/i, "").trim()
}

// Extraire le modèle depuis "Modèle :CFORCE 800 TOURING" → "CFORCE 800 TOURING"
function extractModele(modeleField: string | undefined): string {
  if (!modeleField) return ""
  return modeleField.replace(/^Modèle\s*:\s*/i, "").trim()
}

// Liste de couleurs à ignorer (doit correspondre au backend Python)
const COLOR_KEYWORDS_NORMALIZED = new Set([
  'blanc', 'noir', 'rouge', 'bleu', 'vert', 'jaune', 'orange', 'rose', 'violet',
  'gris', 'argent', 'or', 'bronze', 'beige', 'marron', 'brun', 'turquoise',
  'brillant', 'mat', 'metallise', 'metallique',
  'perle', 'nacre', 'satin', 'chrome', 'carbone',
  'fonce', 'clair', 'fluo', 'neon',
  'combat', 'lime', 'sauge', 'cristal', 'obsidian', 'ebony', 'ivory',
  'petard', 'sommet', 'grisatre',
  'white', 'black', 'red', 'blue', 'green', 'yellow', 'pink', 'purple',
  'gray', 'grey', 'silver', 'gold', 'brown',
  'matte', 'glossy', 'metallic', 'pearl', 'carbon',
  'dark', 'light', 'neon', 'bright',
  'etincelle', 'velocite',
])

function removeColors(text: string): string {
  if (!text) return ''
  const normalized = deepNormalize(text)
  return normalized.split(' ')
    .filter(word => !COLOR_KEYWORDS_NORMALIZED.has(word))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function cleanDisplayName(name: string): string {
  if (!name) return name

  const productSuffixes = new Set([
    'edition', 'special', 'limited', 'pro', 'sport', 'touring',
    'adventure', 'rally', 'trail', 'custom', 'classic', 'premium',
    'standard', 'base', 'se', 'le', 'gt', 'abs', 'dct', 'es',
    'bobber', 'scout', 'chief', 'pursuit', 'chieftain', 'roadmaster',
    'challenger', 'springfield', 'vintage',
  ])

  const parts = name.split(' - ')
  if (parts.length >= 2) {
    const afterDash = parts[parts.length - 1].trim()
    const afterWords = new Set(afterDash.toLowerCase().split(/\s+/))
    const isProductSuffix = [...afterWords].some(w => productSuffixes.has(w))
    const hasYear = /\b(19|20)\d{2}\b/.test(afterDash)
    const isShortCode = afterDash.length <= 6 && /^[A-Za-z0-9]+$/.test(afterDash)
    if (!isProductSuffix && !hasYear && !isShortCode && afterDash.length <= 50) {
      name = parts.slice(0, -1).join(' - ').trim()
    }
  }

  name = name.replace(/\s+d['\u2019]?occasion\s+[àa]\s+[\w\s.-]+$/i, '')
  name = name.replace(/\s+[àa]\s+vendre\s+[àa]\s+[\w\s.-]+$/i, '')
  name = name.replace(/\s+(?:neuf|usag[ée]+|usage|occasion)\s+[àa]\s+[\w\s.-]+$/i, '')
  name = name.replace(/\s+(?:en\s+vente|disponible)\s+(?:[àa]|chez)\s+[\w\s.-]+$/i, '')

  return name.trim()
}

function getProductDisplayName(product: Product): string {
  const marque = extractMarque(product.marque)
  const modele = extractModele(product.modele)

  const genericNames = ["aperçu", "spécifications", "promotion", "specifications", "overview"]
  const isGenericName = genericNames.includes((product.name || "").toLowerCase())

  let displayName = ""
  if (!isGenericName && product.name && !product.name.startsWith("Manufacturier")) {
    displayName = cleanDisplayName(product.name)
  } else if (marque && modele) {
    displayName = `${marque} ${modele}`
  } else if (modele) {
    displayName = modele
  } else if (marque) {
    displayName = marque
  } else {
    displayName = cleanDisplayName(product.name || "Produit")
  }

  if (product.annee && !/\b(19|20)\d{2}\b/.test(displayName)) {
    displayName = `${product.annee} ${displayName}`
  }

  return displayName
}

/**
 * Génère une clé de comparaison pour un produit.
 * Exclut : couleur, concessionnaire, localisation, préfixes catégorie (côte à côte, etc.)
 * Aligné avec le backend Python.
 */
function cleanForMatching(text: string): string {
  const dealerPatterns = [
    /\b(?:en\s+vente|disponible|neuf|usage|usag[ée]|occasion)\s+(?:a|à|chez|au)\b.*/i,
    /\bd['\u2019]?occasion\s+(?:a|à|chez|au)\b.*/i,
    /\b(?:a|à)\s+vendre\s+(?:a|à|chez|au)\b.*/i,
    /\b(?:concessionnaire|dealer|showroom|magasin|succursale)\b.*/i,
    /\b\w+\s+(?:motosport|motorsport|powersports?)\s*$/i,
    /\b(?:moto|motos|auto|autos)\s+\w+\s*$/i,
    /\b\w+\s+(?:moto|motos|sport[s]?|auto[s]?|motors?|marine|performance|center|centre)\s*$/i,
  ]
  let cleaned = text
  for (const p of dealerPatterns) cleaned = cleaned.replace(p, '').trim()
  cleaned = cleaned.replace(/^(?:c[oô]te\s+[aà]\s+c[oô]te|cote\s+a\s+cote|side\s*by\s*side|sxs)\s+/i, '').trim()
  cleaned = cleaned.replace(/^(?:vtt|atv|quad|motoneige|snowmobile|moto|scooter)\s+/i, '').trim()
  return removeColors(cleaned)
}

function extractYearFromText(text: string): number {
  if (!text) return 0
  const match = text.match(/\b(19|20)\d{2}\b/)
  if (match) {
    const year = parseInt(match[0], 10)
    if (year >= 1900 && year <= 2100) return year
  }
  return 0
}

function extractYearFromUrl(url: string): number {
  if (!url) return 0
  const match = url.match(/[/-](20[12]\d)(?:[/-]|\.html|$)/)
  if (match) return parseInt(match[1], 10)
  const fallback = url.match(/[/-](19\d{2}|20\d{2})(?:[/-]|\.html|$)/)
  if (fallback) {
    const year = parseInt(fallback[1], 10)
    if (year >= 1990 && year <= 2100) return year
  }
  return 0
}

function resolveProductYear(product: Product): number {
  if (product.annee) return product.annee
  const fromName = extractYearFromText(product.name || '')
  if (fromName) return fromName
  return extractYearFromUrl(product.sourceUrl || '')
}

function getProductComparisonKey(product: Product, _ignoreColors?: boolean): string {
  let marque = deepNormalize(extractMarque(product.marque))
  let modele = deepNormalize(extractModele(product.modele))
  const annee = resolveProductYear(product)

  modele = cleanForMatching(modele)
  marque = removeColors(marque)

  if (marque && modele) return `${marque}|${modele}|${annee || 0}`

  const displayName = getProductDisplayName(product)
  const baseKey = cleanForMatching(deepNormalize(displayName))
  return `${baseKey}|${annee || 0}`
}

const etatConfig: Record<string, { labelKey: string; className: string }> = {
  neuf: { labelKey: "etat.new", className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" },
  occasion: { labelKey: "etat.used", className: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" },
  demonstrateur: { labelKey: "etat.demo", className: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" },
  inventaire: { labelKey: "etat.inventory", className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" },
  catalogue: { labelKey: "etat.catalog", className: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400" },
  vehicules_occasion: { labelKey: "etat.used", className: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" },
}

function EtatBadge({ etat, sourceCategorie }: { etat?: string; sourceCategorie?: string }) {
  const { t } = useLanguage()
  const key = etat || sourceCategorie || ''
  const config = etatConfig[key]
  if (!config) return null
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold leading-none ${config.className}`}>
      {t(config.labelKey as any)}
    </span>
  )
}

function PriceCell({ price, delta }: { price: number | null; delta: number | null }) {
  const deltaTone =
    delta === null
      ? "text-gray-500 dark:text-gray-400"
      : delta > 0
        ? "text-emerald-600 dark:text-emerald-400"
        : delta < 0
          ? "text-red-600 dark:text-red-400"
          : "text-gray-500 dark:text-gray-400"

  return (
    <div className="flex items-center justify-end gap-2">
      <span className="text-sm text-gray-900 dark:text-gray-100">{price !== null ? `${price.toFixed(0)} $` : "—"}</span>
      <span className={`text-xs font-semibold ${deltaTone}`}>
        {delta === null ? "—" : `${delta > 0 ? "+" : ""}${delta.toFixed(0)} $`}
      </span>
    </div>
  )
}

export default function PriceComparisonTable({ products, competitorsUrls = [], ignoreColors = false }: PriceComparisonTableProps) {
  const { t } = useLanguage()
  const [mounted, setMounted] = useState(false)
  const [showShareModal, setShowShareModal] = useState(false)
  const [shareEmails, setShareEmails] = useState("")
  const [shareMessage, setShareMessage] = useState("")
  const [shareSubject, setShareSubject] = useState("")
  const [shareSending, setShareSending] = useState(false)
  const [shareResult, setShareResult] = useState<{ success: boolean; message: string } | null>(null)

  useEffect(() => {
    setMounted(true)
  }, [])

  const competitors = useMemo(() => {
    const uniq = Array.from(new Set(competitorsUrls.filter(Boolean)))
    return uniq.map(url => ({
      id: url,
      label: hostnameFromUrl(url),
    }))
  }, [competitorsUrls])

  const tableData = useMemo(() => {
    // ── Regrouper les produits comparés par clé normalisée ──
    // Aligné avec la page Analyse : mêmes véhicules, mêmes lignes.
    // 1) Produits avec prixReference (concurrents matchés) → groupes par baseKey
    // 2) Produits référence seuls → ajoutés seulement si baseKey pas déjà présent
    const groups = new Map<string, {
      displayName: string
      image?: string
      modele?: string
      marque?: string
      etat?: string
      sourceCategorie?: string
      referenceUrl?: string
      inventaire?: string
      competitorEtats: Record<string, string>
      competitorUrls: Record<string, string>
      reference: number | null
      competitorPrices: Record<string, number>
      quantity: number
      groupedUrls: string[]
    }>()

    const productsWithComparison = products.filter(p => p.prixReference != null && p.prixReference !== undefined)
    const productsRefOnly = products.filter(p => p.prixReference == null || p.prixReference === undefined)

    // Clé alignée avec la page Analyse (normalizeProductGroupKey) pour garantir les mêmes regroupements
    const getKey = (p: Product) => normalizeProductGroupKey(p as any)

    // Index des quantités/URLs du site référent (pour ne pas accumuler les quantités des concurrents)
    const refInfoByKey = new Map<string, { quantity: number; groupedUrls: string[] }>()
    for (const p of productsRefOnly) {
      const key = getKey(p)
      if (!refInfoByKey.has(key)) {
        refInfoByKey.set(key, { quantity: p.quantity || 1, groupedUrls: p.groupedUrls || (p.sourceUrl ? [p.sourceUrl] : []) })
      }
    }

    // 1) Traiter d'abord les produits matchés (concurrents avec prix de référence)
    for (const p of productsWithComparison) {
      const key = getKey(p)
      if (!groups.has(key)) {
        const refName = p.produitReference?.name
        const displayProduct: Product = refName
          ? { ...p, name: refName }
          : p
        const refInfo = refInfoByKey.get(key)
        groups.set(key, {
          displayName: getProductDisplayName(displayProduct),
          image: p.produitReference?.image || p.image,
          modele: p.modele,
          marque: p.marque,
          etat: p.etat,
          sourceCategorie: p.sourceCategorie,
          referenceUrl: p.produitReference?.sourceUrl,
          inventaire: p.produitReference?.inventaire || p.inventaire,
          competitorEtats: {},
          competitorUrls: {},
          reference: p.prixReference ?? null,
          competitorPrices: {},
          quantity: refInfo?.quantity || 1,
          groupedUrls: refInfo?.groupedUrls || [],
        })
      }
      const group = groups.get(key)!
      if (p.produitReference?.image && !group.image) group.image = p.produitReference.image
      const siteLabel = p.sourceSite ? hostnameFromUrl(p.sourceSite) : ''
      if (siteLabel && p.prix != null) {
        if (!group.competitorPrices[siteLabel]) {
          group.competitorPrices[siteLabel] = p.prix
        }
        if (p.sourceUrl && !group.competitorUrls[siteLabel]) {
          group.competitorUrls[siteLabel] = p.sourceUrl
        }
        if (p.etat || p.sourceCategorie) {
          group.competitorEtats[siteLabel] = p.etat || p.sourceCategorie || ''
        }
      }
      if (group.reference === null && p.prixReference != null) {
        group.reference = p.prixReference
      }
      if (!group.referenceUrl && p.produitReference?.sourceUrl) {
        group.referenceUrl = p.produitReference.sourceUrl
      }
    }

    // 2) Produits de référence seuls : ajouter uniquement si pas déjà dans un groupe (évite doublons)
    let refOnlyIndex = 0
    for (const p of productsRefOnly) {
      const refPrice = p.prix != null && p.prix > 0 ? p.prix : null
      if (refPrice === null) continue
      const baseKey = getKey(p)
      if (groups.has(baseKey)) continue
      const key = `${baseKey}__ref_${refOnlyIndex++}`
      groups.set(key, {
        displayName: getProductDisplayName(p),
        image: p.image,
        modele: p.modele,
        marque: p.marque,
        etat: p.etat,
        sourceCategorie: p.sourceCategorie,
        referenceUrl: p.sourceUrl,
        inventaire: p.inventaire,
        competitorEtats: {},
        competitorUrls: {},
        reference: refPrice,
        competitorPrices: {},
        quantity: p.quantity || 1,
        groupedUrls: p.groupedUrls || (p.sourceUrl ? [p.sourceUrl] : []),
      })
    }

    return Array.from(groups.values()).map(g => {
      const prices = competitors.map(c => {
        const price = g.competitorPrices[c.label] ?? null
        const delta = g.reference !== null && price !== null ? price - g.reference : null
        const competitorEtat = g.competitorEtats[c.label] || ''
        const competitorUrl = g.competitorUrls[c.label] || ''
        return { dealer: c.label, price, delta, etat: competitorEtat, url: competitorUrl }
      })

      return {
        name: g.displayName,
        displayName: g.displayName,
        image: g.image,
        modele: g.modele,
        marque: g.marque,
        etat: g.etat,
        sourceCategorie: g.sourceCategorie,
        referenceUrl: g.referenceUrl,
        inventaire: g.inventaire,
        reference: g.reference,
        prices,
        quantity: g.quantity,
        groupedUrls: g.groupedUrls,
      }
    })
  }, [products, competitors])

  // ── Actions d'export ──

  const handlePrint = useCallback(() => {
    printSection("price-comparison-table", t("table.priceComparison"))
  }, [])

  const handleExportExcel = useCallback(() => {
    const competitorLabels = competitors.map(c => c.label)
    exportComparisonToExcel(tableData as ComparisonRow[], competitorLabels)
  }, [tableData, competitors])

  const handleShareEmail = useCallback(async () => {
    const emails = shareEmails
      .split(/[,;\s]+/)
      .map(e => e.trim())
      .filter(Boolean)

    if (emails.length === 0) {
      setShareResult({ success: false, message: t("table.emailRequired") })
      return
    }

    setShareSending(true)
    setShareResult(null)

    const competitorLabels = competitors.map(c => c.label)
    const result = await shareComparisonByEmail({
      to: emails,
      subject: shareSubject || undefined,
      message: shareMessage || undefined,
      rows: tableData as ComparisonRow[],
      competitors: competitorLabels,
    })

    setShareSending(false)
    if (result.success) {
      setShareResult({ success: true, message: t("table.emailSuccess") })
      // Fermer la modale après 2.5s
      setTimeout(() => {
        setShowShareModal(false)
        setShareResult(null)
        setShareEmails("")
        setShareMessage("")
        setShareSubject("")
      }, 2500)
    } else {
      setShareResult({ success: false, message: result.error || t("table.emailError") })
    }
  }, [shareEmails, shareSubject, shareMessage, tableData, competitors])

  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set())
  const toggleRowExpand = (idx: number) => {
    setExpandedRows(prev => {
      const next = new Set(prev)
      if (next.has(idx)) next.delete(idx)
      else next.add(idx)
      return next
    })
  }

  const renderTable = (
    data: Array<{
      name: string
      displayName?: string
      image?: string
      modele?: string
      marque?: string
      etat?: string
      sourceCategorie?: string
      referenceUrl?: string
      inventaire?: string
      reference: number | null
      prices: { dealer: string; price: number | null; delta: number | null; etat?: string; url?: string }[]
      quantity?: number
      groupedUrls?: string[]
    }>,
    emptyMessage?: string,
    overrideCompetitors?: { id: string; label: string }[]
  ) => {
    const cols = overrideCompetitors || competitors
    return (
      <div className="overflow-x-auto">
        <div className="min-w-[900px]">
          <table className="w-full border-collapse">
            <thead>
              <tr className="sticky top-0 bg-white dark:bg-[#0F0F12]">
                <th className="sticky left-0 bg-white dark:bg-[#0F0F12] px-3 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-[#1F1F23]">
                  {t("table.image")}
                </th>
                <th className="sticky left-[80px] bg-white dark:bg-[#0F0F12] px-3 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-[#1F1F23] min-w-[280px]">
                  {t("table.product")}
                </th>
                <th className="sticky left-[260px] bg-white dark:bg-[#0F0F12] px-3 py-2 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-[#1F1F23]">
                  {t("table.refPrice")}
                </th>
                {cols.map(c => (
                  <th key={c.id} className="px-3 py-2 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-[#1F1F23]">
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.length === 0 && (
                <tr>
                  <td colSpan={3 + cols.length} className="px-3 py-4 text-center text-sm text-gray-500 dark:text-gray-400">
                    {emptyMessage || t("table.noProducts")}
                  </td>
                </tr>
              )}
              {data.map((p, idx) => (
                <React.Fragment key={idx}>
                <tr
                  className="border-b border-gray-100 dark:border-[#1F1F23] hover:bg-gray-50 dark:hover:bg-[#111117] transition-colors"
                >
                  <td className="sticky left-0 bg-white dark:bg-[#0F0F12] px-3 py-2 align-middle">
                    <div className="w-12 h-12 rounded-lg overflow-hidden bg-gray-100 dark:bg-[#1F1F23] shadow-[0_8px_20px_-14px_rgba(0,0,0,0.4)]">
                      {p.image ? (
                        <>
                          <img
                            src={p.image}
                            alt={p.name}
                            width={48}
                            height={48}
                            className="object-cover w-full h-full"
                            loading="lazy"
                            referrerPolicy="no-referrer"
                            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; (e.target as HTMLImageElement).nextElementSibling?.classList.remove('hidden') }}
                          />
                          <div className="hidden w-full h-full flex items-center justify-center text-gray-400 text-[10px]">{p.marque?.slice(0, 3) || 'Img'}</div>
                        </>
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-gray-400 text-xs">Img</div>
                      )}
                    </div>
                  </td>
                  <td className="sticky left-[80px] bg-white dark:bg-[#0F0F12] px-3 py-2 min-w-[280px]">
                    <div className="flex flex-col gap-0.5">
                      {p.marque && extractMarque(p.marque) && (
                        <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">{extractMarque(p.marque)}</span>
                      )}
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {p.referenceUrl ? (
                          <a href={p.referenceUrl} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold text-gray-900 dark:text-white whitespace-normal hover:text-blue-600 dark:hover:text-blue-400 hover:underline transition-colors">
                            {p.displayName || p.name}
                          </a>
                        ) : (
                          <span className="text-sm font-semibold text-gray-900 dark:text-white whitespace-normal">
                            {p.displayName || p.name}
                          </span>
                        )}
                        <EtatBadge etat={p.etat} sourceCategorie={p.sourceCategorie} />
                        {p.quantity != null && p.quantity > 1 && (
                          <button
                            onClick={() => toggleRowExpand(idx)}
                            className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-800/50 transition-colors cursor-pointer"
                            title={expandedRows.has(idx) ? "Masquer les URLs" : "Voir les URLs individuelles"}
                          >
                            x{p.quantity} {expandedRows.has(idx) ? '▲' : '▼'}
                          </button>
                        )}
                      </div>
                      {p.inventaire && (
                        <span className="text-[10px] text-gray-400 dark:text-gray-500">#{p.inventaire}</span>
                      )}
                    </div>
                  </td>
                  <td className="sticky left-[260px] bg-white dark:bg-[#0F0F12] px-3 py-2 text-right text-sm font-semibold text-gray-900 dark:text-white">
                    {p.reference !== null ? (
                      p.referenceUrl ? (
                        <a href={p.referenceUrl} target="_blank" rel="noopener noreferrer" className="hover:text-blue-600 dark:hover:text-blue-400 transition-colors">
                          {p.reference.toFixed(0)} $
                        </a>
                      ) : (
                        `${p.reference.toFixed(0)} $`
                      )
                    ) : "—"}
                  </td>
                  {p.prices.map(priceEntry => (
                    <td key={priceEntry.dealer} className="px-3 py-2 text-right text-sm text-gray-900 dark:text-gray-200">
                      <div className="flex flex-col items-end gap-0.5">
                        {priceEntry.url && priceEntry.price !== null ? (
                          <a href={priceEntry.url} target="_blank" rel="noopener noreferrer" className="hover:text-blue-600 dark:hover:text-blue-400 transition-colors">
                            <PriceCell price={priceEntry.price} delta={priceEntry.delta} />
                          </a>
                        ) : (
                          <PriceCell price={priceEntry.price} delta={priceEntry.delta} />
                        )}
                        {priceEntry.etat && priceEntry.price !== null && (
                          <EtatBadge etat={priceEntry.etat} />
                        )}
                      </div>
                    </td>
                  ))}
                </tr>
                {expandedRows.has(idx) && p.groupedUrls && p.groupedUrls.length > 0 && (
                  <tr className="bg-blue-50/50 dark:bg-blue-950/20 border-b border-gray-100 dark:border-[#1F1F23]">
                    <td colSpan={3 + cols.length} className="px-4 py-2">
                      <div className="flex flex-wrap gap-2 items-center">
                        <span className="text-xs font-medium text-gray-500 dark:text-gray-400">URLs regroupées :</span>
                        {p.groupedUrls.map((url: string, urlIdx: number) => (
                          <a
                            key={urlIdx}
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-blue-600 dark:text-blue-400 hover:underline truncate max-w-[300px]"
                            title={url}
                          >
                            {urlIdx + 1}. {url.split('/').filter(Boolean).pop() || url}
                          </a>
                        ))}
                      </div>
                    </td>
                  </tr>
                )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  return (
    <div className="px-6 pb-5">
      <div className="flex items-center gap-1.5 mb-4">
          <div className="flex items-center gap-1 rounded-xl border border-gray-200/70 dark:border-[#1F1F23] bg-gray-50/50 dark:bg-white/[0.02] p-1">
            <button
              type="button"
              onClick={handlePrint}
              disabled={tableData.length === 0}
              className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-gray-500 dark:text-gray-400 hover:bg-white dark:hover:bg-white/[0.06] hover:text-gray-800 dark:hover:text-gray-200 transition disabled:opacity-40 disabled:cursor-not-allowed"
              title={t("table.print")}
            >
              <Printer className="h-3.5 w-3.5" />
              {t("table.print")}
            </button>
            <span className="w-px h-4 bg-gray-200 dark:bg-gray-700" />
            <button
              type="button"
              onClick={handleExportExcel}
              disabled={tableData.length === 0}
              className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-gray-500 dark:text-gray-400 hover:bg-white dark:hover:bg-white/[0.06] hover:text-gray-800 dark:hover:text-gray-200 transition disabled:opacity-40 disabled:cursor-not-allowed"
              title={t("table.excel")}
            >
              <FileSpreadsheet className="h-3.5 w-3.5" />
              Excel
            </button>
          </div>
          <button
            type="button"
            onClick={() => {
              setShareResult(null)
              setShowShareModal(true)
            }}
            disabled={tableData.length === 0}
            className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-violet-500 to-purple-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm shadow-violet-500/15 hover:shadow-md hover:shadow-violet-500/20 hover:-translate-y-0.5 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            title={t("table.shareByEmail")}
          >
            <Mail className="h-3.5 w-3.5" />
            {t("table.share")}
          </button>
          <div className="flex-1" />
      </div>

      <div id="price-comparison-table">
        {renderTable(tableData, t("table.noProductsYet"))}
      </div>

      {/* Modale Partage par courriel */}
      {mounted &&
        showShareModal &&
        createPortal(
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[9999] flex items-center justify-center px-4"
            onClick={(e) => {
              if (e.target === e.currentTarget && !shareSending) {
                setShowShareModal(false)
                setShareResult(null)
              }
            }}
          >
            <div className="bg-white dark:bg-[#0F0F12] rounded-2xl max-w-lg w-full shadow-[0_24px_60px_-32px_rgba(0,0,0,0.55)] border border-gray-100 dark:border-[#1F1F23] overflow-hidden">
              {/* Header modale */}
              <div className="flex items-center justify-between p-5 pb-4 border-b border-gray-100 dark:border-[#1F1F23]">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-xl bg-violet-50 dark:bg-violet-900/20">
                    <Mail className="h-5 w-5 text-violet-600 dark:text-violet-400" />
                  </div>
                  <div>
                    <h4 className="text-lg font-semibold text-gray-900 dark:text-white">{t("table.shareByEmail")}</h4>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {tableData.length} produit{tableData.length > 1 ? "s" : ""} &middot; {competitors.length} concurrent{competitors.length > 1 ? "s" : ""}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    if (!shareSending) {
                      setShowShareModal(false)
                      setShareResult(null)
                    }
                  }}
                  aria-label="Fermer"
                  className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              {/* Contenu modale */}
              <div className="p-5 space-y-4">
                {/* Destinataires */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                    {t("table.recipients")}
                  </label>
                  <input
                    type="text"
                    value={shareEmails}
                    onChange={e => setShareEmails(e.target.value)}
                    placeholder="email@exemple.com, autre@exemple.com"
                    className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-[#1F1F23] bg-white dark:bg-[#0F0F12] text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500"
                    disabled={shareSending}
                  />
                  <p className="text-xs text-gray-400">{t("table.recipientsHint")}</p>
                </div>

                {/* Sujet personnalisé */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                    {t("table.subject")}
                  </label>
                  <input
                    type="text"
                    value={shareSubject}
                    onChange={e => setShareSubject(e.target.value)}
                    placeholder={t("table.subjectDefault")}
                    className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-[#1F1F23] bg-white dark:bg-[#0F0F12] text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500"
                    disabled={shareSending}
                  />
                </div>

                {/* Message d'accompagnement */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                    {t("table.message")}
                  </label>
                  <textarea
                    value={shareMessage}
                    onChange={e => setShareMessage(e.target.value)}
                    placeholder={t("table.messageDefault")}
                    rows={3}
                    className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-[#1F1F23] bg-white dark:bg-[#0F0F12] text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500 resize-none"
                    disabled={shareSending}
                  />
                </div>

                {/* Résultat */}
                {shareResult && (
                  <div
                    className={`flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-medium ${shareResult.success
                        ? "bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/40"
                        : "bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800/40"
                      }`}
                  >
                    {shareResult.success ? (
                      <Check className="h-4 w-4 flex-shrink-0" />
                    ) : (
                      <AlertCircle className="h-4 w-4 flex-shrink-0" />
                    )}
                    {shareResult.message}
                  </div>
                )}
              </div>

              {/* Footer modale */}
              <div className="flex items-center justify-end gap-3 p-5 pt-0">
                <button
                  type="button"
                  onClick={() => {
                    if (!shareSending) {
                      setShowShareModal(false)
                      setShareResult(null)
                    }
                  }}
                  disabled={shareSending}
                  className="px-4 py-2.5 rounded-xl border border-gray-200 dark:border-[#1F1F23] bg-white dark:bg-[#0F0F12] text-sm font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-[#1a1b1f] transition disabled:opacity-50"
                >
                  {t("cancel")}
                </button>
                <button
                  type="button"
                  onClick={handleShareEmail}
                  disabled={shareSending || !shareEmails.trim()}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-violet-600 via-purple-600 to-indigo-600 hover:from-violet-700 hover:via-purple-700 hover:to-indigo-700 text-white text-sm font-semibold shadow-[0_8px_20px_-8px_rgba(124,58,237,0.5)] hover:shadow-[0_10px_24px_-8px_rgba(124,58,237,0.6)] transition disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {shareSending ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {t("table.sending")}
                    </>
                  ) : (
                    <>
                      <Send className="h-4 w-4" />
                      {t("table.send")}
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  )
}
