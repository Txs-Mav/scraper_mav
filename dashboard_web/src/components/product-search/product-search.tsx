"use client"

import { useState, useCallback, useEffect, useMemo } from "react"
import {
  Search, Loader2, ExternalLink, Globe, ShoppingBag,
  AlertCircle, CheckCircle2, Clock, Info, Settings2, X, ChevronDown,
  Briefcase, Eye, Check, SlidersHorizontal, Gauge, Lock,
} from "lucide-react"
import { cn } from "@/lib/utils"
import CategoryPicker from "./category-picker"
import BusinessTypeOnboardingModal from "./business-type-modal"
import EvaluationCard from "./evaluation-card"
import type { SearchResult, AdapterToggles, SearchHit } from "./types"
import { parseEvaluationQuery } from "@/lib/search-evaluation/parse-query"
import { scoreHits } from "@/lib/search-evaluation/score-listing"
import type { ScoredHit } from "@/lib/search-evaluation/types"
import { evaluateValue } from "@/lib/search-valuation/evaluate-value"
import {
  buildOptionAliases,
  detectMakeFromQuery,
  optionsForVehicle,
  OPTION_GROUP_LABELS,
  type OptionGroup,
  type VehicleOption,
} from "@/lib/search-valuation/vehicle-options"
import { mileageUnitForCategory } from "@/lib/search-valuation/depreciation-rates"
import { toast } from "sonner"
import { useAuth } from "@/contexts/auth-context"
import { useLanguage } from "@/contexts/language-context"
import { isDevAdminUserPublic } from "@/lib/auth/admin"
import {
  BUSINESS_TYPES,
  BUSINESS_TYPE_DEFAULT_CATEGORY,
  getAllowedCategoryPaths,
  getDefaultCategoryPathForMulti,
  parseBusinessTypes,
  serializeBusinessTypes,
  type BusinessType,
} from "@/lib/account-navigation"

const STORAGE_KEY = "product-search-state-v2"
const ONBOARDING_FLAG = "product-search-bt-onboarded-v1"
const ADMIN_VIEW_AS_KEY = "product-search-admin-view-as"

const BT_LABEL_KEYS: Record<BusinessType, "register.bt.recreationalVehicles" | "register.bt.automotive" | "register.bt.marine" | "register.bt.sportsOutdoor" | "register.bt.fashion" | "register.bt.electronics" | "register.bt.other"> = {
  recreational_vehicles: "register.bt.recreationalVehicles",
  automotive: "register.bt.automotive",
  marine: "register.bt.marine",
  sports_outdoor: "register.bt.sportsOutdoor",
  fashion: "register.bt.fashion",
  electronics: "register.bt.electronics",
  other: "register.bt.other",
}

interface PersistedState {
  query: string
  category: string | null
  adapters: AdapterToggles
  vehicleSpecs: VehicleSpecs
  evaluatorEnabled: boolean
}

type VehicleConditionInput = "" | "new" | "used"

interface VehicleSpecs {
  condition: VehicleConditionInput
  mileage: string
  askingPrice: string
  /** Liste de clés d'options sélectionnées (cf. `lib/search-valuation/vehicle-options.ts`). */
  options: string[]
}

const DEFAULT_STATE: PersistedState = {
  query: "",
  category: null,
  adapters: {
    // Sources verrouillées tant qu'elles n'ont pas été connectées dans le
    // dashboard admin (amazon, bestbuy, walmart, costco, cycletrader). On
    // les force à false par défaut pour éviter qu'un ancien state local
    // ne réactive silencieusement une source désormais en lecture seule.
    amazon: false,
    bestbuy: false,
    dedicated: true,
    ebay: true,
    kijiji: false,
    walmart: false,
    costco: false,
    lespac: false,
    autotrader: false,
    cycletrader: false,
    facebook: false,
    shopify: [],
    genericDealers: [],
    includeMyCompetitors: false,
  },
  vehicleSpecs: {
    condition: "",
    mileage: "",
    askingPrice: "",
    options: [],
  },
  evaluatorEnabled: false,
}

/**
 * L'évaluation de valeur n'a de sens que pour les vraies catégories de
 * véhicules (auto, moto, vtt, motoneige, sxs, nautique, scooter, remorque,
 * électrique). Pour les accessoires, pièces ou produits e-commerce, on
 * masque le bloc « Véhicule à évaluer » et la carte de valuation.
 */
function isVehicleCategory(path: string | null | undefined): boolean {
  if (!path) return false
  return path === "vehicule" || path.startsWith("vehicule.")
}

interface SourceMeta {
  key: keyof Omit<AdapterToggles, "shopify" | "genericDealers" | "includeMyCompetitors">
  label: string
  hint: string
  group: "instant" | "marketplace" | "vehicle" | "api"
  disabled?: boolean
  badge?: string
}

// Note : amazon, bestbuy, walmart, costco et cycletrader sont marquées
// `disabled` (cadenas) tant que la source n'a pas été configurée dans le
// dashboard admin. Elles seront automatiquement réactivées dès que
// l'admin aura branché le scraper correspondant — pour l'instant on
// montre seulement le placeholder verrouillé pour donner la liste cible.
const SOURCES: SourceMeta[] = [
  { key: "dedicated", label: "Concessionnaires", hint: "Tes 20 scrapers dédiés (motoplex, moto-ducharme, db-moto…)", group: "instant" },
  { key: "amazon", label: "Amazon.ca", hint: "À connecter dans le dashboard admin", group: "instant", disabled: true, badge: "À connecter" },
  { key: "ebay", label: "eBay", hint: "API officielle (EBAY_CLIENT_ID/SECRET requis)", group: "instant" },
  { key: "bestbuy", label: "Best Buy", hint: "À connecter dans le dashboard admin", group: "marketplace", disabled: true, badge: "À connecter" },
  { key: "walmart", label: "Walmart", hint: "À connecter dans le dashboard admin", group: "marketplace", disabled: true, badge: "À connecter" },
  { key: "costco", label: "Costco", hint: "À connecter dans le dashboard admin", group: "marketplace", disabled: true, badge: "À connecter" },
  { key: "kijiji", label: "Kijiji", hint: "Petites annonces (~8s)", group: "marketplace" },
  { key: "lespac", label: "LesPAC", hint: "Petites annonces QC (~8s)", group: "marketplace" },
  { key: "autotrader", label: "AutoTrader", hint: "Voitures occasion + neuves (~12s)", group: "vehicle" },
  { key: "cycletrader", label: "CycleTrader", hint: "À connecter dans le dashboard admin", group: "vehicle", disabled: true, badge: "À connecter" },
  { key: "facebook", label: "Facebook Marketplace", hint: "Disponible bientôt", group: "api", disabled: true, badge: "Bientôt" },
]

const QUERY_COMPLETIONS = [
  "TC 85 19/16 2026",
  "TC 85 17/14 2025",
  "Husqvarna TC 85 19/16 2026",
  "Husqvarna TC 85 17/14 2025",
  "Husqvarna TC 65 2025",
  "Husqvarna TC 300 Heritage 2025",
  "KTM 150 SX 2026",
  "KTM 250 SX 2026",
  "KTM 300 XC-W 2026",
  "Kawasaki KX 85 2026",
  "Yamaha YZ 85 2026",
  "Ski-Doo Summit 850",
  "Can-Am Outlander 850",
  "iPhone 15 Pro 256GB",
  "casque Bell moto",
]
const QUERY_COMPLETION_HISTORY_KEY = "product-search-query-completions-v1"

