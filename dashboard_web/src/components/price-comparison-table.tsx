"use client"

import React, { useMemo, useState, useEffect, useCallback, useRef, forwardRef, useImperativeHandle } from "react"
import Image from "next/image"
import { X, Printer, FileSpreadsheet, Mail, Send, Loader2, Check, AlertCircle, ChevronDown, ChevronLeft, ChevronRight, Search, Palette, CircleDollarSign, ClipboardList, MoreHorizontal, LayoutGrid } from "lucide-react"
import { useLanguage } from "@/contexts/language-context"
import { createPortal } from "react-dom"
import { normalizeProductGroupKeyWithMode, getProductFamilyKey, type MatchMode, type Product as AnalyticsProduct } from "@/lib/analytics-calculations"
import { cn } from "@/lib/utils"
import { getEffectiveStatus } from "@/lib/product-status"
import { printSection, exportComparisonToExcel, shareComparisonByEmail, type ComparisonRow } from "@/lib/export-utils"
import type { TranslationKey } from "@/lib/translations"
import {
  buildPricingProductKey,
  calculatePricingRecommendation,
  inferVehicleType,
  type AppliedPricingUpdate,
  type PricingRecommendation,
  type PricingStrategySettings,
  type VehicleType,
} from "@/lib/pricing-strategy"

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
  price_on_request?: boolean
  competitors?: Record<string, number | null>
  produitReference?: { sourceUrl?: string; name?: string; prix?: number; image?: string; inventaire?: string; kilometrage?: number; etat?: string; sourceCategorie?: string; quantity?: number; groupedUrls?: string[] }
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
  pricingSettings?: PricingStrategySettings | null
  pricingEnabled?: boolean
  pricingUpdates?: AppliedPricingUpdate[]
  onPricingEnabledChange?: (enabled: boolean) => void
  selectedPricingKeys?: Set<string>
  onTogglePricingSelection?: (productKey: string) => void
  onSetPricingSelection?: (productKeys: string[], selected: boolean) => void
  onPricingKeysAvailable?: (keys: string[]) => void
  creatingChangeSheet?: boolean
  onCreateChangeSheet?: (productKeys: string[], priceOverrides?: Record<string, number>) => Promise<void> | void
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

// Palette des états : on ne peint plus le fond du badge avec une couleur
// saturée (qui dominait visuellement le PRIX dans la même cellule), on
// utilise un point coloré minimaliste + un libellé fin gris. La couleur
// reste lisible mais elle ne crie plus plus fort que la donnée principale.
const etatConfig: Record<string, { labelKey: TranslationKey; dotClass: string }> = {
  neuf:               { labelKey: "etat.new",          dotClass: "bg-emerald-500" },
  occasion:           { labelKey: "etat.used",         dotClass: "bg-amber-500" },
  demonstrateur:      { labelKey: "etat.demo",         dotClass: "bg-emerald-500" },
  inventaire:         { labelKey: "etat.inventory",    dotClass: "bg-emerald-500" },
  catalogue:          { labelKey: "etat.catalog",      dotClass: "bg-gray-400" },
  vehicules_occasion: { labelKey: "etat.used",         dotClass: "bg-amber-500" },
}

