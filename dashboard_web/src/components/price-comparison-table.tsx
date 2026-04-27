"use client"

import React, { useMemo, useState, useEffect, useCallback, useRef, forwardRef, useImperativeHandle } from "react"
import Image from "next/image"
import { X, Printer, FileSpreadsheet, Mail, Send, Loader2, Check, AlertCircle, ChevronDown, ChevronLeft, ChevronRight, Search, Palette, SlidersHorizontal } from "lucide-react"
import { useLanguage } from "@/contexts/language-context"
import { createPortal } from "react-dom"
import { deepNormalize, normalizeProductGroupKey, normalizeProductGroupKeyWithMode, getProductFamilyKey, type MatchMode } from "@/lib/analytics-calculations"
import { getEffectiveStatus } from "@/lib/product-status"
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
  produitReference?: { sourceUrl?: string; name?: string; prix?: number; image?: string; inventaire?: string; kilometrage?: number; etat?: string; sourceCategorie?: string }
  quantity?: number
  inventaire?: string
  groupedUrls?: string[]
  kilometrage?: number
}

type PriceComparisonTableProps = {
  products: Product[]
  competitorsUrls?: string[]
  ignoreColors?: boolean
  stripColorsFromDisplay?: boolean
  matchMode?: MatchMode
  onMatchModeChange?: (mode: string) => void
  searchQuery?: string
  onSearchChange?: (query: string) => void
  onToggleColors?: () => void
  searchPlaceholder?: string
  hideColorsLabel?: string
  showColorsLabel?: string
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
  'fonce', 'clair', 'fluo', 'neon', 'acide',
  'combat', 'lime', 'sauge', 'cristal', 'obsidian', 'ebony', 'ivory',
  'crystal', 'racing',
  'ebene', 'graphite', 'anthracite', 'platine', 'titane',
  'phantom', 'midnight', 'cosmic', 'storm',
  'petard', 'sommet', 'grisatre',
  'white', 'black', 'red', 'blue', 'green', 'yellow', 'pink', 'purple',
  'gray', 'grey', 'silver', 'gold', 'brown',
  'matte', 'glossy', 'metallic', 'pearl', 'carbon',
  'dark', 'light', 'neon', 'bright',
  'etincelle', 'velocite',
])

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