function normalizeCompletionText(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[-_/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function getQueryPrediction(query: string): string | null {
  const trimmed = query.trimStart()
  if (trimmed.length < 2) return null
  const normalized = normalizeCompletionText(trimmed)
  if (!normalized) return null

  let history: string[] = []
  if (typeof window !== "undefined") {
    try {
      const raw = window.localStorage.getItem(QUERY_COMPLETION_HISTORY_KEY)
      const parsed = raw ? JSON.parse(raw) : []
      history = Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : []
    } catch { /* ignore */ }
  }

  const candidates = Array.from(new Set([...history, ...QUERY_COMPLETIONS]))
  const match = candidates
    .filter((candidate) => {
      const c = normalizeCompletionText(candidate)
      return c.startsWith(normalized) && c.length > normalized.length
    })
    .sort((a, b) => a.length - b.length)[0]

  if (!match) return null
  return query.startsWith(" ") ? `${query.slice(0, query.length - trimmed.length)}${match}` : match
}

function rememberQuerySuggestions(query: string, hits: SearchHit[]) {
  if (typeof window === "undefined") return
  const suggestions = [
    query.trim(),
    ...hits.map((hit) => hit.name).filter(Boolean),
  ].filter((value) => value.length >= 3)

  if (suggestions.length === 0) return
  try {
    const raw = window.localStorage.getItem(QUERY_COMPLETION_HISTORY_KEY)
    const existing = raw ? JSON.parse(raw) : []
    const merged = Array.from(new Set([
      ...suggestions,
      ...(Array.isArray(existing) ? existing : []),
    ])).slice(0, 50)
    window.localStorage.setItem(QUERY_COMPLETION_HISTORY_KEY, JSON.stringify(merged))
  } catch { /* ignore */ }
}

function buildValuationQueryText(
  query: string,
  specs: VehicleSpecs,
  categoryPath: string | null,
): string {
  const parts: string[] = []
  if (specs.condition === "new") parts.push("neuf")
  if (specs.condition === "used") parts.push("usagé")
  // Le suffixe d'usage moteur dépend de la catégorie : km (auto/moto/scooter/
  // motoneige) ou h (bateau/VTT/SxS). `parseValuationQuery` reconnaît les deux.
  if (specs.mileage.trim()) {
    const unit = mileageUnitForCategory(categoryPath)
    parts.push(`${specs.mileage.trim()} ${unit}`)
  }
  if (specs.askingPrice.trim()) parts.push(`${specs.askingPrice.trim()} $`)
  // Le trim/finition (Lariat, XLT, Platinum…) n'est plus un champ dédié :
  // l'utilisateur le tape directement dans la barre de recherche. Le parseur
  // ci-dessous le détectera comme `variantHint` à partir de `query.trim()` —
  // exactement comme s'il était passé séparément, mais sans duplication.
  // Options sélectionnées par chips → on injecte leurs aliases pour que
  // `parseValuationQuery` les détecte comme variantes (premium $).
  const optionAliases = buildOptionAliases(specs.options)
  if (optionAliases) parts.push(optionAliases)
  parts.push(query.trim())
  return parts.filter(Boolean).join(" ")
}

export default function ProductSearch() {
  const { user } = useAuth()
  const { t } = useLanguage()
  const isAdmin = isDevAdminUserPublic(user)

  const [state, setState] = useState<PersistedState>(DEFAULT_STATE)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<SearchResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showSources, setShowSources] = useState(false)
  const [hasHydrated, setHasHydrated] = useState(false)
  const [showOnboarding, setShowOnboarding] = useState(false)
  /**
   * Override admin : permet aux dev admins de basculer la "vue" sur un ou
   * plusieurs business_types sans modifier leur compte. Persiste localement
   * uniquement (clé localStorage).
   */
  const [adminViewAs, setAdminViewAs] = useState<BusinessType[]>([])

  // Les business_types effectifs sont :
  //   - pour un admin : la sélection "view as" si non vide, sinon celle du user
  //   - pour les autres : ceux du user (parsés depuis la string DB)
  const effectiveBusinessTypes: BusinessType[] = useMemo(() => {
    if (isAdmin && adminViewAs.length > 0) return adminViewAs
    return parseBusinessTypes(user?.business_type ?? null)
  }, [isAdmin, adminViewAs, user?.business_type])

  // Pour pré-sélection catégorie : seulement utile si exactement 1 type
  const defaultCategoryPath = useMemo(
    () => getDefaultCategoryPathForMulti(effectiveBusinessTypes),
    [effectiveBusinessTypes],
  )

  // Liste blanche des catégories à afficher dans le picker (`null` = pas de filtre).
  const allowedCategoryPaths = useMemo(
    () => getAllowedCategoryPaths(effectiveBusinessTypes),
    [effectiveBusinessTypes],
  )

  // Hydratation localStorage (formulaire)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<PersistedState>
        // Migrations rétro-compatibles :
        //   - `options` était autrefois une string libre → on le ramène à un
        //     tableau vide pour éviter un crash sur `.map`.
        //   - `trim` était un champ dédié, retiré au profit d'une saisie
        //     directe dans la barre de recherche. On le supprime du payload
        //     hydraté pour rester compatible avec d'anciens localStorage.
        let migratedSpecs: VehicleSpecs | undefined
        if (parsed.vehicleSpecs) {
          const { options, ...rest } = parsed.vehicleSpecs as VehicleSpecs & {
            trim?: string
          }
          delete (rest as Record<string, unknown>).trim
          migratedSpecs = {
            ...rest,
            options: Array.isArray(options) ? options : [],
          }
        }
        setState((prev) => ({
          ...prev,
          ...parsed,
          adapters: {
            ...prev.adapters,
            ...(parsed.adapters || {}),
            // Sources désactivées tant qu'elles ne sont pas branchées
            // dans le dashboard admin : on force false même si un ancien
            // localStorage les avait à true.
            amazon: false,
            bestbuy: false,
            walmart: false,
            costco: false,
            cycletrader: false,
            facebook: false,
            // Les inputs URL libres (Shopify, concessionnaires génériques)
            // ont été retirés de l'UI : on les remet à zéro côté state.
            shopify: [],
            genericDealers: [],
            includeMyCompetitors: false,
          },
          vehicleSpecs: { ...prev.vehicleSpecs, ...(migratedSpecs || {}) },
        }))
      }
      const viewAs = localStorage.getItem(ADMIN_VIEW_AS_KEY)
      if (viewAs) {
        const parsedView = parseBusinessTypes(viewAs)
        if (parsedView.length > 0) setAdminViewAs(parsedView)
      }
    } catch { /* ignore */ }
    setHasHydrated(true)
  }, [])

  // Onboarding business_type : on le montre une seule fois, au premier visit,
  // si l'utilisateur n'a jamais confirmé ses domaines (drapeau localStorage).
  // Les dev admins en sont exemptés (ils ont le selector "view as").
  useEffect(() => {
    if (!hasHydrated || !user || isAdmin) return
    try {
      const flag = localStorage.getItem(ONBOARDING_FLAG)
      if (!flag) setShowOnboarding(true)
    } catch { /* ignore */ }
  }, [hasHydrated, user, isAdmin])

  // Pré-sélection de la catégorie selon les business_types effectifs.
  // Ne s'applique QUE si l'utilisateur n'a pas déjà explicitement choisi une
  // catégorie (pour ne pas écraser sa sélection en cours) ET seulement si
  // un seul domaine est sélectionné (sinon, ambigu).
  useEffect(() => {
    if (!hasHydrated) return
    if (state.category !== null) return
    if (!defaultCategoryPath) return
    setState((s) => (s.category === null ? { ...s, category: defaultCategoryPath } : s))
  }, [hasHydrated, defaultCategoryPath, state.category])

  // Si la catégorie actuellement sélectionnée n'est plus dans le périmètre
  // autorisé par le domaine effectif (changement de domaine, switch admin…),
  // on la remplace par la catégorie par défaut du domaine (ou null).
  useEffect(() => {
    if (!hasHydrated) return
    if (allowedCategoryPaths === null) return // pas de filtre
    if (state.category === null) return
    const inScope = allowedCategoryPaths.some(
      (p) => state.category === p || state.category!.startsWith(p + ".") || p.startsWith(state.category + "."),
    )
    if (!inScope) {
      setState((s) => ({ ...s, category: defaultCategoryPath }))
    }
  }, [hasHydrated, allowedCategoryPaths, state.category, defaultCategoryPath])

  useEffect(() => {
    if (!hasHydrated) return
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    } catch { /* ignore */ }
  }, [state, hasHydrated])

  useEffect(() => {
    if (!hasHydrated || !isAdmin) return
    try {
      const serialized = serializeBusinessTypes(adminViewAs)
      if (serialized) localStorage.setItem(ADMIN_VIEW_AS_KEY, serialized)
      else localStorage.removeItem(ADMIN_VIEW_AS_KEY)
    } catch { /* ignore */ }
  }, [adminViewAs, hasHydrated, isAdmin])

  const handleOnboardingConfirm = useCallback(async (bts: BusinessType[]) => {
    try {
      localStorage.setItem(ONBOARDING_FLAG, "1")
    } catch { /* ignore */ }
    // Si 1 seul domaine sélectionné → on force sa catégorie par défaut.
    // Si 0 ou plusieurs → on laisse "toutes les catégories" (null).
    const newCategory = bts.length === 1 ? BUSINESS_TYPE_DEFAULT_CATEGORY[bts[0]] : null
    setState((s) => ({ ...s, category: newCategory }))
    setShowOnboarding(false)
    toast.success(
      bts.length === 1
        ? "Domaine enregistré — catégorie pré-sélectionnée"
        : `${bts.length} domaines enregistrés`,
    )
  }, [])

  const handleReopenOnboarding = useCallback(() => {
    setShowOnboarding(true)
  }, [])

  const activeCount = useMemo(() => {
    let n = 0
    for (const s of SOURCES) {
      if (!s.disabled && state.adapters[s.key]) n++
    }
    return n
  }, [state.adapters])

  const isVehicleCat = useMemo(
    () => isVehicleCategory(state.category),
    [state.category],
  )

  // L'évaluation est active si l'utilisateur a coché le toggle ET qu'on est
  // dans une catégorie véhicule. Sinon on n'affiche pas le bloc « Véhicule à
  // évaluer » ni la carte de valuation des résultats.
  const evaluatorActive = isVehicleCat && state.evaluatorEnabled

  // Auto-désactive le toggle si on change pour une catégorie non-véhicule
  // (sinon il resterait coché silencieusement avec un effet invisible).
  useEffect(() => {
    if (!isVehicleCat && state.evaluatorEnabled) {
      setState((s) => ({ ...s, evaluatorEnabled: false }))
    }
  }, [isVehicleCat, state.evaluatorEnabled])

  const prediction = useMemo(
    () => getQueryPrediction(state.query),
    [state.query],
  )
  const valuationQueryText = useMemo(
    () => buildValuationQueryText(state.query, state.vehicleSpecs, state.category),
    [state.query, state.vehicleSpecs, state.category],
  )

  const acceptPrediction = useCallback(() => {
    if (!prediction) return
    setState((s) => ({ ...s, query: prediction }))
  }, [prediction])

  // Les panneaux « Sources » et « Évaluer un véhicule » sont mutuellement
  // exclusifs : ouvrir l'un ferme automatiquement l'autre. Évite que les
  // deux panels s'empilent sous la barre de recherche et grossisse la
  // surface au point de pousser les résultats hors vue.
  const toggleSourcesPanel = useCallback(() => {
    setShowSources((prev) => {
      const next = !prev
      if (next) {
        setState((s) => (s.evaluatorEnabled ? { ...s, evaluatorEnabled: false } : s))
      }
      return next
    })
  }, [])

  const toggleEvaluator = useCallback(() => {
    setState((s) => {
      const next = !s.evaluatorEnabled
      if (next) setShowSources(false)
      return { ...s, evaluatorEnabled: next }
    })
  }, [])

  const updateAdapter = useCallback(<K extends keyof AdapterToggles>(
    key: K, value: AdapterToggles[K]
  ) => {
    setState((s) => ({ ...s, adapters: { ...s.adapters, [key]: value } }))
  }, [])

  const toggleAll = useCallback((value: boolean) => {
    setState((s) => {
      const next = { ...s.adapters }
      for (const src of SOURCES) {
        if (!src.disabled) {
          (next as Record<string, unknown>)[src.key] = value
        }
      }
      return { ...s, adapters: next }
    })
  }, [])

  const onSubmit = useCallback(async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!state.query.trim()) {
      toast.error("Tape ce que tu cherches d'abord")
      return
    }
    if (activeCount === 0) {
      toast.error("Active au moins une source de recherche")
      setShowSources(true)
      return
    }

    setLoading(true)
    setError(null)
    setResult(null)
    try {
      // Garde-fou : on force à false toute source marquée `disabled`
      // dans `SOURCES` (cadenas), même si un ancien state local les
      // avait à true. Les inputs Shopify / concessionnaires génériques
      // ont été retirés de l'UI → on envoie systématiquement des listes
      // vides côté API.
      const safeAdapters: AdapterToggles = { ...state.adapters }
      for (const src of SOURCES) {
        if (src.disabled) {
          (safeAdapters as unknown as Record<string, unknown>)[src.key] = false
        }
      }
      const res = await fetch("/api/product-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          query: state.query,
          category: state.category,
          adapters: {
            ...safeAdapters,
            facebook: false,
            shopify: [],
            genericDealers: [],
            includeMyCompetitors: false,
          },
          maxResults: 30,
          minScore: 0.3,
          timeout: 30,
        }),
      })
      const data = await res.json()
      if (res.status === 401) {
        // Session expirée ou cookies absents — on redirige vers /login
        setError(
          "Ta session a expiré. Reconnecte-toi pour relancer ta recherche.",
        )
        toast.error("Session expirée — redirection vers la connexion…")
        setTimeout(() => {
          if (typeof window !== "undefined") {
            window.location.href = `/login?next=${encodeURIComponent("/dashboard/recherche")}`
          }
        }, 1500)
        return
      }
      if (!res.ok) {
        throw new Error(data?.message || data?.error || `HTTP ${res.status}`)
      }
      setResult(data as SearchResult)
      rememberQuerySuggestions(state.query, (data as SearchResult)?.hits || [])
      const total = data?.total ?? 0
      if (total === 0) {
        toast.warning("Aucun résultat — élargis la requête ou ajoute des sources")
      } else {
        toast.success(`${total} résultat${total > 1 ? "s" : ""} en ${data?.elapsed_seconds?.toFixed?.(1) ?? "?"}s`)
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg)
      toast.error(`Erreur : ${msg}`)
    } finally {
      setLoading(false)
    }
  }, [state, activeCount])

  // ── Helper d'affichage : libellé court de la catégorie sélectionnée pour
  // l'afficher inline dans la barre de metadata (pas le breadcrumb complet,
  // juste le dernier segment pour rester compact).
  const categoryShortLabel = useMemo(() => {
    if (!state.category) return null
    const segments = state.category.split(".")
    const last = segments[segments.length - 1]
    return last.charAt(0).toUpperCase() + last.slice(1).replace(/-/g, " ")
  }, [state.category])

  const helperText = state.query.trim()
    ? activeCount === 0
      ? "Active au moins une source pour lancer la recherche."
      : `Prêt à interroger ${activeCount} source${activeCount > 1 ? "s" : ""} en parallèle.`
    : "Tape ta requête puis clique sur Rechercher."

  return (
    <div className="relative z-10 space-y-5 max-w-[1400px] mx-auto">
      <BusinessTypeOnboardingModal
        open={showOnboarding}
        initialValue={user?.business_type ?? null}
        required={
          hasHydrated &&
          typeof window !== "undefined" &&
          !window.localStorage.getItem(ONBOARDING_FLAG)
        }
        onConfirm={handleOnboardingConfirm}
        onDismiss={() => setShowOnboarding(false)}
      />

      {/* ── Header unifié (style Surveillance) ──
          Une seule surface translucide, pas de card pleine. Hiérarchie :
          status pill → H1 (titre de la vue) → metadata inline → actions
          secondaires groupées en segmented control. Le background ambient
          (SurveillanceBackground) gère la séparation avec le reste de la
          page. */}
      <header className="relative z-30 rounded-2xl border border-[var(--color-border-tertiary)]/55 bg-[var(--color-background-primary)]/35 px-5 py-4 shadow-[0_16px_50px_-40px_rgba(15,23,42,0.55)] backdrop-blur-md">
        <div className="flex items-center justify-between gap-5 flex-wrap">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-xs text-[var(--color-text-secondary)]">
              <span className="relative flex h-1.5 w-1.5 shrink-0">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
              </span>
              <span className="font-medium uppercase tracking-wider">
                Recherche multi-sources
              </span>
            </div>

            <h1 className="mt-1.5 text-2xl md:text-[1.8rem] font-semibold text-[var(--color-text-primary)] tracking-tight">
              Recherche par produit
            </h1>

            <p className="mt-1.5 text-sm text-[var(--color-text-secondary)] flex items-center gap-2 flex-wrap">
              <span className="min-w-0">
                Compare en parallèle eBay, Kijiji, AutoTrader et tes concessionnaires.
              </span>
              <span className="opacity-40">·</span>
              <span>
                <span className="tabular-nums font-semibold text-[var(--color-text-primary)]">
                  {activeCount}
                </span>{" "}
                source{activeCount > 1 ? "s" : ""}
              </span>
              {categoryShortLabel && (
                <>
                  <span className="opacity-40">·</span>
                  <span className="truncate">
                    <span className="font-semibold text-[var(--color-text-primary)]">
                      {categoryShortLabel}
                    </span>
                  </span>
                </>
              )}
            </p>
          </div>

          {/* Actions header — catégorie + segmented control unifié pour
              Sources + Évaluateur (si véhicule) + admin/business types.
              La catégorie est désormais ici (et non plus dans la barre
              de recherche) pour libérer l'input et donner plus de poids
              au CTA primaire. */}
          <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
            <CategoryPicker
              value={state.category}
              onChange={(path) => setState((s) => ({ ...s, category: path }))}
              allowedPaths={allowedCategoryPaths}
              triggerClassName={cn(
                "inline-flex items-center gap-2 h-10 px-3.5 rounded-lg border text-sm font-medium transition-colors",
                "border-[var(--color-border-secondary)] bg-[var(--color-background-primary)]/85 backdrop-blur-sm shadow-sm",
                "hover:bg-[var(--color-background-hover)] text-[var(--color-text-primary)]",
              )}
              labelMaxWidthClassName="max-w-[160px] lg:max-w-[220px]"
            />

            <div className="inline-flex items-stretch h-10 rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)]/85 shadow-sm overflow-hidden divide-x divide-[var(--color-border-tertiary)] backdrop-blur-sm">
              <button
                type="button"
                onClick={toggleSourcesPanel}
                className={cn(
                  "inline-flex items-center justify-center gap-2 px-3.5 text-sm font-medium transition-colors",
                  showSources
                    ? "text-[var(--color-text-primary)] bg-[var(--color-background-secondary)]"
                    : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-background-hover)]",
                )}
                title="Configurer les sources interrogées"
              >
                <SlidersHorizontal className="h-5 w-5 shrink-0" strokeWidth={1.75} />
                <span className="hidden sm:inline">Sources</span>
                {activeCount > 0 && (
                  <span className="text-[10px] tabular-nums font-semibold px-1.5 py-0.5 rounded bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
                    {activeCount}
                  </span>
                )}
              </button>

              {isVehicleCat && (
                <button
                  type="button"
                  onClick={toggleEvaluator}
                  className={cn(
                    "inline-flex items-center justify-center gap-2 px-3.5 text-sm font-medium transition-colors",
                    state.evaluatorEnabled
                      ? "text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-500/10"
                      : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-background-hover)]",
                  )}
                  title="Estimer la valeur du véhicule à partir des comparables"
                  aria-pressed={state.evaluatorEnabled}
                >
                  <Gauge className="h-5 w-5 shrink-0" strokeWidth={1.75} />
                  <span className="hidden sm:inline">Évaluer</span>
                </button>
              )}
            </div>

            {isAdmin ? (
              <AdminViewAsPicker value={adminViewAs} onChange={setAdminViewAs} />
            ) : user ? (
              <button
                type="button"
                onClick={handleReopenOnboarding}
                className={cn(
                  "inline-flex items-center justify-center gap-2 h-10 px-3.5 rounded-lg border text-sm font-medium transition-colors",
                  "border-[var(--color-border-secondary)] bg-[var(--color-background-primary)]/85 backdrop-blur-sm",
                  "hover:bg-[var(--color-background-hover)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]",
                )}
                title="Changer mes domaines d'activité"
              >
                <Briefcase className="h-5 w-5 shrink-0" strokeWidth={1.75} />
                <span className="hidden md:inline truncate max-w-[180px]">
                  {effectiveBusinessTypes.length === 0
                    ? "Domaine"
                    : effectiveBusinessTypes.length === 1
                      ? t(BT_LABEL_KEYS[effectiveBusinessTypes[0]])
                      : `${effectiveBusinessTypes.length} domaines`}
                </span>
              </button>
            ) : null}
          </div>
        </div>
      </header>

      {/* ── Panneau de commande unifié ──
          La catégorie est désormais dans le header : cette surface ne
          contient plus que l'input dominant + le CTA primaire pour
          maximiser l'amplitude visuelle de la requête. Texte d'aide +
          chips contextuelles en footer discret. Les panels (sources,
          évaluateur véhicule) s'inscrivent sous cette même surface. */}
      <form
        onSubmit={onSubmit}
        className="relative z-0 rounded-2xl border border-[var(--color-border-tertiary)]/55 bg-[var(--color-background-primary)]/45 shadow-[0_16px_50px_-40px_rgba(15,23,42,0.55)] backdrop-blur-md"
      >
        <div className="p-3 flex items-stretch gap-2.5 flex-wrap md:flex-nowrap">
          <div
            className={cn(
              "relative flex-1 min-w-0 w-full rounded-xl border h-12",
              "border-[var(--color-border-secondary)] bg-[var(--color-background-primary)]",
              "focus-within:ring-2 focus-within:ring-emerald-500 focus-within:border-transparent",
            )}
          >
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--color-text-tertiary)] pointer-events-none z-20" />
            {prediction && prediction.length > state.query.length && (
              <div
                aria-hidden="true"
                className="absolute inset-0 flex items-center pl-11 pr-20 text-[15px] pointer-events-none overflow-hidden z-0"
              >
                <span className="text-transparent whitespace-pre">{state.query}</span>
                <span className="text-[var(--color-text-tertiary)]/70 whitespace-pre truncate">
                  {prediction.slice(state.query.length)}
                </span>
              </div>
            )}
            <input
              type="text"
              value={state.query}
              onChange={(e) => setState((s) => ({ ...s, query: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === "Tab" && prediction && prediction.length > state.query.length) {
                  e.preventDefault()
                  acceptPrediction()
                }
              }}
              placeholder='Ex: "iPhone 15 Pro 256GB", "casque Bell", "Ski-Doo Summit 850"'
              className={cn(
                "relative z-10 w-full h-full pl-11 pr-20 rounded-xl text-[15px] bg-transparent",
                "text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)]",
                "focus:outline-none",
              )}
              disabled={loading}
              autoFocus
            />
            {prediction && prediction.length > state.query.length && !loading && (
              <span className="absolute right-9 top-1/2 -translate-y-1/2 z-20 hidden sm:inline-flex items-center rounded-md border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--color-text-tertiary)]">
                Tab
              </span>
            )}
            {state.query && !loading && (
              <button
                type="button"
                onClick={() => setState((s) => ({ ...s, query: "" }))}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-background-hover)]"
                aria-label="Effacer la recherche"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <button
            type="submit"
            disabled={loading || !state.query.trim()}
            className={cn(
              "inline-flex items-center justify-center gap-2 h-12 px-6 rounded-xl text-sm font-semibold transition-all shrink-0 w-full md:w-auto md:min-w-[160px]",
              "bg-gradient-to-b from-emerald-600 to-emerald-700 text-white",
              "hover:from-emerald-500 hover:to-emerald-600 hover:-translate-y-0.5",
              "shadow-md shadow-emerald-700/25 hover:shadow-lg hover:shadow-emerald-700/30",
              "disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:hover:from-emerald-600 disabled:hover:to-emerald-700",
            )}
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            <span>{loading ? "Recherche…" : "Rechercher"}</span>
          </button>
        </div>

        {/* Footer discret : texte d'aide contextuel + raccourci d'évaluateur
            quand on est en catégorie véhicule (pratique pour les gens qui
            ne regardent pas la barre d'actions du header). */}
        <div className="px-4 py-2.5 border-t border-[var(--color-border-tertiary)]/40 flex items-center justify-between gap-3 flex-wrap">
          <p className="text-[11px] text-[var(--color-text-tertiary)] min-w-0 flex-1">
            {helperText}
          </p>
          {isVehicleCat && (
            <button
              type="button"
              onClick={toggleEvaluator}
              className={cn(
                "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-medium transition-colors shrink-0",
                state.evaluatorEnabled
                  ? "bg-emerald-50 dark:bg-emerald-500/15 border-emerald-300 dark:border-emerald-500/40 text-emerald-700 dark:text-emerald-300"
                  : "bg-[var(--color-background-primary)] border-[var(--color-border-secondary)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:border-[var(--color-text-tertiary)]",
              )}
              aria-pressed={state.evaluatorEnabled}
            >
              <Gauge className="h-3 w-3" />
              <span>
                {state.evaluatorEnabled
                  ? "Évaluation activée"
                  : "Activer l'évaluation véhicule"}
              </span>
            </button>
          )}
        </div>

        {/* Panel "Évaluateur véhicule" — s'inscrit naturellement sous la
            barre de recherche quand activé. Pas de header dédié, pas de
            numéro d'étape : c'est juste une extension contextuelle de la
            requête principale. */}
        {evaluatorActive && (
          <div className="px-4 pb-4 pt-1">
            <VehicleSpecsBox
              specs={state.vehicleSpecs}
              disabled={loading}
              categoryPath={state.category}
              queryText={state.query}
              onChange={(vehicleSpecs) => setState((s) => ({ ...s, vehicleSpecs }))}
            />
          </div>
        )}

        {/* Panel "Sources" — même logique d'extension contextuelle. Reste
            replié par défaut ; s'ouvre via le segmented control du header
            ou via tout autre déclencheur. */}
        {showSources && (
          <div className="px-4 pb-4 pt-1 border-t border-[var(--color-border-tertiary)]/40">
            <SourcesPanel
              adapters={state.adapters}
              onToggle={updateAdapter}
              onToggleAll={toggleAll}
            />
          </div>
        )}
      </form>

      {/* Erreur globale */}
      {error && !loading && (
        <div className="bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 rounded-xl p-4 flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-red-800 dark:text-red-300">Recherche échouée</div>
            <div className="text-sm text-red-700 dark:text-red-400 mt-0.5 break-words">{error}</div>
          </div>
          <button
            onClick={() => setError(null)}
            className="text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-200 shrink-0"
            aria-label="Fermer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {loading && <LoadingSkeleton />}

      {result && !loading && (
        <ResultsView
          result={result}
          queryText={state.query}
          valuationQueryText={valuationQueryText}
          categoryPath={state.category}
          showValuation={evaluatorActive}
        />
      )}

      {!result && !loading && !error && <EmptyState />}
    </div>
  )
}

/**
 * Sélecteur "view as" réservé aux dev admins (multi-sélection).
 * Permet de simuler une combinaison de business_types sans modifier le compte.
 */
function AdminViewAsPicker({
  value,
  onChange,
}: {
  value: BusinessType[]
  onChange: (v: BusinessType[]) => void
}) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)

  const toggle = useCallback(
    (bt: BusinessType) => {
      const has = value.includes(bt)
      onChange(has ? value.filter((x) => x !== bt) : [...value, bt])
    },
    [value, onChange],
  )

  const label =
    value.length === 0
      ? "Vue : toutes"
      : value.length === 1
        ? `Vue : ${t(BT_LABEL_KEYS[value[0]])}`
        : `Vue : ${value.length} domaines`

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors",
          value.length > 0
            ? "border-amber-300 dark:border-amber-500/40 bg-amber-50 dark:bg-amber-500/[0.08] text-amber-800 dark:text-amber-300"
            : "border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] text-[var(--color-text-secondary)] hover:bg-[var(--color-background-hover)]",
        )}
        title="Admin only — simuler un ou plusieurs domaines"
      >
        <Eye className="h-3.5 w-3.5" />
        <span className="hidden sm:inline truncate max-w-[200px]">{label}</span>
        <ChevronDown className={cn("h-3 w-3 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            className={cn(
              "absolute right-0 top-full mt-1.5 z-50 w-64 rounded-xl overflow-hidden shadow-lg",
              "bg-[var(--color-background-primary)] border border-[var(--color-border-secondary)]",
            )}
          >
            <div className="px-3 py-2 text-[10.5px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400 bg-amber-50/60 dark:bg-amber-500/[0.06] border-b border-[var(--color-border-secondary)] flex items-center justify-between gap-1.5">
              <span className="flex items-center gap-1.5">
                <Eye className="h-3 w-3" />
                Admin — simuler une vue
              </span>
              {value.length > 0 && (
                <button
                  type="button"
                  onClick={() => onChange([])}
                  className="text-[10px] font-medium normal-case tracking-normal text-amber-700 dark:text-amber-400 hover:underline"
                >
                  Reset
                </button>
              )}
            </div>
            {BUSINESS_TYPES.map((bt) => {
              const isSelected = value.includes(bt)
              const defaultCat = BUSINESS_TYPE_DEFAULT_CATEGORY[bt]
              return (
                <button
                  key={bt}
                  type="button"
                  onClick={() => toggle(bt)}
                  className={cn(
                    "w-full text-left px-3 py-2 text-xs transition-colors flex items-center gap-2",
                    isSelected
                      ? "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 font-semibold"
                      : "text-[var(--color-text-primary)] hover:bg-[var(--color-background-hover)]",
                  )}
                >
                  <span
                    className={cn(
                      "shrink-0 w-3.5 h-3.5 rounded border flex items-center justify-center transition-colors",
                      isSelected
                        ? "bg-emerald-600 border-emerald-600"
                        : "bg-[var(--color-background-primary)] border-[var(--color-border-secondary)]",
                    )}
                  >
                    {isSelected && <Check className="h-2.5 w-2.5 text-white" strokeWidth={3} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{t(BT_LABEL_KEYS[bt])}</span>
                    {defaultCat && (
                      <span className="block text-[10px] text-[var(--color-text-tertiary)] font-mono truncate">
                        {defaultCat}
                      </span>
                    )}
                  </span>
                </button>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

function SourcesPanel({
  adapters,
  onToggle,
  onToggleAll,
}: {
  adapters: AdapterToggles
  onToggle: <K extends keyof AdapterToggles>(key: K, value: AdapterToggles[K]) => void
  onToggleAll: (value: boolean) => void
}) {
  const groups: Array<{ id: SourceMeta["group"]; title: string; subtitle?: string }> = [
    { id: "instant", title: "Sources rapides", subtitle: "≤ 3s" },
    { id: "marketplace", title: "Marketplaces e-commerce", subtitle: "5-15s" },
    { id: "vehicle", title: "Marketplaces véhicules", subtitle: "10-15s" },
    { id: "api", title: "Sources avec authentification" },
  ]

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-xs text-[var(--color-text-secondary)] min-w-0 flex-1">
          Active uniquement les sources pertinentes pour ton produit.
        </p>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onToggleAll(true)}
            className="text-xs font-medium px-2 py-1 rounded-md text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-500/10"
          >
            Tout activer
          </button>
          <span className="text-[var(--color-text-tertiary)]">·</span>
          <button
            type="button"
            onClick={() => onToggleAll(false)}
            className="text-xs font-medium px-2 py-1 rounded-md text-[var(--color-text-secondary)] hover:bg-[var(--color-background-hover)]"
          >
            Tout désactiver
          </button>
        </div>
      </div>

      {groups.map((group) => {
        const items = SOURCES.filter((s) => s.group === group.id)
        if (items.length === 0) return null
        return (
          <div key={group.id}>
            <div className="flex items-baseline gap-2 mb-2">
              <span className="text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wide">
                {group.title}
              </span>
              {group.subtitle && (
                <span className="text-[10px] text-[var(--color-text-tertiary)]">
                  {group.subtitle}
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {items.map((src) => (
                <SourceChip
                  key={src.key}
                  label={src.label}
                  hint={src.hint}
                  checked={!src.disabled && (adapters[src.key] as boolean)}
                  disabled={src.disabled}
                  badge={src.badge}
                  onChange={(v) => onToggle(src.key, v as AdapterToggles[typeof src.key])}
                />
              ))}
            </div>
          </div>
        )
      })}

      <p className="text-[11px] text-[var(--color-text-tertiary)] border-t border-[var(--color-border-secondary)] pt-3">
        Les sources marquées d&apos;un cadenas seront activables une fois
        connectées dans le dashboard admin.
      </p>
    </div>
  )
}

function SourceChip({
  label,
  checked,
  onChange,
  hint,
  disabled,
  badge,
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
  hint?: string
  disabled?: boolean
  badge?: string
}) {
  return (
    <button
      type="button"
      onClick={() => {
        if (!disabled) onChange(!checked)
      }}
      title={hint}
      disabled={disabled}
      aria-disabled={disabled}
      className={cn(
        "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all",
        checked
          ? "bg-emerald-600 border-emerald-600 text-white shadow-sm shadow-emerald-600/20"
          : "bg-[var(--color-background-primary)] border-[var(--color-border-secondary)] text-[var(--color-text-secondary)] hover:border-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]",
        disabled && "cursor-not-allowed opacity-70 hover:border-[var(--color-border-secondary)] hover:text-[var(--color-text-secondary)]"
      )}
    >
      <span
        className={cn(
          "inline-flex items-center justify-center h-3.5 w-3.5 rounded-full border transition-all",
          checked
            ? "bg-white border-white"
            : "border-current"
        )}
      >
        {checked && <CheckCircle2 className="h-3 w-3 text-emerald-600" />}
      </span>
      {label}
      {disabled && <Lock className="h-3 w-3" aria-hidden="true" />}
      {badge && (
        <span className="ml-0.5 rounded-full bg-[var(--color-background-secondary)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--color-text-tertiary)]">
          {badge}
        </span>
      )}
    </button>
  )
}

function VehicleSpecsBox({
  specs,
  disabled,
  categoryPath,
  queryText,
  onChange,
}: {
  specs: VehicleSpecs
  disabled: boolean
  categoryPath: string | null
  queryText: string
  onChange: (specs: VehicleSpecs) => void
}) {
  const update = (patch: Partial<VehicleSpecs>) => onChange({ ...specs, ...patch })

  const detectedMake = useMemo(() => detectMakeFromQuery(queryText), [queryText])

  // Les options affichées dépendent du chemin de catégorie ET de la marque
  // détectée dans la query. Tant qu'aucune marque n'est tapée, seules les
  // options génériques (cuir, toit, 4x4, AWD, tow package…) sont visibles.
  // Dès que l'utilisateur tape « Ford F-150 » par exemple, les chips des
  // packages 101A-502A, FX4, EcoBoost, PowerBoost… apparaissent en plus.
  const availableOptions = useMemo(
    () => optionsForVehicle(categoryPath, queryText),
    [categoryPath, queryText],
  )

  // L'usage moteur s'exprime en km pour auto/moto/scooter/motoneige et en
  // heures pour bateau/VTT/SxS. On adapte le label, le placeholder et le
  // suffixe injecté dans la valuation query selon la catégorie sélectionnée.
  const mileageUnit = useMemo(
    () => mileageUnitForCategory(categoryPath),
    [categoryPath],
  )
  const mileageLabel = mileageUnit === "h" ? "Heures moteur" : "Kilométrage"
  const mileagePlaceholder = mileageUnit === "h" ? "ex: 250" : "ex: 12 500"

  // Quand l'utilisateur change de marque (ex: passe de "Ford F-150" à
  // "Honda Civic"), on désélectionne les options propres à l'ancienne marque
  // qui ne sont plus disponibles dans la nouvelle liste — sinon on garde des
  // packages 502A "fantômes" qui ne s'appliquent pas à la nouvelle requête.
  useEffect(() => {
    if (specs.options.length === 0) return
    const validKeys = new Set(availableOptions.map((o) => o.key))
    const filtered = specs.options.filter((k) => validKeys.has(k))
    if (filtered.length !== specs.options.length) {
      update({ options: filtered })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableOptions])

  const groupedOptions = useMemo(() => {
    const groups: Record<OptionGroup, VehicleOption[]> = {
      engine: [],
      package: [],
      drivetrain: [],
      equipment: [],
    }
    for (const opt of availableOptions) {
      groups[opt.group].push(opt)
    }
    return groups
  }, [availableOptions])

  const toggleOption = useCallback(
    (key: string) => {
      const next = specs.options.includes(key)
        ? specs.options.filter((k) => k !== key)
        : [...specs.options, key]
      update({ options: next })
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [specs.options],
  )

  const clearAllOptions = useCallback(() => {
    update({ options: [] })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const totalOptionsPremium = useMemo(() => {
    let sum = 0
    for (const key of specs.options) {
      const opt = availableOptions.find((o) => o.key === key)
      if (opt) sum += opt.premium
    }
    return sum
  }, [specs.options, availableOptions])

  return (
    <div className="rounded-xl border border-emerald-200 dark:border-emerald-500/30 bg-emerald-50/40 dark:bg-emerald-500/[0.06] p-3">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <label className="space-y-1">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">
            État
          </span>
          <select
            value={specs.condition}
            onChange={(e) => update({ condition: e.target.value as VehicleConditionInput })}
            disabled={disabled}
            className={cn(
              "w-full px-3 py-2 rounded-lg border text-sm",
              "border-[var(--color-border-secondary)] bg-[var(--color-background-primary)]",
              "text-[var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-emerald-500",
            )}
          >
            <option value="">Non précisé</option>
            <option value="new">Neuf</option>
            <option value="used">Usagé</option>
          </select>
        </label>

        <label className="space-y-1">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">
            {mileageLabel}
          </span>
          <input
            type="text"
            inputMode="numeric"
            value={specs.mileage}
            onChange={(e) => update({ mileage: e.target.value.replace(/[^\d\s,]/g, "") })}
            disabled={disabled}
            placeholder={mileagePlaceholder}
            className={cn(
              "w-full px-3 py-2 rounded-lg border text-sm",
              "border-[var(--color-border-secondary)] bg-[var(--color-background-primary)]",
              "text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)]",
              "focus:outline-none focus:ring-2 focus:ring-emerald-500",
            )}
          />
        </label>

        <label className="space-y-1">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">
            Prix demandé
          </span>
          <input
            type="text"
            inputMode="numeric"
            value={specs.askingPrice}
            onChange={(e) => update({ askingPrice: e.target.value.replace(/[^\d\s,]/g, "") })}
            disabled={disabled}
            placeholder="ex: 6 900"
            className={cn(
              "w-full px-3 py-2 rounded-lg border text-sm",
              "border-[var(--color-border-secondary)] bg-[var(--color-background-primary)]",
              "text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)]",
              "focus:outline-none focus:ring-2 focus:ring-emerald-500",
            )}
          />
        </label>
      </div>

      {availableOptions.length > 0 && (
        <div className="mt-4 pt-3 border-t border-emerald-200/60 dark:border-emerald-500/20">
          <div className="flex items-baseline justify-between gap-2 mb-2.5">
            <div className="min-w-0 flex items-baseline gap-2 flex-wrap">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">
                Options & équipement
              </span>
              {detectedMake && (
                <span className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-700 dark:text-emerald-300 bg-emerald-100 dark:bg-emerald-500/15 px-1.5 py-0.5 rounded">
                  <span className="capitalize">{detectedMake}</span>
                  <span className="text-emerald-600/70 dark:text-emerald-400/70 font-normal">détecté</span>
                </span>
              )}
              <span className="text-[10px] text-[var(--color-text-tertiary)]">
                {specs.options.length === 0
                  ? detectedMake
                    ? "Coche ce qui s'applique à ton véhicule"
                    : "Tape une marque pour voir les options spécifiques (ex: Ford → packages 502A, FX4…)"
                  : `${specs.options.length} sélectionnée${specs.options.length > 1 ? "s" : ""} (≈ +${totalOptionsPremium.toLocaleString("fr-CA")} $)`}
              </span>
            </div>
            {specs.options.length > 0 && (
              <button
                type="button"
                onClick={clearAllOptions}
                disabled={disabled}
                className="text-[10px] font-medium text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] underline decoration-dotted shrink-0"
              >
                Tout désélectionner
              </button>
            )}
          </div>

          <div className="space-y-2.5">
            {(["engine", "package", "drivetrain", "equipment"] as const).map((group) => {
              const opts = groupedOptions[group]
              if (opts.length === 0) return null
              return (
                <div key={group}>
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-secondary)] mb-1.5">
                    {OPTION_GROUP_LABELS[group]}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {opts.map((opt) => {
                      const checked = specs.options.includes(opt.key)
                      return (
                        <button
                          key={opt.key}
                          type="button"
                          onClick={() => toggleOption(opt.key)}
                          disabled={disabled}
                          className={cn(
                            "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors",
                            checked
                              ? "bg-emerald-600 border-emerald-600 text-white shadow-sm shadow-emerald-600/20"
                              : "bg-[var(--color-background-primary)] border-[var(--color-border-secondary)] text-[var(--color-text-primary)] hover:border-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300",
                            disabled && "opacity-50 cursor-not-allowed",
                          )}
                          aria-pressed={checked}
                        >
                          <span>{opt.label}</span>
                          <span
                            className={cn(
                              "tabular-nums",
                              checked
                                ? "text-white/80"
                                : opt.premium === 0
                                  ? "text-[var(--color-text-tertiary)]"
                                  : "text-emerald-600 dark:text-emerald-400",
                            )}
                          >
                            {opt.premium === 0 ? "—" : `+${opt.premium.toLocaleString("fr-CA")} $`}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function LoadingSkeleton() {
  return (
    <div className="space-y-3">
      <div className="bg-[var(--color-background-primary)] border border-[var(--color-border-secondary)] rounded-xl px-4 py-3 flex items-center gap-3">
        <Loader2 className="h-4 w-4 animate-spin text-emerald-600" />
        <span className="text-sm text-[var(--color-text-secondary)]">
          Interrogation des sources en parallèle...
        </span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div
            key={i}
            className="bg-[var(--color-background-primary)] border border-[var(--color-border-secondary)] rounded-xl overflow-hidden animate-pulse"
          >
            <div className="aspect-[4/3] bg-[var(--color-background-secondary)]" />
            <div className="p-3 space-y-2">
              <div className="h-4 w-3/4 bg-[var(--color-background-secondary)] rounded" />
              <div className="h-3 w-1/2 bg-[var(--color-background-secondary)] rounded" />
              <div className="h-5 w-1/3 bg-[var(--color-background-secondary)] rounded" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function EmptyState() {
  return (
    <div className="bg-[var(--color-background-primary)] border border-dashed border-[var(--color-border-secondary)] rounded-2xl py-16 px-6 text-center">
      <div className="inline-flex items-center justify-center h-14 w-14 rounded-2xl bg-emerald-50 dark:bg-emerald-500/10 mb-3">
        <Search className="h-7 w-7 text-emerald-600" />
      </div>
      <h3 className="text-base font-semibold text-[var(--color-text-primary)]">
        Cherche un produit
      </h3>
      <p className="mt-1.5 text-sm text-[var(--color-text-secondary)] max-w-md mx-auto">
        Tape un nom de produit ci-dessus, puis clique sur Rechercher. Sélectionne une
        catégorie pour cibler les bonnes sources.
      </p>
    </div>
  )
}

function ResultsView({
  result,
  queryText,
  valuationQueryText,
  categoryPath,
  showValuation,
}: {
  result: SearchResult
  queryText: string
  valuationQueryText: string
  categoryPath: string | null
  showValuation: boolean
}) {
  const successCount = result.adapters_run.filter((a) => !a.error).length
  const errorCount = result.adapters_run.filter((a) => !!a.error).length
  const scoredHits = useMemo(() => {
    const parsed = parseEvaluationQuery(showValuation ? valuationQueryText : queryText)
    return scoreHits(parsed, result.hits)
  }, [queryText, valuationQueryText, showValuation, result.hits])
  const valuation = useMemo(
    // On évalue à partir des véhicules effectivement affichés (déjà filtrés
    // par la pertinence textuelle) pour garantir la cohérence entre les
    // résultats à l'écran et les comparables utilisés. Si le toggle évaluateur
    // est éteint ou qu'on n'est pas dans une catégorie véhicule, on ne calcule
    // pas la valuation (gain de perf + on cache la carte).
    () => (showValuation ? evaluateValue(valuationQueryText, categoryPath, scoredHits) : null),
    [showValuation, valuationQueryText, categoryPath, scoredHits],
  )
  const totalHits = scoredHits.length
  const hasErrors = errorCount > 0

  return (
    <div className="space-y-4">
      <details className="bg-[var(--color-background-primary)] border border-[var(--color-border-secondary)] rounded-xl overflow-hidden group">
        <summary className="px-4 py-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm cursor-pointer hover:bg-[var(--color-background-hover)] list-none">
          <div className="flex items-center gap-1.5 text-[var(--color-text-primary)] font-semibold">
            <span className="tabular-nums">{totalHits}</span>
            <span className="text-[var(--color-text-secondary)] font-normal">
              résultat{totalHits > 1 ? "s" : ""}
            </span>
          </div>
          <div className="flex items-center gap-1.5 text-[var(--color-text-secondary)]">
            <Globe className="h-3.5 w-3.5" />
            <span>{successCount}/{successCount + errorCount} sources</span>
          </div>
          <div className="flex items-center gap-1.5 text-[var(--color-text-secondary)]">
            <Clock className="h-3.5 w-3.5" />
            <span className="tabular-nums">{result.elapsed_seconds.toFixed(1)}s</span>
          </div>
          {result.cache_hits > 0 && (
            <div className="flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400 text-xs">
              <CheckCircle2 className="h-3.5 w-3.5" />
              <span>{result.cache_hits} cache</span>
            </div>
          )}
          {hasErrors && (
            <div className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400 text-xs ml-auto">
              <AlertCircle className="h-3.5 w-3.5" />
              <span>{errorCount} en échec</span>
            </div>
          )}
          <div className="ml-auto flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">
            <span>Détails</span>
            <ChevronDown className="h-3.5 w-3.5 group-open:rotate-180 transition-transform" />
          </div>
        </summary>
        <div className="border-t border-[var(--color-border-secondary)] divide-y divide-[var(--color-border-secondary)]">
          {result.adapters_run.map((a, i) => (
            <div key={i} className="px-4 py-2 text-xs flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                {a.error ? (
                  <AlertCircle className="h-3.5 w-3.5 text-red-500 shrink-0" />
                ) : (
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                )}
                <span className="font-medium text-[var(--color-text-primary)] truncate">{a.name}</span>
                {a.cache_hit && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 font-semibold uppercase">
                    cache
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3 text-[var(--color-text-secondary)] shrink-0">
                {a.error ? (
                  <span className="text-red-600 dark:text-red-400 truncate max-w-[260px] sm:max-w-[400px]" title={a.error}>
                    {a.error.slice(0, 100)}
                  </span>
                ) : (
                  <span className="tabular-nums">{a.hits_returned} hit{a.hits_returned > 1 ? "s" : ""}</span>
                )}
                <span className="tabular-nums">{a.duration_seconds.toFixed(1)}s</span>
              </div>
            </div>
          ))}
        </div>
      </details>

      {valuation && <EvaluationCard result={valuation} />}

      {totalHits === 0 ? (
        <div className="bg-[var(--color-background-primary)] border border-dashed border-[var(--color-border-secondary)] rounded-xl py-12 text-center px-4">
          <Info className="h-8 w-8 text-[var(--color-text-tertiary)] mx-auto mb-2" />
          <p className="text-sm font-medium text-[var(--color-text-primary)]">Aucun produit ne correspond</p>
          <p className="text-xs text-[var(--color-text-tertiary)] mt-1 max-w-sm mx-auto">
            Simplifie ta requête (ex: juste la marque + modèle) ou ajoute des sources.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {scoredHits.map((hit, i) => (
            <ResultCard key={`${hit.source_url || hit.source_site}:${i}`} hit={hit} />
          ))}
        </div>
      )}
    </div>
  )
}

function evaluationBadgeTone(score: number): "emerald" | "amber" | "orange" | "slate" {
  if (score >= 80) return "emerald"
  if (score >= 60) return "amber"
  if (score >= 40) return "orange"
  return "slate"
}

const resolvedImageCache = new Map<string, string>()

function shouldResolveListingImage(hit: ScoredHit) {
  if (hit.image || !hit.source_url) return false
  return (hit.source_site || "").toLowerCase().includes("autotrader")
}

function useResolvedListingImage(hit: ScoredHit) {
  const cacheKey = hit.source_url || ""
  const [resolvedImage, setResolvedImage] = useState(() =>
    hit.image || (cacheKey ? resolvedImageCache.get(cacheKey) || "" : ""),
  )

  useEffect(() => {
    const cached = cacheKey ? resolvedImageCache.get(cacheKey) || "" : ""
    setResolvedImage(hit.image || cached)

    if (hit.image || cached || !shouldResolveListingImage(hit)) return

    const controller = new AbortController()
    fetch(`/api/product-search/resolve-image?url=${encodeURIComponent(hit.source_url)}`, {
      signal: controller.signal,
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { image?: unknown } | null) => {
        const image = typeof data?.image === "string" ? data.image : ""
        if (!image) return
        resolvedImageCache.set(cacheKey, image)
        setResolvedImage(image)
      })
      .catch(() => {
        /* Image fallback best-effort seulement. */
      })

    return () => controller.abort()
  }, [cacheKey, hit])

  return resolvedImage
}

function ResultCard({ hit }: { hit: ScoredHit }) {
  const resolvedImage = useResolvedListingImage(hit)
  const [imageFailed, setImageFailed] = useState(false)
  const formatPrice = (p: number | null) => {
    if (p == null) return null
    return new Intl.NumberFormat("fr-CA", {
      style: "currency",
      currency: "CAD",
      maximumFractionDigits: 0,
    }).format(p)
  }
  const priceStr = formatPrice(hit.prix)
  const matchPct = hit.evalScore
  const matchTone = evaluationBadgeTone(hit.evalScore)
  const breakdownTitle =
    `Texte ${hit.breakdown.text}% · Année ${hit.breakdown.year}% · ` +
    `KM ${hit.breakdown.mileage}% · Prix ${hit.breakdown.price}% · Variante ${hit.breakdown.variant}%`
  const displayImage = imageFailed ? "" : resolvedImage

  useEffect(() => {
    setImageFailed(false)
  }, [resolvedImage])

  return (
    <a
      href={hit.source_url || "#"}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "group flex flex-col bg-[var(--color-background-primary)] border border-[var(--color-border-secondary)]",
        "rounded-xl overflow-hidden hover:border-emerald-500/40 hover:shadow-md hover:-translate-y-0.5 transition-all",
        !hit.source_url && "pointer-events-none opacity-60"
      )}
    >
      <div className="aspect-[4/3] bg-[var(--color-background-secondary)] relative overflow-hidden">
        {displayImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={displayImage}
            alt={hit.name}
            loading="lazy"
            className="w-full h-full object-contain group-hover:scale-105 transition-transform duration-300"
            onError={() => setImageFailed(true)}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-[var(--color-text-tertiary)]">
            <ShoppingBag className="h-10 w-10" />
          </div>
        )}

        <span
          className={cn(
            "absolute top-2 left-2 inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-bold backdrop-blur-sm",
            matchTone === "emerald" && "bg-emerald-600/90 text-white",
            matchTone === "amber" && "bg-amber-500/90 text-white",
            matchTone === "orange" && "bg-orange-500/90 text-white",
            matchTone === "slate" && "bg-slate-700/80 text-white"
          )}
          title={breakdownTitle}
        >
          {matchPct}% match
        </span>

        {hit.etat && (
          <span
            className={cn(
              "absolute top-2 right-2 inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-semibold backdrop-blur-sm capitalize",
              hit.etat === "neuf"
                ? "bg-blue-600/90 text-white"
                : "bg-orange-500/90 text-white"
            )}
          >
            {hit.etat}
          </span>
        )}

        {hit.isDeal && (
          <span className="absolute bottom-2 left-2 inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold backdrop-blur-sm bg-rose-600/90 text-white">
            🔥 AUBAINE {Math.abs(Math.round(hit.priceVsMedian * 100))}% sous médian
          </span>
        )}
      </div>

      <div className="flex-1 p-3 flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-[var(--color-text-primary)] line-clamp-2 leading-snug">
          {hit.name}
        </h3>

        <div className="mt-auto flex items-end justify-between gap-2">
          <div>
            {priceStr ? (
              <span className="text-lg font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">
                {priceStr}
              </span>
            ) : (
              <span className="text-xs text-[var(--color-text-tertiary)] italic">
                Prix non listé
              </span>
            )}
            {hit.annee && (
              <span className="ml-2 text-xs text-[var(--color-text-secondary)] tabular-nums">
                {hit.annee}
              </span>
            )}
            {hit.kilometrage != null && (
              <span className="ml-2 text-xs text-[var(--color-text-tertiary)] tabular-nums">
                {hit.kilometrage.toLocaleString("fr-CA")} km
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 pt-2 border-t border-[var(--color-border-secondary)]">
          <div className="flex items-center gap-1 min-w-0">
            <Globe className="h-3 w-3 text-[var(--color-text-tertiary)] shrink-0" />
            <span className="text-[11px] text-[var(--color-text-secondary)] truncate">
              {hit.source_site}
            </span>
          </div>
          <ExternalLink className="h-3 w-3 text-[var(--color-text-tertiary)] group-hover:text-emerald-500 shrink-0" />
        </div>
      </div>
    </a>
  )
}