function EtatBadge({ etat, sourceCategorie }: { etat?: string; sourceCategorie?: string }) {
  const { t } = useLanguage()
  const key = getEffectiveStatus(etat, sourceCategorie)
  const config = etatConfig[key]
  if (!config) return null
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-medium leading-none text-[var(--color-text-secondary)] uppercase tracking-wide">
      <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${config.dotClass}`} aria-hidden />
      {t(config.labelKey)}
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

  // whitespace-nowrap empêche le wrap "59 995 $" → "59 995\n$" sur les
  // colonnes étroites (problème historique sur l'outil de pricing).
  return (
    <div className="flex items-center justify-end gap-2 whitespace-nowrap">
      <span className="text-sm text-[var(--color-text-primary)] tabular-nums">{price !== null ? `${price.toFixed(0)} $` : "—"}</span>
      <span className={`text-xs font-semibold tabular-nums ${deltaTone}`}>
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

function parseEditablePrice(value: string): number | null {
  const normalized = value.replace(/[^\d]/g, "")
  if (!normalized) return null
  const parsed = Number(normalized)
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : null
}

function formatEditablePrice(price: number) {
  return Math.round(price).toString()
}

function hasListedPrice(product: Product): product is Product & { prix: number } {
  return !product.price_on_request && typeof product.prix === "number" && product.prix > 0
}

export type PriceComparisonTableHandle = {
  handlePrint: () => void
  handleExportExcel: () => void
  openShareModal: () => void
  tableDataLength: number
}

function toAnalyticsProduct(product: Product): AnalyticsProduct {
  return {
    name: product.name || "",
    prix: product.prix || 0,
    prixReference: product.prixReference,
    sourceSite: product.sourceSite,
    sourceUrl: product.sourceUrl,
    marque: product.marque,
    modele: product.modele,
    annee: product.annee ?? null,
    etat: product.etat,
    quantity: product.quantity,
    inventaire: product.inventaire,
    groupedUrls: product.groupedUrls,
  }
}

const PriceComparisonTable = forwardRef<PriceComparisonTableHandle, PriceComparisonTableProps>(function PriceComparisonTable({ products, competitorsUrls = [], stripColorsFromDisplay = false, matchMode = 'exact', onMatchModeChange, searchQuery, onSearchChange, onToggleColors, searchPlaceholder, hideColorsLabel, showColorsLabel, pricingSettings, pricingEnabled = false, onPricingEnabledChange, selectedPricingKeys, onTogglePricingSelection, onSetPricingSelection, onPricingKeysAvailable, creatingChangeSheet = false, onCreateChangeSheet }, ref) {
  const { t } = useLanguage()
  const [mounted, setMounted] = useState(false)
  const [showShareModal, setShowShareModal] = useState(false)
  const [shareEmails, setShareEmails] = useState("")
  const [shareMessage, setShareMessage] = useState("")
  const [shareSubject, setShareSubject] = useState("")
  const [shareSending, setShareSending] = useState(false)
  const [shareResult, setShareResult] = useState<{ success: boolean; message: string } | null>(null)

  useEffect(() => {
    const frame = requestAnimationFrame(() => setMounted(true))
    return () => cancelAnimationFrame(frame)
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
      productKey: string
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
      vehicleType: VehicleType
      competitorPrices: Record<string, number>
      quantity: number
      groupedUrls: string[]
      isMatchedGroup: boolean
    }>()

    const productsWithComparison = products.filter(p => p.prixReference != null && p.prixReference !== undefined)
    const productsRefOnly = products.filter(p => p.prixReference == null || p.prixReference === undefined)

    // Pour les produits matchés : on regroupe par produit de référence (sourceUrl) quand disponible.
    // Cela évite que deux concurrents matchant le même véhicule de référence (avec des noms légèrement différents)
    // créent deux lignes distinctes — c'est ce qui faisait apparaître des lignes sans match visible.
    const getKey = (p: Product) => {
      const refUrl = p.produitReference?.sourceUrl
      if (refUrl) return `ref:${refUrl}`
      return normalizeProductGroupKeyWithMode(toAnalyticsProduct(p), matchMode)
    }

    // Index des quantités/URLs du site référent (pour ne pas accumuler les quantités des concurrents).
    // Deux index parallèles : par clé normalisée ET par URL du produit de référence,
    // pour pouvoir retrouver l'info depuis un produit matché (qui pointe vers la référence via produitReference).
    const refInfoByKey = new Map<string, { quantity: number; groupedUrls: string[] }>()
    const refInfoBySourceUrl = new Map<string, { quantity: number; groupedUrls: string[] }>()
    for (const p of productsRefOnly) {
      const info = { quantity: p.quantity || 1, groupedUrls: p.groupedUrls || (p.sourceUrl ? [p.sourceUrl] : []) }
      const normKey = normalizeProductGroupKeyWithMode(toAnalyticsProduct(p), matchMode)
      if (!refInfoByKey.has(normKey)) refInfoByKey.set(normKey, info)
      if (p.sourceUrl && !refInfoBySourceUrl.has(p.sourceUrl)) refInfoBySourceUrl.set(p.sourceUrl, info)
    }

    // 1) Traiter d'abord les produits matchés (concurrents avec prix de référence)
    for (const p of productsWithComparison) {
      const key = getKey(p)
      if (!groups.has(key)) {
        const refName = p.produitReference?.name
        const displayProduct: Product = refName
          ? { ...p, name: refName }
          : p
        const referenceUrl = p.produitReference?.sourceUrl
        // Préférence pour les infos venant des produits référent présents
        // dans la liste (passe complète). Fallback sur ce qui a été reporté
        // dans `produitReference` côté backend — indispensable dans l'onglet
        // « Comparés » où productsRefOnly est vide et où l'index local ne
        // peut pas être rempli, sinon le badge x{quantity} disparaît.
        const refInfo = (referenceUrl && refInfoBySourceUrl.get(referenceUrl))
          || refInfoByKey.get(normalizeProductGroupKeyWithMode(toAnalyticsProduct(p), matchMode))
          || (p.produitReference && (p.produitReference.quantity || p.produitReference.groupedUrls)
            ? {
              quantity: p.produitReference.quantity || 1,
              groupedUrls: p.produitReference.groupedUrls
                || (p.produitReference.sourceUrl ? [p.produitReference.sourceUrl] : []),
            }
            : undefined)
        groups.set(key, {
          productKey: key,
          displayName: getProductDisplayName(displayProduct),
          image: p.produitReference?.image || p.image,
          modele: p.modele,
          marque: p.marque,
          etat: p.produitReference?.etat ?? p.etat,
          sourceCategorie: p.produitReference?.sourceCategorie ?? p.sourceCategorie,
          referenceUrl,
          inventaire: p.produitReference?.inventaire || p.inventaire,
          kilometrage: p.produitReference?.kilometrage ?? p.kilometrage,
          competitorEtats: {},
          competitorUrls: {},
          reference: p.prixReference ?? null,
          vehicleType: inferVehicleType({ sourceUrl: referenceUrl || p.sourceUrl, name: displayProduct.name }),
          competitorPrices: {},
          quantity: refInfo?.quantity || 1,
          groupedUrls: refInfo?.groupedUrls || [],
          isMatchedGroup: true,
        })
      }
      const group = groups.get(key)!
      if (p.produitReference?.image && !group.image) group.image = p.produitReference.image
      const siteLabel = p.sourceSite ? hostnameFromUrl(p.sourceSite) : ''
      if (siteLabel && hasListedPrice(p)) {
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
    // On vérifie à la fois la clé normalisée (legacy) ET la clé `ref:URL` correspondant à l'URL du produit,
    // pour éviter de dupliquer un véhicule de référence déjà affiché via un groupe matché.
    let refOnlyIndex = 0
    for (const p of productsRefOnly) {
      const refPrice = hasListedPrice(p) ? p.prix : null
      if (refPrice === null) continue
      const baseKey = getKey(p)
      if (groups.has(baseKey)) continue
      if (p.sourceUrl && groups.has(`ref:${p.sourceUrl}`)) continue
      const key = `${baseKey}__ref_${refOnlyIndex++}`
      groups.set(key, {
        productKey: key,
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
        vehicleType: inferVehicleType(p),
        isMatchedGroup: false,
      })
    }

    return Array.from(groups.values()).filter(g => {
      // Pour un groupe issu d'un match (provenant d'un produit avec prixReference),
      // on exige au moins un prix concurrent réel. Sinon la ligne afficherait « — » partout
      // et fausserait le compte affiché en haut de l'onglet Comparés.
      // Les groupes « référence seule » sont conservés tels quels (onglet Référence).
      if (g.isMatchedGroup) {
        return Object.keys(g.competitorPrices).length > 0
      }
      return true
    }).map(g => {
      const prices = competitors.map(c => {
        const price = g.competitorPrices[c.label] ?? null
        const delta = g.reference !== null && price !== null ? price - g.reference : null
        const competitorEtat = g.competitorEtats[c.label] || ''
        const competitorUrl = g.competitorUrls[c.label] || ''
        return { dealer: c.label, price, delta, etat: competitorEtat, url: competitorUrl }
      })

      return {
        productKey: g.productKey,
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
        vehicleType: g.vehicleType,
      }
    })
  }, [products, competitors, matchMode])

  // ── Actions d'export ──

  const handlePrint = useCallback(() => {
    printSection("price-comparison-table", t("table.priceComparison"))
  }, [t])

  const handleExportExcel = useCallback(() => {
    const competitorLabels = competitors.map(c => c.label)
    exportComparisonToExcel(tableData as ComparisonRow[], competitorLabels).catch(err => {
      console.error("[export] Échec de l'export Excel:", err)
    })
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
  }, [shareEmails, shareSubject, shareMessage, tableData, competitors, t])

  useImperativeHandle(ref, () => ({
    handlePrint,
    handleExportExcel,
    openShareModal: () => { setShareResult(null); setShowShareModal(true) },
    tableDataLength: tableData.length,
  }), [handlePrint, handleExportExcel, tableData.length])

  type TableRow = (typeof tableData)[number]

  const [groupByFamily, setGroupByFamily] = useState(false)
  const [compFilter, setCompFilter] = useState<'all' | 'competitive' | 'non-competitive'>('all')
  const [showOverflowMenu, setShowOverflowMenu] = useState(false)
  const [editedPricingPrices, setEditedPricingPrices] = useState<Record<string, string>>({})
  const overflowMenuRef = useRef<HTMLDivElement | null>(null)

  // Ferme le dropdown overflow ("…") au clic extérieur. Pattern UX standard
  // pour ne pas bloquer les autres actions de la toolbar.
  useEffect(() => {
    if (!showOverflowMenu) return
    const handler = (e: MouseEvent) => {
      if (overflowMenuRef.current && !overflowMenuRef.current.contains(e.target as Node)) {
        setShowOverflowMenu(false)
      }
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [showOverflowMenu])

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

  const pricingRecommendations = useMemo(() => {
    const map = new Map<string, PricingRecommendation>()
    if (!pricingSettings) return map

    for (const row of filteredTableData) {
      const productKey = buildPricingProductKey({
        name: row.name,
        referenceUrl: row.referenceUrl,
        productKey: row.productKey,
      })
      const recommendation = calculatePricingRecommendation(
        {
          name: row.name,
          productKey,
          reference: row.reference,
          referenceUrl: row.referenceUrl,
          vehicleType: row.vehicleType,
          prices: row.prices,
        },
        pricingSettings
      )
      if (recommendation) {
        map.set(productKey, recommendation)
      }
    }

    return map
  }, [filteredTableData, pricingSettings])

  const visiblePricingKeys = useMemo(() => {
    return filteredTableData
      .map(row => pricingRecommendations.get(row.productKey)?.productKey)
      .filter((key): key is string => Boolean(key))
  }, [filteredTableData, pricingRecommendations])

  const selectedVisiblePricingKeys = useMemo(() => {
    return visiblePricingKeys.filter(key => selectedPricingKeys?.has(key))
  }, [visiblePricingKeys, selectedPricingKeys])

  const allVisiblePricingSelected =
    visiblePricingKeys.length > 0 &&
    selectedVisiblePricingKeys.length === visiblePricingKeys.length

  const lastNotifiedKeysRef = useRef<string>("")
  useEffect(() => {
    if (!onPricingKeysAvailable) return
    if (!pricingEnabled) return
    const signature = visiblePricingKeys.slice().sort().join("|")
    if (signature === lastNotifiedKeysRef.current) return
    lastNotifiedKeysRef.current = signature
    onPricingKeysAvailable(visiblePricingKeys)
  }, [visiblePricingKeys, pricingEnabled, onPricingKeysAvailable])

  const updateEditedPricingPrice = useCallback((productKey: string, value: string) => {
    setEditedPricingPrices(prev => ({
      ...prev,
      [productKey]: value.replace(/[^\d\s,.]/g, ""),
    }))
  }, [])

  const resetEditedPricingPrice = useCallback((productKey: string) => {
    setEditedPricingPrices(prev => {
      if (!(productKey in prev)) return prev
      const next = { ...prev }
      delete next[productKey]
      return next
    })
  }, [])

  const commitEditedPricingPrice = useCallback((productKey: string, automaticPrice: number) => {
    setEditedPricingPrices(prev => {
      if (!(productKey in prev)) return prev
      const parsed = parseEditablePrice(prev[productKey])
      const next = { ...prev }
      if (parsed === null || parsed === Math.round(automaticPrice)) {
        delete next[productKey]
      } else {
        next[productKey] = formatEditablePrice(parsed)
      }
      return next
    })
  }, [])

  const getSelectedPricingOverrides = useCallback((productKeys: string[]) => {
    const overrides: Record<string, number> = {}
    for (const productKey of productKeys) {
      const recommendation = pricingRecommendations.get(productKey)
      const editedValue = editedPricingPrices[productKey]
      if (!recommendation || editedValue == null) continue
      const parsed = parseEditablePrice(editedValue)
      if (parsed !== null && parsed !== Math.round(recommendation.recommendedPrice)) {
        overrides[productKey] = parsed
      }
    }
    return overrides
  }, [editedPricingPrices, pricingRecommendations])

  const flatRows = useMemo(() => {
    const result: Array<{ type: 'family'; label: string; count: number } | { type: 'row'; row: TableRow; globalIdx: number }> = []

    if (!groupByFamily) {
      filteredTableData.forEach((row, i) => result.push({ type: 'row', row, globalIdx: i }))
      return result
    }

    const families = new Map<string, { label: string; rows: TableRow[] }>()
    for (const row of filteredTableData) {
      const fk = getProductFamilyKey({
        name: row.name,
        prix: row.reference || 0,
        marque: row.marque,
        modele: row.modele,
      })
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
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set())
  const [detailRows, setDetailRows] = useState<Set<number>>(new Set())

  useEffect(() => {
    const frame = requestAnimationFrame(() => setCurrentPage(0))
    return () => cancelAnimationFrame(frame)
  }, [products, searchQuery])

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setExpandedRows(new Set())
      setDetailRows(new Set())
    })
    return () => cancelAnimationFrame(frame)
  }, [currentPage])

  const tableScrollRef = useRef<HTMLDivElement>(null)
  const [canScrollTableRight, setCanScrollTableRight] = useState(false)
  const [hasScrolledTableLeft, setHasScrolledTableLeft] = useState(false)

  const checkTableScroll = useCallback(() => {
    const el = tableScrollRef.current
    if (!el) return
    setHasScrolledTableLeft(el.scrollLeft > 4)
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

  const toggleRowExpand = (idx: number) => {
    setExpandedRows(prev => {
      const next = new Set(prev)
      if (next.has(idx)) next.delete(idx)
      else next.add(idx)
      return next
    })
  }

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
      productKey: string
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
      vehicleType: VehicleType
      prices: { dealer: string; price: number | null; delta: number | null; etat?: string; url?: string }[]
      quantity?: number
      groupedUrls?: string[]
    }>,
    emptyMessage?: string,
    overrideCompetitors?: { id: string; label: string }[]
  ) => {
    const showPricingRecommendations = pricingEnabled && !!pricingSettings
    const cols = showPricingRecommendations ? [] : (overrideCompetitors || competitors)
    // Colonnes sticky gauche : Image 80px + Produit 280px + Prix réf 120px.
    // Base 500px pour garder un peu d'air et éviter que les colonnes
    // concurrentes commencent sous la colonne prix référence.
    const dynamicMinWidth = 500 + (showPricingRecommendations ? 240 : cols.length * 140)
    const dynamicColumnCount = showPricingRecommendations ? 2 : cols.length
    return (
      <div className="relative">
        {/* Wrapper du tableau — totalement transparent (pas de fond, pas
            de bordure). Le tableau "vit" sur le background beams sans
            créer de container visible. Les cellules sticky gauche
            conservent un bg-primary semi-transparent + backdrop-blur
            (voir plus bas) pour rester lisibles au scroll horizontal. */}
        <div ref={tableScrollRef} className="overflow-x-auto">
          <div style={{ minWidth: Math.max(900, dynamicMinWidth) }}>
            <table className="w-full border-collapse">
              <thead>
                {showPricingRecommendations && onCreateChangeSheet && (
                  <tr className="sticky top-0">
                    <th colSpan={3} className="border-b border-[var(--color-border-tertiary)] bg-transparent" />
                    <th colSpan={2} className="border-b border-[var(--color-border-tertiary)] px-2 py-2 text-center">
                      <div className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)]/85 px-2 py-1 shadow-sm">
                        {onSetPricingSelection && (
                          <button
                            type="button"
                            disabled={visiblePricingKeys.length === 0}
                            onClick={() => onSetPricingSelection(visiblePricingKeys, !allVisiblePricingSelected)}
                            className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11px] font-semibold text-[var(--color-text-secondary)] transition hover:bg-[var(--color-background-hover)] hover:text-[var(--color-text-primary)] disabled:cursor-not-allowed disabled:opacity-45"
                          >
                            <Check className="h-3 w-3" />
                            {allVisiblePricingSelected ? "Décocher" : "Tout cocher"}
                          </button>
                        )}
                        <button
                          type="button"
                          disabled={creatingChangeSheet || selectedVisiblePricingKeys.length === 0}
                          onClick={() => onCreateChangeSheet(
                            selectedVisiblePricingKeys,
                            getSelectedPricingOverrides(selectedVisiblePricingKeys),
                          )}
                          className="inline-flex h-7 items-center gap-1 rounded-md bg-[var(--color-text-primary)] px-2.5 text-[11px] font-semibold text-[var(--color-background-primary)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                          title={selectedVisiblePricingKeys.length === 0 ? t("table.selectVehicleTooltip") : t("table.createSheetTooltip")}
                        >
                          {creatingChangeSheet ? <Loader2 className="h-3 w-3 animate-spin" /> : <ClipboardList className="h-3 w-3" />}
                          Créer une fiche
                          <span className="opacity-70 tabular-nums">· {selectedVisiblePricingKeys.length}</span>
                        </button>
                      </div>
                    </th>
                  </tr>
                )}
                <tr className="sticky top-0">
                  {/* Colonnes sticky : aucune couleur de fond. Au scroll
                      horizontal, on applique un `backdrop-blur` pour flouter
                      ce qui passe en dessous (les prix concurrents) → ils
                      deviennent illisibles, donc visuellement "disparus",
                      sans qu'aucun bloc opaque ne soit ajouté. */}
                  <th className={`sticky left-0 z-30 px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-secondary)] border-b border-[var(--color-border-tertiary)] bg-transparent transition-all duration-150 ${
                    hasScrolledTableLeft ? "backdrop-blur-xl" : ""
                  }`}>
                    {t("table.image")}
                  </th>
                  <th className={`sticky left-[80px] z-30 px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-secondary)] border-b border-[var(--color-border-tertiary)] min-w-[280px] bg-transparent transition-all duration-150 ${
                    hasScrolledTableLeft ? "backdrop-blur-xl" : ""
                  }`}>
                    {t("table.product")}
                  </th>
                  <th className={`sticky left-[360px] z-30 px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-secondary)] border-b border-[var(--color-border-tertiary)] whitespace-nowrap min-w-[120px] bg-transparent transition-all duration-150 ${
                    hasScrolledTableLeft ? "backdrop-blur-xl" : ""
                  }`}>
                    {t("table.refPrice")}
                  </th>
                  {showPricingRecommendations ? (
                    <>
                      <th className="w-[58px] min-w-[58px] px-1 py-2.5 text-center border-b border-[var(--color-border-tertiary)]">
                        <div className="flex flex-col items-center gap-1">
                          {onSetPricingSelection && visiblePricingKeys.length > 0 && (
                            <button
                              type="button"
                              onClick={() => onSetPricingSelection(visiblePricingKeys, !allVisiblePricingSelected)}
                              className={cn(
                                "flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-2 bg-white shadow-sm transition",
                                allVisiblePricingSelected
                                  ? "border-emerald-500 bg-emerald-500 text-white"
                                  : selectedVisiblePricingKeys.length > 0
                                    ? "border-emerald-500 bg-emerald-500 text-white"
                                    : "border-slate-400 text-transparent hover:border-emerald-500 dark:border-slate-500 dark:bg-slate-950/60",
                              )}
                              title={allVisiblePricingSelected ? "Tout décocher" : "Tout cocher"}
                              aria-label={allVisiblePricingSelected ? "Tout décocher" : "Tout cocher"}
                            >
                              {allVisiblePricingSelected ? (
                                <Check className="h-3.5 w-3.5" strokeWidth={3} />
                              ) : selectedVisiblePricingKeys.length > 0 ? (
                                <span className="h-0.5 w-2.5 rounded-full bg-white" />
                              ) : null}
                            </button>
                          )}
                          <span className="truncate text-[11px] font-semibold text-[var(--color-text-primary)]">
                            Fiche
                          </span>
                        </div>
                      </th>
                      <th className="w-[182px] min-w-[182px] px-2 py-2.5 text-center border-b border-[var(--color-border-tertiary)]">
                        <span className="truncate block text-[11px] font-semibold text-[var(--color-text-primary)]">
                          Prix recommandé
                        </span>
                      </th>
                    </>
                  ) : (
                    cols.map(c => (
                      <th key={c.id} className="px-3 py-2.5 text-right border-b border-[var(--color-border-tertiary)] min-w-[130px]" title={c.label}>
                        <span className="truncate block max-w-[130px] text-[11px] font-semibold text-[var(--color-text-primary)]">{c.label}</span>
                      </th>
                    ))
                  )}
                </tr>
              </thead>
              <tbody>
                {data.length === 0 && (
                  <tr>
                    <td colSpan={3 + dynamicColumnCount} className="px-3 py-4 text-center text-sm text-[var(--color-text-secondary)]">
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
                        <td colSpan={3 + dynamicColumnCount} className="px-4 py-1.5 border-b border-[var(--color-border-tertiary)]">
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
                  const recommendation = pricingRecommendations.get(p.productKey)
                  return (
                    <React.Fragment key={idx}>
                      <tr
                        // Hover défini, mais neutre : le vert donnait une
                        // impression de statut/validation sur toute la ligne.
                        // Ici on garde seulement une légère lecture active.
                        className="group border-b border-[var(--color-border-tertiary)] hover:bg-slate-900/[0.035] dark:hover:bg-white/[0.04] hover:shadow-[inset_3px_0_0_0_rgb(15_23_42/0.22)] transition-all duration-150"
                      >
                        <td className={`sticky left-0 z-20 bg-transparent group-hover:bg-slate-900/[0.035] dark:group-hover:bg-white/[0.04] transition-all duration-150 px-3 py-2 align-middle ${
                          hasScrolledTableLeft ? "backdrop-blur-xl" : ""
                        }`}>
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
                        <td className={`sticky left-[80px] z-20 bg-transparent group-hover:bg-slate-900/[0.035] dark:group-hover:bg-white/[0.04] transition-all duration-150 px-3 py-2 min-w-[280px] ${
                          hasScrolledTableLeft ? "backdrop-blur-xl" : ""
                        }`}>
                          <div className="flex flex-col gap-0.5">
                            {/* Nom du produit = info principale (font-semibold) */}
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

                            {/* Métadonnées caption — état + marque + ref. Toutes au
                                même poids visuel discret pour ne plus voler la
                                vedette au nom (haut) ni au prix (cellule voisine).
                                Le badge état n'a plus de fond saturé : seul un
                                point coloré garde le signal couleur. */}
                            {(() => {
                              const marque = extractMarque(p.marque || "")
                              const rawName = (p.displayName || p.name || "").toLowerCase()
                              // On n'affiche la marque en caption que si elle
                              // n'est pas déjà visible dans le nom — sinon c'est
                              // pure redondance ("APRILIA" + "Aprilia TUONO 660").
                              const showMarque = marque && !rawName.startsWith(marque.toLowerCase())
                              const items: React.ReactNode[] = []
                              items.push(
                                <EtatBadge key="etat" etat={p.etat} sourceCategorie={p.sourceCategorie} />,
                              )
                              if (showMarque) {
                                items.push(
                                  <span key="marque" className="text-[10px] font-medium uppercase tracking-wider text-[var(--color-text-tertiary)]">
                                    {marque}
                                  </span>,
                                )
                              }
                              if (p.inventaire) {
                                items.push(
                                  <span key="inv" className="text-[10px] text-[var(--color-text-tertiary)] tabular-nums">
                                    #{p.inventaire}
                                  </span>,
                                )
                              }
                              if (items.length === 0) return null
                              return (
                                <div className="flex items-center gap-2 flex-wrap mt-0.5">
                                  {items.map((node, i) => (
                                    <React.Fragment key={i}>
                                      {i > 0 && <span className="text-[var(--color-border-secondary)] text-[10px]">·</span>}
                                      {node}
                                    </React.Fragment>
                                  ))}
                                </div>
                              )
                            })()}
                          </div>
                        </td>
                        <td className={`sticky left-[360px] z-20 bg-transparent group-hover:bg-slate-900/[0.035] dark:group-hover:bg-white/[0.04] transition-all duration-150 px-3 py-2 min-w-[120px] ${
                          hasScrolledTableLeft ? "backdrop-blur-xl" : ""
                        }`}>
                          {/* Le prix est seul dans sa cellule. Plus de badge
                              état accolé qui écrasait l'œil. tabular-nums pour
                              aligner verticalement, whitespace-nowrap pour
                              empêcher le wrap sur les prix à 5+ chiffres. */}
                          <span className="block text-right text-sm font-semibold text-[var(--color-text-primary)] tabular-nums whitespace-nowrap">
                            {p.reference !== null ? (
                              p.referenceUrl ? (
                                <a href={p.referenceUrl} target="_blank" rel="noopener noreferrer" className="hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors">
                                  {p.reference.toFixed(0)} $
                                </a>
                              ) : (
                                `${p.reference.toFixed(0)} $`
                              )
                            ) : <span className="text-[var(--color-text-tertiary)] font-normal">—</span>}
                          </span>
                        </td>
                        {showPricingRecommendations ? (
                          <>
                            <td className="w-[58px] min-w-[58px] px-1 py-2 text-center text-sm text-[var(--color-text-primary)]">
                              {recommendation && onTogglePricingSelection ? (
                                <button
                                  type="button"
                                  onClick={() => onTogglePricingSelection(recommendation.productKey)}
                                  className={cn(
                                    "mx-auto flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2 bg-white shadow-sm transition",
                                    "focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-1",
                                    selectedPricingKeys?.has(recommendation.productKey)
                                      ? "border-emerald-500 bg-emerald-500 text-white"
                                      : "border-slate-400 text-transparent hover:border-emerald-500 hover:bg-emerald-50 dark:border-slate-500 dark:bg-slate-950/60 dark:hover:border-emerald-400 dark:hover:bg-emerald-500/10",
                                  )}
                                  title={selectedPricingKeys?.has(recommendation.productKey) ? "Retirer de la fiche" : "Inclure dans la fiche"}
                                  aria-label={selectedPricingKeys?.has(recommendation.productKey) ? "Retirer de la fiche" : "Inclure dans la fiche"}
                                >
                                  {selectedPricingKeys?.has(recommendation.productKey) && <Check className="h-4 w-4" strokeWidth={3} />}
                                </button>
                              ) : (
                                <span className="text-[var(--color-text-secondary)]">—</span>
                              )}
                            </td>
                            <td className="w-[182px] min-w-[182px] px-2 py-2 text-center text-sm text-[var(--color-text-primary)]">
                              {recommendation ? (
                                (() => {
                                  const editedValue = editedPricingPrices[recommendation.productKey]
                                  const editedPrice = editedValue != null ? parseEditablePrice(editedValue) : null
                                  const displayedPrice = editedPrice ?? recommendation.recommendedPrice
                                  const displayedDifference = displayedPrice - recommendation.oldPrice
                                  const hasOverride = editedPrice !== null && editedPrice !== Math.round(recommendation.recommendedPrice)
                                  return (
                                    <div className="flex flex-col items-center gap-1">
                                      <div className="relative">
                                        <input
                                          type="text"
                                          inputMode="numeric"
                                          value={editedValue ?? formatEditablePrice(recommendation.recommendedPrice)}
                                          onChange={(event) => updateEditedPricingPrice(recommendation.productKey, event.target.value)}
                                          onBlur={() => commitEditedPricingPrice(recommendation.productKey, recommendation.recommendedPrice)}
                                          aria-label={`Modifier le prix recommandé pour ${recommendation.productName}`}
                                          className={cn(
                                            "h-8 w-[112px] rounded-lg border bg-[var(--color-background-primary)] pr-6 pl-2 text-center text-sm font-semibold tabular-nums",
                                            "border-[var(--color-border-secondary)] text-[var(--color-text-primary)] shadow-sm",
                                            "focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent",
                                          )}
                                        />
                                        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs font-semibold text-[var(--color-text-tertiary)]">
                                          $
                                        </span>
                                      </div>
                                      <span className={`text-xs font-semibold ${displayedDifference < 0 ? "text-red-600 dark:text-red-400" : displayedDifference > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-[var(--color-text-secondary)]"}`}>
                                        {displayedDifference > 0 ? "+" : ""}{displayedDifference.toFixed(0)} $
                                      </span>
                                      <div className="flex items-center justify-center gap-1.5">
                                        <span className="text-[10px] text-[var(--color-text-secondary)]">{recommendation.strategyLabel}</span>
                                        {hasOverride && (
                                          <button
                                            type="button"
                                            onClick={() => resetEditedPricingPrice(recommendation.productKey)}
                                            className="inline-flex items-center gap-0.5 rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 hover:bg-amber-100 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300"
                                            title="Revenir au prix calculé automatiquement"
                                          >
                                            <X className="h-2.5 w-2.5" />
                                            modifié
                                          </button>
                                        )}
                                      </div>
                                    </div>
                                  )
                                })()
                              ) : (
                                <span className="text-[var(--color-text-secondary)]">—</span>
                              )}
                            </td>
                          </>
                        ) : (
                          p.prices.map(priceEntry => (
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
                          ))
                        )}
                      </tr>
                      {detailRows.has(idx) && hasDetails && (
                        <tr className="bg-[var(--color-background-secondary)]/40 border-b border-[var(--color-border-tertiary)]">
                          <td colSpan={3 + dynamicColumnCount} className="px-4 py-2.5">
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
                          <td colSpan={3 + dynamicColumnCount} className="px-4 py-2">
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
      {/* ── Toolbar v3 ──
           Layout horizontal en 1 ligne :
              [🔍 Recherche large flex-1]  [● Compétitif] [● Non compétitif]
                   [▦ Regrouper par modèle]  [$ Stratégie pricing]  [⋯]

           Changements vs v2 :
             - Recherche `flex-1` (s'étire jusqu'à la zone des actions à
               droite, qui correspond visuellement à la fin de la colonne
               PRIX RÉFÉRENCE)
             - Compétitif/Non-compétitif passent en pills colorées PLEINES
               (border + fond pâle) au lieu du texte simple — beaucoup
               plus visibles
             - Regrouper par modèle SORT du menu overflow et passe à côté
               de Stratégie pricing (les deux configurent le mode de
               présentation des données)
             - Le menu ⋯ s'élargit (min-w-[280px]), section Affichage allégée
               (juste Couleurs + MatchMode), section Export complète,
               animation fade-in slide-in-from-top-2 à l'ouverture */}
      <div className="flex items-center gap-2 py-2.5">
        {/* Recherche — bornée à ~460px pour s'arrêter visuellement à la
            fin de la colonne PRIX RÉFÉRENCE du tableau (Image 80 + Produit
            280 + Prix 120 ≈ 480px, on enlève un peu pour les paddings).
            `flex-1` lui permet quand même de rétrécir si l'écran est petit. */}
        {onSearchChange && (
          <div className="relative flex-1 max-w-[480px] min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--color-text-tertiary)]" />
            <input
              type="text"
              value={searchQuery || ""}
              onChange={e => onSearchChange(e.target.value)}
              placeholder={searchPlaceholder || t("dash.searchPlaceholder")}
              className="w-full h-9 pl-9 pr-8 rounded-lg border border-[var(--color-border-tertiary)] bg-[var(--color-background-primary)] text-sm text-[var(--color-text-primary)] placeholder-[var(--color-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500/40 transition shadow-sm"
            />
            {searchQuery && (
              <button type="button" onClick={() => onSearchChange("")} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-background-hover)] transition">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        )}

        {/* Spacer flexible — comble l'espace entre la recherche bornée et
            les filtres compétitivité, pour que ces derniers ne collent pas
            à la recherche. */}
        <div className="flex-1" />

        {/* Filtres compétitivité — pills colorées PLEINES (avec border et
            fond pâle) pour ressortir clairement. C'est l'action de tri la
            plus utilisée dans un outil de pricing. */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => setCompFilter(prev => prev === 'competitive' ? 'all' : 'competitive')}
            className={`inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-xs font-medium transition border ${
              compFilter === 'competitive'
                ? 'text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-500/15 border-emerald-200 dark:border-emerald-500/40 shadow-sm shadow-emerald-500/10'
                : 'text-emerald-700/80 dark:text-emerald-400/80 bg-emerald-50/40 dark:bg-emerald-500/[0.06] border-emerald-200/60 dark:border-emerald-500/20 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 hover:border-emerald-200 dark:hover:border-emerald-500/30'
            }`}
          >
            <span className={`h-2 w-2 rounded-full ${compFilter === 'competitive' ? 'bg-emerald-500 ring-2 ring-emerald-500/20' : 'bg-emerald-500'}`} />
            {t("table.filterCompetitive")}
          </button>
          <button
            type="button"
            onClick={() => setCompFilter(prev => prev === 'non-competitive' ? 'all' : 'non-competitive')}
            className={`inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-xs font-medium transition border ${
              compFilter === 'non-competitive'
                ? 'text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-500/15 border-red-200 dark:border-red-500/40 shadow-sm shadow-red-500/10'
                : 'text-red-700/80 dark:text-red-400/80 bg-red-50/40 dark:bg-red-500/[0.06] border-red-200/60 dark:border-red-500/20 hover:bg-red-50 dark:hover:bg-red-500/10 hover:border-red-200 dark:hover:border-red-500/30'
            }`}
          >
            <span className={`h-2 w-2 rounded-full ${compFilter === 'non-competitive' ? 'bg-red-500 ring-2 ring-red-500/20' : 'bg-red-500'}`} />
            {t("table.filterNotCompetitive")}
          </button>
        </div>

        {/* Séparateur visuel entre filtres et actions de mode */}
        <div className="w-px h-6 bg-[var(--color-border-tertiary)] shrink-0" />

        {/* Actions à droite : Regrouper, Stratégie, ⋯ */}
        <div className="flex items-center gap-1 shrink-0">
          {/* Regrouper par modèle — sorti du menu overflow car
              fonctionnellement proche de "Stratégie pricing" (les deux
              changent la présentation des données). */}
          <button
            type="button"
            onClick={() => {
              setGroupByFamily(prev => {
                const next = !prev
                if (!next && onMatchModeChange) onMatchModeChange('exact')
                return next
              })
            }}
            className={`inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-xs font-medium transition ${
              groupByFamily
                ? 'text-[var(--color-text-primary)] bg-[var(--color-background-secondary)] border border-[var(--color-border-secondary)]'
                : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-background-hover)] border border-transparent'
            }`}
          >
            <LayoutGrid className="h-3.5 w-3.5" />
            <span className="hidden md:inline">{groupByFamily ? t("table.ungroupModels") : t("table.groupModels")}</span>
          </button>

          {/* Stratégie pricing */}
          {pricingSettings && onPricingEnabledChange && (
            <button
              type="button"
              onClick={() => onPricingEnabledChange(!pricingEnabled)}
              className={`inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-xs font-medium transition ${
                pricingEnabled
                  ? "text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-500/15 border border-emerald-200 dark:border-emerald-500/40"
                  : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-background-hover)] border border-transparent"
              }`}
            >
              <CircleDollarSign className="h-3.5 w-3.5" />
              <span className="hidden md:inline">{t("table.applyPricingStrategy")}</span>
            </button>
          )}

          {/* Menu overflow ⋯ : Affichage (couleurs + match mode) + Export */}
          <div ref={overflowMenuRef} className="relative">
            <button
              type="button"
              onClick={() => setShowOverflowMenu(v => !v)}
              className={`inline-flex items-center justify-center h-9 w-9 rounded-lg transition border ${
                showOverflowMenu
                  ? 'text-[var(--color-text-primary)] bg-[var(--color-background-secondary)] border-[var(--color-border-secondary)]'
                  : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-background-hover)] border-transparent'
              }`}
              title={t("dash.actions") || "Plus d'actions"}
              aria-label={t("dash.actions") || "Plus d'actions"}
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>

            {showOverflowMenu && (
              <div
                className="absolute right-0 top-full mt-2 z-30 min-w-[300px] rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] shadow-xl shadow-black/10 dark:shadow-black/40 py-1.5 origin-top-right animate-in fade-in-0 zoom-in-95 slide-in-from-top-1 duration-150"
              >
                {/* Section Affichage */}
                <div className="px-3.5 py-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)]">
                  {t("dash.display") || "Affichage"}
                </div>
                {onToggleColors && (
                  <button
                    type="button"
                    onClick={() => { onToggleColors(); }}
                    className="w-full flex items-center justify-between gap-3 px-3.5 py-2 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-background-hover)] transition"
                  >
                    <span className="flex items-center gap-2.5">
                      <Palette className="h-4 w-4" />
                      {stripColorsFromDisplay ? (showColorsLabel || t("table.showColorsShort")) : (hideColorsLabel || t("table.hideColorsShort"))}
                    </span>
                    {stripColorsFromDisplay && <Check className="h-3.5 w-3.5 text-emerald-500" />}
                  </button>
                )}
                {groupByFamily && onMatchModeChange && (
                  <div className="px-3.5 py-2">
                    <label className="flex items-center justify-between gap-2 text-sm text-[var(--color-text-secondary)]">
                      <span className="flex items-center gap-2.5">
                        <LayoutGrid className="h-4 w-4" />
                        {t("config.matchMode.label") || "Mode regroupement"}
                      </span>
                      <select
                        value={matchMode}
                        onChange={(e) => onMatchModeChange(e.target.value)}
                        className="h-7 text-xs pl-2 pr-7 rounded-md border border-[var(--color-border-tertiary)] bg-[var(--color-background-primary)] text-[var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500/40"
                      >
                        <option value="exact">{t("config.matchMode.exact")}</option>
                        <option value="base">{t("config.matchMode.base")}</option>
                        <option value="no_year">{t("config.matchMode.no_year")}</option>
                        <option value="flexible">{t("config.matchMode.flexible")}</option>
                      </select>
                    </label>
                  </div>
                )}

                <div className="my-1.5 border-t border-[var(--color-border-tertiary)]" />

                {/* Section Export */}
                <div className="px-3.5 py-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)]">
                  {t("dash.export") || "Export"}
                </div>
                <button
                  type="button"
                  onClick={() => { handleExportExcel(); setShowOverflowMenu(false) }}
                  disabled={tableData.length === 0}
                  className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-background-hover)] transition disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                >
                  <FileSpreadsheet className="h-4 w-4" />
                  Excel
                </button>
                <button
                  type="button"
                  onClick={() => { handlePrint(); setShowOverflowMenu(false) }}
                  disabled={tableData.length === 0}
                  className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-background-hover)] transition disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                >
                  <Printer className="h-4 w-4" />
                  {t("table.print")}
                </button>
                <button
                  type="button"
                  onClick={() => { setShareResult(null); setShowShareModal(true); setShowOverflowMenu(false) }}
                  disabled={tableData.length === 0}
                  className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-background-hover)] transition disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                >
                  <Mail className="h-4 w-4" />
                  {t("table.share")}
                </button>
              </div>
            )}
          </div>
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