const etatConfig: Record<string, { labelKey: string; className: string }> = {
  neuf: { labelKey: "etat.new", className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" },
  occasion: { labelKey: "etat.used", className: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" },
  demonstrateur: { labelKey: "etat.demo", className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" },
  inventaire: { labelKey: "etat.inventory", className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" },
  catalogue: { labelKey: "etat.catalog", className: "bg-gray-100 text-gray-700 dark:bg-gray-800/30 dark:text-gray-400" },
  vehicules_occasion: { labelKey: "etat.used", className: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" },
}

function EtatBadge({ etat, sourceCategorie }: { etat?: string; sourceCategorie?: string }) {
  const { t } = useLanguage()
  const key = getEffectiveStatus(etat, sourceCategorie)
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
      ? "text-[var(--color-text-secondary)]"
      : delta > 0
        ? "text-[#3B6D11] dark:text-emerald-400"
        : delta < 0
          ? "text-[#A32D2D] dark:text-red-400"
          : "text-[var(--color-text-secondary)]"

  return (
    <div className="flex items-center justify-end gap-2">
      <span className="text-sm text-[var(--color-text-primary)]">{price !== null ? `${price.toFixed(0)} $` : "—"}</span>
      <span className={`text-xs font-semibold ${deltaTone}`}>
        {delta === null ? "—" : `${delta > 0 ? "+" : ""}${delta.toFixed(0)} $`}
      </span>
    </div>
  )
}

const KNOWN_BRAND_NAMES = new Set([
  'yamaha', 'kawasaki', 'honda', 'suzuki', 'ktm', 'husqvarna', 'ducati',
  'aprilia', 'vespa', 'piaggio', 'triumph', 'bmw', 'harley', 'indian',
  'polaris', 'cfmoto', 'can-am', 'sea-doo', 'ski-doo', 'beta', 'sherco',
  'benelli', 'gasgas', 'kymco', 'segway', 'zero',
])

function stripColorWords(text: string): string {
  if (!text) return text

  const normalizeWord = (w: string) => w.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')

  const words = text.split(/\s+/)
  const result: string[] = []
  let i = 0
  let colorRunStart = -1

  while (i < words.length) {
    const norm = normalizeWord(words[i])
    const isColor = COLOR_KEYWORDS_NORMALIZED.has(norm)

    if (isColor) {
      if (colorRunStart < 0) colorRunStart = i
      i++
      continue
    }

    if (colorRunStart >= 0) {
      if (norm === 'team' || KNOWN_BRAND_NAMES.has(norm)) {
        i++
        continue
      }
      colorRunStart = -1
    }

    result.push(words[i])
    i++
  }

  const cleaned = result.join(' ').replace(/\s+/g, ' ').trim()
  return cleaned || text
}

export type PriceComparisonTableHandle = {
  handlePrint: () => void
  handleExportExcel: () => void
  openShareModal: () => void
  tableDataLength: number
}

const PriceComparisonTable = forwardRef<PriceComparisonTableHandle, PriceComparisonTableProps>(function PriceComparisonTable({ products, competitorsUrls = [], ignoreColors = false, stripColorsFromDisplay = false, matchMode = 'exact', onMatchModeChange, searchQuery, onSearchChange, onToggleColors, searchPlaceholder, hideColorsLabel, showColorsLabel }, ref) {
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

  const competitorProductCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const p of products) {
      if (p.sourceSite) {
        const label = hostnameFromUrl(p.sourceSite)
        counts[label] = (counts[label] || 0) + 1
      }
    }
    return counts
  }, [products])

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
      kilometrage?: number
      competitorEtats: Record<string, string>
      competitorUrls: Record<string, string>
      reference: number | null
      competitorPrices: Record<string, number>
      quantity: number
      groupedUrls: string[]
    }>()

    const productsWithComparison = products.filter(p => p.prixReference != null && p.prixReference !== undefined)
    const productsRefOnly = products.filter(p => p.prixReference == null || p.prixReference === undefined)

    const getKey = (p: Product) => normalizeProductGroupKeyWithMode(p as any, matchMode)

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
          etat: p.produitReference?.etat ?? p.etat,
          sourceCategorie: p.produitReference?.sourceCategorie ?? p.sourceCategorie,
          referenceUrl: p.produitReference?.sourceUrl,
          inventaire: p.produitReference?.inventaire || p.inventaire,
          kilometrage: p.produitReference?.kilometrage ?? p.kilometrage,
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
        kilometrage: p.kilometrage,
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
        kilometrage: g.kilometrage,
        reference: g.reference,
        prices,
        quantity: g.quantity,
        groupedUrls: g.groupedUrls,
      }
    })
  }, [products, competitors, matchMode])

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

  useImperativeHandle(ref, () => ({
    handlePrint,
    handleExportExcel,
    openShareModal: () => { setShareResult(null); setShowShareModal(true) },
    tableDataLength: tableData.length,
  }), [handlePrint, handleExportExcel, tableData.length])

  type TableRow = (typeof tableData)[number]

  const [groupByFamily, setGroupByFamily] = useState(false)
  const [compFilter, setCompFilter] = useState<'all' | 'competitive' | 'non-competitive'>('all')

  const filteredTableData = useMemo(() => {
    if (compFilter === 'all') return tableData
    return tableData.filter(row => {
      const pricedCompetitors = row.prices.filter(p => p.price !== null && row.reference !== null)
      if (pricedCompetitors.length === 0) return compFilter === 'competitive'
      if (compFilter === 'competitive') {
        return pricedCompetitors.every(p => p.price! >= row.reference!)
      } else {
        return pricedCompetitors.some(p => p.price! < row.reference!)
      }
    })
  }, [tableData, compFilter])

  const flatRows = useMemo(() => {
    const result: Array<{ type: 'family'; label: string; count: number } | { type: 'row'; row: TableRow; globalIdx: number }> = []

    if (!groupByFamily) {
      filteredTableData.forEach((row, i) => result.push({ type: 'row', row, globalIdx: i }))
      return result
    }

    const families = new Map<string, { label: string; rows: TableRow[] }>()
    for (const row of filteredTableData) {
      const fk = getProductFamilyKey({
        name: row.name, marque: row.marque, modele: row.modele, prix: row.reference || 0,
      } as any)
      if (!families.has(fk)) {
        const [marque, baseModel] = fk.split('|')
        const label = marque && baseModel
          ? `${marque.charAt(0).toUpperCase() + marque.slice(1)} ${baseModel.toUpperCase()}`
          : row.marque || row.name
        families.set(fk, { label, rows: [] })
      }
      families.get(fk)!.rows.push(row)
    }

    let globalIdx = 0
    const sorted = Array.from(families.values()).sort((a, b) => b.rows.length - a.rows.length)
    for (const family of sorted) {
      if (family.rows.length > 1) {
        result.push({ type: 'family', label: family.label, count: family.rows.length })
      }
      for (const row of family.rows) {
        result.push({ type: 'row', row, globalIdx })
        globalIdx++
      }
    }
    return result
  }, [filteredTableData, groupByFamily])

  const ROWS_PER_PAGE = 50
  const [currentPage, setCurrentPage] = useState(0)
  const totalRows = flatRows.filter(r => r.type === 'row').length
  const totalPages = Math.max(1, Math.ceil(totalRows / ROWS_PER_PAGE))

  useEffect(() => {
    setCurrentPage(0)
  }, [products, searchQuery])

  useEffect(() => {
    setExpandedRows(new Set())
    setDetailRows(new Set())
  }, [currentPage])

  const tableScrollRef = useRef<HTMLDivElement>(null)
  const [canScrollTableRight, setCanScrollTableRight] = useState(false)

  const checkTableScroll = useCallback(() => {
    const el = tableScrollRef.current
    if (!el) return
    setCanScrollTableRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4)
  }, [])

  useEffect(() => {
    const el = tableScrollRef.current
    if (!el) return
    checkTableScroll()
    el.addEventListener("scroll", checkTableScroll, { passive: true })
    const ro = new ResizeObserver(checkTableScroll)
    ro.observe(el)
    return () => { el.removeEventListener("scroll", checkTableScroll); ro.disconnect() }
  }, [checkTableScroll, tableData, competitors])

  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set())
  const toggleRowExpand = (idx: number) => {
    setExpandedRows(prev => {
      const next = new Set(prev)
      if (next.has(idx)) next.delete(idx)
      else next.add(idx)
      return next
    })
  }

  const [detailRows, setDetailRows] = useState<Set<number>>(new Set())
  const toggleDetailRow = (idx: number) => {
    setDetailRows(prev => {
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
      kilometrage?: number
      reference: number | null
      prices: { dealer: string; price: number | null; delta: number | null; etat?: string; url?: string }[]
      quantity?: number
      groupedUrls?: string[]
    }>,
    emptyMessage?: string,
    overrideCompetitors?: { id: string; label: string }[]
  ) => {
    const cols = overrideCompetitors || competitors
    const dynamicMinWidth = 460 + (cols.length * 140)
    return (
      <div className="relative">
        <div ref={tableScrollRef} className="overflow-x-auto">
          <div style={{ minWidth: Math.max(900, dynamicMinWidth) }}>
            <table className="w-full border-collapse">
              <thead>
                <tr className="sticky top-0">
                  <th className="sticky left-0 z-30 bg-[var(--color-background-primary)] px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-secondary)] border-b border-[var(--color-border-tertiary)]">
                    {t("table.image")}
                  </th>
                  <th className="sticky left-[80px] z-30 bg-[var(--color-background-primary)] px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-secondary)] border-b border-[var(--color-border-tertiary)] min-w-[280px]">
                    {t("table.product")}
                  </th>
                  <th className="sticky left-[260px] z-30 bg-[var(--color-background-primary)] px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-secondary)] border-b border-[var(--color-border-tertiary)] whitespace-nowrap">
                    {t("table.refPrice")}
                  </th>
                  {cols.map(c => (
                    <th key={c.id} className="px-3 py-2.5 text-right border-b border-[var(--color-border-tertiary)] min-w-[130px]" title={c.label}>
                      <span className="truncate block max-w-[130px] text-[11px] font-semibold text-[var(--color-text-primary)]">{c.label}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.length === 0 && (
                  <tr>
                    <td colSpan={3 + cols.length} className="px-3 py-4 text-center text-sm text-[var(--color-text-secondary)]">
                      {emptyMessage || t("table.noProducts")}
                    </td>
                  </tr>
                )}
                {flatRows.slice(
                  currentPage * ROWS_PER_PAGE,
                  currentPage * ROWS_PER_PAGE + ROWS_PER_PAGE + 20
                ).map((entry, flatIdx) => {
                  if (entry.type === 'family') {
                    return (
                      <tr key={`fam-${flatIdx}`} className="bg-[var(--color-background-secondary)]/60">
                        <td colSpan={3 + cols.length} className="px-4 py-1.5 border-b border-[var(--color-border-tertiary)]">
                          <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--color-text-secondary)]">
                            {entry.label}
                          </span>
                          <span className="ml-2 text-[10px] text-[var(--color-text-secondary)]/60">{entry.count}</span>
                        </td>
                      </tr>
                    )
                  }
                  const p = entry.row
                  const idx = entry.globalIdx
                  const isUsed = p.etat === 'occasion' || p.etat === 'vehicules_occasion' || p.sourceCategorie === 'occasion' || p.sourceCategorie === 'vehicules_occasion'
                  const hasDetails = (isUsed && p.kilometrage != null) || !!p.inventaire
                  return (
                    <React.Fragment key={idx}>
                      <tr
                        className="group border-b border-[var(--color-border-tertiary)] hover:bg-[var(--color-background-hover)] transition-colors"
                      >
                        <td className="sticky left-0 z-20 bg-[var(--color-background-primary)] group-hover:bg-[var(--color-background-hover)] transition-colors px-3 py-2 align-middle">
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => hasDetails && toggleDetailRow(idx)}
                              className={`flex-shrink-0 p-0.5 rounded transition-all ${hasDetails ? 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-background-secondary)] cursor-pointer' : 'text-[var(--color-border-tertiary)] cursor-default'}`}
                              disabled={!hasDetails}
                              title={hasDetails ? (detailRows.has(idx) ? t("table.hideDetails") : t("table.showDetails")) : ''}
                            >
                              <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-200 ${detailRows.has(idx) ? 'rotate-180' : ''}`} />
                            </button>
                            <div className="w-12 h-12 rounded-lg overflow-hidden bg-[var(--color-background-secondary)] shadow-[0_8px_20px_-14px_rgba(0,0,0,0.4)]">
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
                          </div>
                        </td>
                        <td className="sticky left-[80px] z-20 bg-[var(--color-background-primary)] group-hover:bg-[var(--color-background-hover)] transition-colors px-3 py-2 min-w-[280px]">
                          <div className="flex flex-col gap-0.5">
                            {p.marque && extractMarque(p.marque) && (
                              <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">{extractMarque(p.marque)}</span>
                            )}
                            <div className="flex items-center gap-1.5 flex-wrap">
                              {(() => {
                                const rawName = p.displayName || p.name
                                const displayedName = stripColorsFromDisplay ? stripColorWords(rawName) : rawName
                                return p.referenceUrl ? (
                                  <a href={p.referenceUrl} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold text-[var(--color-text-primary)] whitespace-normal hover:text-emerald-600 dark:hover:text-emerald-400 hover:underline transition-colors">
                                    {displayedName}
                                  </a>
                                ) : (
                                  <span className="text-sm font-semibold text-[var(--color-text-primary)] whitespace-normal">
                                    {displayedName}
                                  </span>
                                )
                              })()}
                              {p.quantity != null && p.quantity > 1 && (
                                <button
                                  onClick={() => toggleRowExpand(idx)}
                                  className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 hover:bg-emerald-200 dark:hover:bg-emerald-800/50 transition-colors cursor-pointer"
                                  title={expandedRows.has(idx) ? "Masquer les URLs" : "Voir les URLs individuelles"}
                                >
                                  x{p.quantity} {expandedRows.has(idx) ? '▲' : '▼'}
                                </button>
                              )}
                            </div>
                            {p.inventaire && (
                              <span className="text-[10px] text-[var(--color-text-secondary)]">#{p.inventaire}</span>
                            )}
                          </div>
                        </td>
                        <td className="sticky left-[260px] z-20 bg-[var(--color-background-primary)] group-hover:bg-[var(--color-background-hover)] transition-colors px-3 py-2">
                          <div className="flex items-center justify-end gap-2">
                            <EtatBadge etat={p.etat} sourceCategorie={p.sourceCategorie} />
                            <span className="text-sm font-semibold text-[var(--color-text-primary)]">
                              {p.reference !== null ? (
                                p.referenceUrl ? (
                                  <a href={p.referenceUrl} target="_blank" rel="noopener noreferrer" className="hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors">
                                    {p.reference.toFixed(0)} $
                                  </a>
                                ) : (
                                  `${p.reference.toFixed(0)} $`
                                )
                              ) : "—"}
                            </span>
                          </div>
                        </td>
                        {p.prices.map(priceEntry => (
                          <td key={priceEntry.dealer} className="px-3 py-2 text-right text-sm text-[var(--color-text-primary)] min-w-[130px]">
                            <div className="flex flex-col items-end gap-0.5">
                              {priceEntry.url && priceEntry.price !== null ? (
                                <a href={priceEntry.url} target="_blank" rel="noopener noreferrer" className="hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors">
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
                      {detailRows.has(idx) && hasDetails && (
                        <tr className="bg-[var(--color-background-secondary)]/40 border-b border-[var(--color-border-tertiary)]">
                          <td colSpan={3 + cols.length} className="px-4 py-2.5">
                            <div className="flex flex-wrap gap-x-6 gap-y-1.5 items-center pl-6">
                              {isUsed && p.kilometrage != null && (
                                <div className="flex items-center gap-1.5">
                                  <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">{t("table.mileage")}</span>
                                  <span className="text-xs font-medium text-[var(--color-text-primary)]">{p.kilometrage.toLocaleString()} km</span>
                                </div>
                              )}
                              {p.inventaire && (
                                <div className="flex items-center gap-1.5">
                                  <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">{t("table.serialNumber")}</span>
                                  <span className="text-xs font-medium text-[var(--color-text-primary)]">#{p.inventaire}</span>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                      {expandedRows.has(idx) && p.groupedUrls && p.groupedUrls.length > 0 && (
                        <tr className="bg-emerald-50/50 dark:bg-emerald-950/20 border-b border-[var(--color-border-tertiary)]">
                          <td colSpan={3 + cols.length} className="px-4 py-2">
                            <div className="flex flex-wrap gap-2 items-center">
                              <span className="text-xs font-medium text-[var(--color-text-secondary)]">URLs regroupées :</span>
                              {p.groupedUrls.map((url: string, urlIdx: number) => (
                                <a
                                  key={urlIdx}
                                  href={url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-xs text-emerald-600 dark:text-emerald-400 hover:underline truncate max-w-[300px]"
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
                  )
                })}

              </tbody>
            </table>
          </div>
        </div>
        {canScrollTableRight && cols.length >= 3 && (
          <div className="absolute right-0 top-0 bottom-0 w-8 pointer-events-none bg-gradient-to-l from-[var(--color-background-primary)]/80 to-transparent z-10 flex items-center justify-center">
            <ChevronRight className="h-4 w-4 text-[var(--color-text-secondary)] animate-pulse" />
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="pb-5">
      {/* Toolbar: search + toggles + export — Stripe-style uniform */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[var(--color-border-tertiary)] bg-[var(--color-background-primary)] flex-wrap">
        {onSearchChange && (
          <div className="relative w-56">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--color-text-tertiary)]" />
            <input
              type="text"
              value={searchQuery || ""}
              onChange={e => onSearchChange(e.target.value)}
              placeholder={searchPlaceholder || "Ex: Kawasaki 2025, Ninja 650..."}
              className="w-full h-8 pl-8 pr-7 rounded-md border border-[var(--color-border-tertiary)] bg-[var(--color-background-primary)] text-xs text-[var(--color-text-primary)] placeholder-[var(--color-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500/40 transition"
            />
            {searchQuery && (
              <button type="button" onClick={() => onSearchChange("")} className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition">
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        )}
        {onToggleColors && (
          <button
            type="button"
            onClick={onToggleColors}
            className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md text-xs font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-background-hover)] transition shrink-0"
          >
            <Palette className="h-3.5 w-3.5" />
            {stripColorsFromDisplay ? (showColorsLabel || "Afficher couleurs") : (hideColorsLabel || "Masquer couleurs")}
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            setGroupByFamily(prev => {
              const next = !prev
              if (!next && onMatchModeChange) onMatchModeChange('exact')
              return next
            })
          }}
          className={`inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md text-xs font-medium transition shrink-0 ${
            groupByFamily
              ? 'text-[var(--color-text-primary)] bg-[var(--color-background-secondary)]'
              : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-background-hover)]'
          }`}
        >
          <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="1" y="1" width="14" height="4" rx="1" /><rect x="1" y="7" width="14" height="4" rx="1" /><line x1="4" y1="13" x2="12" y2="13" /></svg>
          {groupByFamily ? t("table.ungroupModels") : t("table.groupModels")}
        </button>
        {groupByFamily && onMatchModeChange && (
          <select
            value={matchMode}
            onChange={(e) => onMatchModeChange(e.target.value)}
            className="h-8 text-xs pl-2 pr-6 rounded-md border border-[var(--color-border-tertiary)] bg-[var(--color-background-primary)] text-[var(--color-text-secondary)] focus:outline-none focus:ring-1 focus:ring-emerald-500/20 shrink-0"
          >
            <option value="exact">{t("config.matchMode.exact")}</option>
            <option value="base">{t("config.matchMode.base")}</option>
            <option value="no_year">{t("config.matchMode.no_year")}</option>
            <option value="flexible">{t("config.matchMode.flexible")}</option>
          </select>
        )}

        {/* Filtres compétitivité */}
        <div className="flex items-center shrink-0">
          <button
            type="button"
            onClick={() => setCompFilter(prev => prev === 'competitive' ? 'all' : 'competitive')}
            className={`inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md text-xs font-medium transition ${
              compFilter === 'competitive'
                ? 'text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10'
                : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-background-hover)]'
            }`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${compFilter === 'competitive' ? 'bg-emerald-500' : 'bg-emerald-500/60'}`} />
            Compétitif
          </button>
          <button
            type="button"
            onClick={() => setCompFilter(prev => prev === 'non-competitive' ? 'all' : 'non-competitive')}
            className={`inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md text-xs font-medium transition ${
              compFilter === 'non-competitive'
                ? 'text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-500/10'
                : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-background-hover)]'
            }`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${compFilter === 'non-competitive' ? 'bg-red-500' : 'bg-red-500/60'}`} />
            Non compétitif
          </button>
        </div>

        <div className="ml-auto flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={handleExportExcel}
            disabled={tableData.length === 0}
            className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md text-xs font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-background-hover)] transition shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <FileSpreadsheet className="h-3.5 w-3.5" />
            Excel
          </button>
          <button
            type="button"
            onClick={handlePrint}
            disabled={tableData.length === 0}
            className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md text-xs font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-background-hover)] transition shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Printer className="h-3.5 w-3.5" />
            {t("table.print")}
          </button>
          <button
            type="button"
            onClick={() => { setShareResult(null); setShowShareModal(true) }}
            disabled={tableData.length === 0}
            className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md text-xs font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-background-hover)] transition shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Mail className="h-3.5 w-3.5" />
            {t("table.share")}
          </button>
        </div>
      </div>

      <div id="price-comparison-table">
        {renderTable(
          tableData,
          t("table.noProductsYet")
        )}
      </div>

      {totalRows > ROWS_PER_PAGE && (
        <div className="flex items-center justify-between mt-4 px-6">
          <span className="text-xs text-[var(--color-text-secondary)] tabular-nums">
            {t("table.showing")} {currentPage * ROWS_PER_PAGE + 1} {t("table.to")} {Math.min((currentPage + 1) * ROWS_PER_PAGE, totalRows)} {t("table.of")} {totalRows}
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setCurrentPage(p => Math.max(0, p - 1))}
              disabled={currentPage === 0}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium text-[var(--color-text-secondary)] border border-[var(--color-border-tertiary)] bg-[var(--color-background-primary)] hover:bg-[var(--color-background-secondary)] transition disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="h-3 w-3" />
              {t("table.previous")}
            </button>
            <div className="flex items-center gap-0.5">
              {Array.from({ length: totalPages }, (_, i) => i).map(page => {
                if (totalPages <= 7 || page === 0 || page === totalPages - 1 || Math.abs(page - currentPage) <= 1) {
                  return (
                    <button
                      key={page}
                      type="button"
                      onClick={() => setCurrentPage(page)}
                      className={`min-w-[28px] h-7 rounded-md text-xs font-medium transition ${page === currentPage
                          ? "bg-[var(--color-text-primary)] text-[var(--color-background-primary)]"
                          : "text-[var(--color-text-secondary)] hover:bg-[var(--color-background-secondary)]"
                        }`}
                    >
                      {page + 1}
                    </button>
                  )
                }
                if (page === 1 && currentPage > 3) return <span key="start-dots" className="px-1 text-xs text-[var(--color-text-secondary)]">…</span>
                if (page === totalPages - 2 && currentPage < totalPages - 4) return <span key="end-dots" className="px-1 text-xs text-[var(--color-text-secondary)]">…</span>
                return null
              })}
            </div>
            <button
              type="button"
              onClick={() => setCurrentPage(p => Math.min(totalPages - 1, p + 1))}
              disabled={currentPage >= totalPages - 1}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium text-[var(--color-text-secondary)] border border-[var(--color-border-tertiary)] bg-[var(--color-background-primary)] hover:bg-[var(--color-background-secondary)] transition disabled:opacity-30 disabled:cursor-not-allowed"
            >
              {t("table.next")}
              <ChevronRight className="h-3 w-3" />
            </button>
          </div>
        </div>
      )}

      {/* Modale Partage — compositeur d'email */}
      {mounted &&
        showShareModal &&
        createPortal(
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[9999] flex items-end sm:items-center justify-center sm:px-4"
            onClick={(e) => {
              if (e.target === e.currentTarget && !shareSending) {
                setShowShareModal(false)
                setShareResult(null)
              }
            }}
          >
            <div className="bg-white dark:bg-[#1c1e20] w-full sm:max-w-2xl rounded-t-2xl sm:rounded-2xl shadow-2xl border border-gray-200 dark:border-[#2a2c2e] overflow-hidden animate-in slide-in-from-bottom-4 sm:slide-in-from-bottom-0 sm:fade-in duration-200">

              {/* Barre de titre */}
              <div className="flex items-center justify-between px-5 py-4 bg-gray-50 dark:bg-[#242628] border-b border-gray-200 dark:border-[#2a2c2e]">
                <div className="flex items-center gap-3">
                  <div className="relative h-8 w-8 shrink-0 rounded-lg overflow-hidden bg-gray-100 dark:bg-[#1c1e20]">
                    <Image src="/Go-Data.svg" alt="GO-DATA" fill sizes="32px" className="object-contain" />
                  </div>
                  <span className="text-base font-semibold text-gray-900 dark:text-white">Nouveau message</span>
                </div>
                <button
                  type="button"
                  onClick={() => { if (!shareSending) { setShowShareModal(false); setShareResult(null) } }}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-200 dark:hover:bg-[#2a2c2e] transition"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Champs */}
              <div className="divide-y divide-gray-100 dark:divide-[#242628]">
                {/* De */}
                <div className="flex items-center gap-4 px-5 py-3">
                  <span className="text-sm text-gray-400 dark:text-gray-500 w-10 shrink-0">De</span>
                  <span className="text-sm text-gray-600 dark:text-gray-400">
                    Go-Data &lt;gestion@go-data.co&gt;
                  </span>
                </div>

                {/* À */}
                <div className="flex items-center gap-4 px-5 py-3">
                  <span className="text-sm text-gray-400 dark:text-gray-500 w-10 shrink-0">À</span>
                  <input
                    type="text"
                    value={shareEmails}
                    onChange={e => setShareEmails(e.target.value)}
                    placeholder="destinataire@exemple.com, autre@exemple.com"
                    className="flex-1 text-sm text-gray-900 dark:text-white bg-transparent focus:outline-none placeholder:text-gray-400 dark:placeholder:text-gray-600"
                    disabled={shareSending}
                    autoFocus
                  />
                </div>

                {/* Sujet */}
                <div className="flex items-center gap-4 px-5 py-3">
                  <span className="text-sm text-gray-400 dark:text-gray-500 w-10 shrink-0">Sujet</span>
                  <input
                    type="text"
                    value={shareSubject}
                    onChange={e => setShareSubject(e.target.value)}
                    placeholder={t("table.subjectDefault")}
                    className="flex-1 text-sm text-gray-900 dark:text-white bg-transparent focus:outline-none placeholder:text-gray-400 dark:placeholder:text-gray-600"
                    disabled={shareSending}
                  />
                </div>

                {/* Corps */}
                <div className="px-5 py-4">
                  <textarea
                    value={shareMessage}
                    onChange={e => setShareMessage(e.target.value)}
                    placeholder={t("table.messageDefault")}
                    rows={6}
                    className="w-full text-sm text-gray-800 dark:text-gray-200 bg-transparent focus:outline-none placeholder:text-gray-400 dark:placeholder:text-gray-600 resize-none leading-relaxed"
                    disabled={shareSending}
                  />
                </div>

                {/* Pièce jointe */}
                <div className="px-5 py-3">
                  <div className="inline-flex items-center gap-2.5 px-3.5 py-2 rounded-xl bg-gray-100 dark:bg-[#242628] border border-gray-200 dark:border-[#2a2c2e]">
                    <FileSpreadsheet className="h-4 w-4 text-gray-500 dark:text-gray-400 shrink-0" />
                    <span className="text-sm text-gray-700 dark:text-gray-300 font-medium">
                      Comparatif_prix_Go-Data.xlsx
                    </span>
                    <span className="text-xs text-gray-400 dark:text-gray-500">
                      · {tableData.length} produits
                    </span>
                  </div>
                </div>
              </div>

              {/* Résultat */}
              {shareResult && (
                <div className={`mx-5 mb-3 flex items-center gap-2 px-4 py-3 rounded-xl text-sm ${
                  shareResult.success
                    ? "bg-[#EAF3DE] dark:bg-[#3B6D11]/15 text-[#27500A] dark:text-[#3B6D11]"
                    : "bg-[#FCEBEB] dark:bg-[#A32D2D]/15 text-[#791F1F] dark:text-[#A32D2D]"
                }`}>
                  {shareResult.success ? <Check className="h-4 w-4 shrink-0" /> : <AlertCircle className="h-4 w-4 shrink-0" />}
                  {shareResult.message}
                </div>
              )}

              {/* Footer */}
              <div className="flex items-center justify-between px-5 py-3.5 border-t border-gray-200 dark:border-[#2a2c2e]">
                <span className="text-xs text-gray-400 dark:text-gray-500">gestion@go-data.co</span>
                <div className="flex items-center gap-2.5">
                  <button
                    type="button"
                    onClick={() => { if (!shareSending) { setShowShareModal(false); setShareResult(null) } }}
                    disabled={shareSending}
                    className="px-4 py-2 rounded-xl text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-[#242628] transition disabled:opacity-50"
                  >
                    {t("cancel")}
                  </button>
                  <button
                    type="button"
                    onClick={handleShareEmail}
                    disabled={shareSending || !shareEmails.trim()}
                    className="inline-flex items-center gap-2 px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold shadow-sm transition disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {shareSending ? (
                      <><Loader2 className="h-3.5 w-3.5 animate-spin" />{t("table.sending")}</>
                    ) : (
                      <><Send className="h-3.5 w-3.5" />{t("table.send")}</>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  )
})

export default PriceComparisonTable
