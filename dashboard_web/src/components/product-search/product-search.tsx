"use client"

import { useState, useCallback, useEffect, useMemo } from "react"
import {
  Search, Loader2, AlertCircle, CheckCircle2, Info, X, ChevronDown,
  Briefcase, Eye, Check,
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
import PageOnboarding, { type PageOnboardingStep } from "@/components/page-onboarding"
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

  const selectableSourceCount = useMemo(
    () => SOURCES.filter((s) => !s.disabled).length,
    [],
  )

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

  const toggleEvaluator = useCallback(() => {
    setState((s) => ({ ...s, evaluatorEnabled: !s.evaluatorEnabled }))
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

  const runSearch = useCallback(async (rawQuery: string) => {
    if (!rawQuery.trim()) {
      toast.error("Tapez d'abord ce que vous cherchez")
      return
    }
    if (activeCount === 0) {
      toast.error("Activez au moins une source dans le panneau de droite")
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
          query: rawQuery,
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
          "Votre session a expiré. Reconnectez-vous pour relancer votre recherche.",
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
      rememberQuerySuggestions(rawQuery, (data as SearchResult)?.hits || [])
      const total = data?.total ?? 0
      const isApprox = !!(data as SearchResult)?.is_approximate
      if (total === 0) {
        const scanned = (data as SearchResult)?.products_scanned ?? 0
        toast.warning(
          scanned > 0
            ? `Aucun résultat — ${scanned} produit${scanned > 1 ? "s" : ""} scanné${scanned > 1 ? "s" : ""}, retirez l'année ou simplifiez le modèle`
            : "Aucun résultat — élargissez la requête ou ajoutez des sources",
        )
      } else if (isApprox) {
        toast.warning(
          `Aucun match exact — voici ${total} comparable${total > 1 ? "s" : ""} approchant${total > 1 ? "s" : ""}`,
        )
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

  const onSubmit = useCallback((e?: React.FormEvent) => {
    e?.preventDefault()
    void runSearch(state.query)
  }, [runSearch, state.query])

  // Suggestion cliquée (état vide) : remplit la barre ET lance la recherche.
  const handleSuggestion = useCallback((query: string) => {
    setState((s) => ({ ...s, query }))
    void runSearch(query)
  }, [runSearch])

  const helperText = state.query.trim()
    ? activeCount === 0
      ? "Activez au moins une source pour lancer la recherche."
      : `Prêt à interroger ${activeCount} source${activeCount > 1 ? "s" : ""} en parallèle.`
    : "Tapez votre requête puis cliquez sur Rechercher."

  // Guide de première visite : barre → catégorie → sources (→ évaluateur si
  // catégorie véhicule). Attend la fermeture de l'onboarding business_type
  // pour ne jamais empiler deux overlays.
  const onboardingSteps = useMemo<PageOnboardingStep[]>(() => {
    const steps: PageOnboardingStep[] = [
      {
        targetId: "recherche-bar",
        title: "Cherchez un produit",
        description:
          "Tapez un modèle, un accessoire ou un numéro de pièce, puis cliquez sur Rechercher : toutes vos sources actives sont interrogées en parallèle.",
      },
      {
        targetId: "recherche-categorie",
        title: "Ciblez la bonne catégorie",
        description:
          "La catégorie oriente la recherche vers les bonnes sources et améliore la précision des résultats.",
      },
      {
        targetId: "recherche-sources",
        title: "Choisissez vos sources",
        description:
          "Activez ou désactivez chaque marketplace d'un clic. Les sources verrouillées sont regroupées dans « Sources à venir ».",
      },
    ]
    if (isVehicleCat) {
      steps.push({
        targetId: "recherche-evaluateur",
        title: "Évaluez un véhicule",
        description:
          "Activez cet interrupteur pour estimer la valeur d'un véhicule : les champs (état, kilométrage, options) apparaissent juste en dessous.",
      })
    }
    return steps
  }, [isVehicleCat])

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

      <PageOnboarding
        pageKey="recherche"
        ready={hasHydrated && !showOnboarding}
        steps={onboardingSteps}
      />

      {/* ── En-tête compact ──
          Toute la configuration (catégorie, sources, évaluateur, domaines)
          vit dans le panneau latéral : l'en-tête ne porte plus que
          l'identité de la vue, sans répéter les compteurs. */}
      <header>
        <div className="flex items-center gap-2 text-xs text-[var(--color-text-secondary)]">
          <span className="relative flex h-1.5 w-1.5 shrink-0">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-orange-400 opacity-60" />
            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-orange-500" />
          </span>
          <span className="font-medium uppercase tracking-wider">
            Recherche multi-sources
          </span>
        </div>
        <h1 className="mt-1.5 text-2xl md:text-[1.8rem] font-semibold text-[var(--color-text-primary)] tracking-tight">
          Recherche par produit
        </h1>
      </header>

      {/* ── Grille : recherche + résultats à gauche, panneau de
          configuration fixe à droite. Ordre DOM = formulaire → panneau →
          résultats pour qu'en mobile la config reste accessible entre la
          barre et les résultats. */}
      {/* grid-rows-[auto_1fr] est crucial : sans lui, le panneau latéral
          (row-span-2) répartit sa hauteur sur les deux rangées et crée un
          énorme vide entre la barre de recherche et les résultats. */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] lg:grid-rows-[auto_1fr] gap-5 items-start">

      {/* ── Barre de recherche : input dominant + CTA primaire ── */}
      <form
        id="recherche-bar"
        onSubmit={onSubmit}
        className="lg:col-start-1 lg:row-start-1 relative z-0 rounded-2xl border border-[var(--color-border-tertiary)]/55 bg-[var(--color-background-primary)]/45 shadow-[0_16px_50px_-40px_rgba(15,23,42,0.55)] backdrop-blur-md"
      >
        <div className="p-3 flex items-stretch gap-2.5 flex-wrap md:flex-nowrap">
          <div
            className={cn(
              "relative flex-1 min-w-0 w-full rounded-xl border h-12",
              "border-[var(--color-border-secondary)] bg-[var(--color-background-primary)]",
              "focus-within:ring-2 focus-within:ring-[var(--color-text-primary)]/20 focus-within:border-[var(--color-text-tertiary)]",
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
              placeholder={
                isVehicleCat
                  ? "Ex : « Ski-Doo Summit 850 », « Yamaha MT-07 2022 »"
                  : "Ex : « iPhone 15 Pro 256GB », « casque Bell », « Ski-Doo Summit 850 »"
              }
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
              "bg-orange-600 text-white hover:bg-orange-500 hover:-translate-y-0.5",
              "shadow-md shadow-orange-600/25 hover:shadow-lg hover:shadow-orange-600/30",
              "disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0",
            )}
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            <span>{loading ? "Recherche…" : "Rechercher"}</span>
          </button>
        </div>

        {/* Footer : texte d'aide à gauche, interrupteur de l'évaluateur à
            droite — juste au-dessus des champs qu'il fait apparaître, pour
            que le contrôle et son effet restent au même endroit. */}
        <div className="px-4 py-2.5 border-t border-[var(--color-border-tertiary)]/40 flex items-center justify-between gap-3 flex-wrap">
          <p className="text-[11px] text-[var(--color-text-tertiary)] min-w-0 flex-1">
            {helperText}
          </p>
          {isVehicleCat && (
            <div id="recherche-evaluateur" className="flex items-center gap-2 shrink-0">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-secondary)]">
                Évaluateur véhicule
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={state.evaluatorEnabled}
                onClick={toggleEvaluator}
                title="Estimer la valeur du véhicule à partir des comparables"
                className={cn(
                  "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors",
                  state.evaluatorEnabled
                    ? "bg-orange-600"
                    : "bg-[var(--color-border-secondary)]",
                )}
              >
                <span
                  className={cn(
                    "inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform",
                    state.evaluatorEnabled ? "translate-x-[18px]" : "translate-x-[3px]",
                  )}
                />
              </button>
            </div>
          )}
        </div>

        {/* Champs de l'évaluateur : ils s'ouvrent directement sous leur
            interrupteur, en pleine largeur. */}
        {evaluatorActive && (
          <div className="px-4 pb-4 pt-1 border-t border-[var(--color-border-tertiary)]/40">
            <VehicleSpecsBox
              specs={state.vehicleSpecs}
              disabled={loading}
              categoryPath={state.category}
              queryText={state.query}
              onChange={(vehicleSpecs) => setState((s) => ({ ...s, vehicleSpecs }))}
            />
          </div>
        )}
      </form>

      {/* ── Panneau latéral : toute la configuration, toujours visible.
          Catégorie, sources et évaluateur ne sont plus cachés derrière
          des toggles — on voit d'un coup d'œil ce qui sera interrogé. ── */}
      <aside className="min-w-0 lg:col-start-2 lg:row-start-1 lg:row-span-2">
        <div className="lg:sticky lg:top-5 space-y-4">
          <SidebarSection id="recherche-categorie" title="Catégorie">
            <CategoryPicker
              value={state.category}
              onChange={(path) => setState((s) => ({ ...s, category: path }))}
              allowedPaths={allowedCategoryPaths}
              triggerClassName={cn(
                "w-full inline-flex items-center justify-between gap-2 h-10 px-3 rounded-lg border text-sm font-medium transition-colors",
                "border-[var(--color-border-secondary)] bg-[var(--color-background-primary)]",
                "hover:bg-[var(--color-background-hover)] text-[var(--color-text-primary)]",
              )}
              labelMaxWidthClassName="max-w-[200px]"
            />
          </SidebarSection>

          <SidebarSection
            id="recherche-sources"
            title="Sources"
            badge={`${activeCount} active${activeCount > 1 ? "s" : ""}`}
            action={
              <button
                type="button"
                onClick={() => toggleAll(activeCount < selectableSourceCount)}
                className="text-[11px] font-medium text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] transition-colors"
              >
                {activeCount < selectableSourceCount ? "Tout activer" : "Tout désactiver"}
              </button>
            }
          >
            <SourcesPanel
              adapters={state.adapters}
              onToggle={updateAdapter}
            />
          </SidebarSection>

          {isAdmin ? (
            <SidebarSection title="Vue admin">
              <AdminViewAsPicker value={adminViewAs} onChange={setAdminViewAs} />
            </SidebarSection>
          ) : user ? (
            <button
              type="button"
              onClick={handleReopenOnboarding}
              className={cn(
                "w-full inline-flex items-center gap-2.5 px-4 py-3 rounded-2xl border text-left transition-colors",
                "border-[var(--color-border-tertiary)]/55 bg-[var(--color-background-primary)]/45 backdrop-blur-md",
                "hover:bg-[var(--color-background-hover)]",
              )}
              title="Changer mes domaines d'activité"
            >
              <Briefcase
                className="h-4 w-4 shrink-0 text-[var(--color-text-tertiary)]"
                strokeWidth={1.75}
              />
              <span className="min-w-0 flex-1 truncate text-sm text-[var(--color-text-secondary)]">
                {effectiveBusinessTypes.length === 0
                  ? "Choisir mes domaines d'activité"
                  : effectiveBusinessTypes.length === 1
                    ? t(BT_LABEL_KEYS[effectiveBusinessTypes[0]])
                    : `${effectiveBusinessTypes.length} domaines`}
              </span>
              <span className="text-xs font-medium text-[var(--color-text-tertiary)] shrink-0">
                Modifier
              </span>
            </button>
          ) : null}
        </div>
      </aside>

      {/* ── États & résultats (col gauche, sous la barre) ── */}
      <div className="min-w-0 space-y-5 lg:col-start-1 lg:row-start-2">
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

        {!result && !loading && !error && (
          <EmptyState isVehicle={isVehicleCat} onPick={handleSuggestion} />
        )}
      </div>

      </div>
    </div>
  )
}

/**
 * Bloc du panneau latéral : carte légère avec titre en petites capitales,
 * badge optionnel (ex. compteur de sources) et action optionnelle (ex.
 * switch de l'évaluateur).
 */
function SidebarSection({
  id,
  title,
  badge,
  action,
  children,
}: {
  id?: string
  title: string
  badge?: string
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section id={id} className="rounded-2xl border border-[var(--color-border-tertiary)]/55 bg-[var(--color-background-primary)]/45 shadow-[0_16px_50px_-40px_rgba(15,23,42,0.55)] backdrop-blur-md">
      <div className="flex items-center justify-between gap-2 px-3.5 pt-3 pb-1.5">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-secondary)]">
            {title}
          </span>
          {badge && (
            <span className="text-[10px] tabular-nums font-semibold px-1.5 py-0.5 rounded bg-[var(--color-background-secondary)] text-[var(--color-text-primary)]">
              {badge}
            </span>
          )}
        </div>
        {action}
      </div>
      <div className="px-3.5 pb-3.5">{children}</div>
    </section>
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
                      ? "bg-[var(--color-background-secondary)] text-[var(--color-text-primary)] font-semibold"
                      : "text-[var(--color-text-primary)] hover:bg-[var(--color-background-hover)]",
                  )}
                >
                  <span
                    className={cn(
                      "shrink-0 w-3.5 h-3.5 rounded border flex items-center justify-center transition-colors",
                      isSelected
                        ? "bg-[var(--color-text-primary)] border-[var(--color-text-primary)]"
                        : "bg-[var(--color-background-primary)] border-[var(--color-border-secondary)]",
                    )}
                  >
                    {isSelected && <Check className="h-2.5 w-2.5 text-[var(--color-background-primary)]" strokeWidth={3} />}
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
}: {
  adapters: AdapterToggles
  onToggle: <K extends keyof AdapterToggles>(key: K, value: AdapterToggles[K]) => void
}) {
  const [showUpcoming, setShowUpcoming] = useState(false)

  // Vitesse indicative par groupe, affichée en note à droite de chaque
  // ligne — remplace les anciens titres de groupe qui prenaient plus de
  // place que leur contenu.
  const SPEED_BY_GROUP: Record<SourceMeta["group"], string> = {
    instant: "≤ 3 s",
    marketplace: "5-15 s",
    vehicle: "10-15 s",
    api: "",
  }

  const selectable = SOURCES.filter((s) => !s.disabled)
  const upcoming = SOURCES.filter((s) => s.disabled)

  return (
    <div>
      {/* Liste verticale alignée : une ligne par source, case à cocher à
          gauche, vitesse à droite. Uniforme et scannable, contrairement
          au nuage de pastilles de largeurs variées. */}
      <div className="-mx-1.5">
        {selectable.map((src) => {
          const checked = adapters[src.key] as boolean
          return (
            <button
              key={src.key}
              type="button"
              onClick={() => onToggle(src.key, !checked as AdapterToggles[typeof src.key])}
              title={src.hint}
              aria-pressed={checked}
              className="w-full flex items-center gap-2.5 px-1.5 py-[7px] rounded-lg text-left hover:bg-[var(--color-background-hover)] transition-colors"
            >
              <span
                className={cn(
                  "flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors",
                  checked
                    ? "bg-orange-600 border-orange-600 text-white"
                    : "border-[var(--color-border-secondary)] bg-[var(--color-background-primary)]",
                )}
              >
                {checked && <Check className="h-3 w-3" strokeWidth={3} />}
              </span>
              <span
                className={cn(
                  "flex-1 min-w-0 truncate text-[13px]",
                  checked
                    ? "font-medium text-[var(--color-text-primary)]"
                    : "text-[var(--color-text-secondary)]",
                )}
              >
                {src.label}
              </span>
              {SPEED_BY_GROUP[src.group] && (
                <span className="text-[10px] tabular-nums text-[var(--color-text-tertiary)] shrink-0">
                  {SPEED_BY_GROUP[src.group]}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {upcoming.length > 0 && (
        <div className="mt-2 border-t border-[var(--color-border-tertiary)]/60 pt-2.5">
          <button
            type="button"
            onClick={() => setShowUpcoming((v) => !v)}
            className="w-full flex items-center justify-between gap-2 text-left group"
            aria-expanded={showUpcoming}
          >
            <span className="text-[11px] font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider group-hover:text-[var(--color-text-primary)] transition-colors">
              Sources à venir
            </span>
            <span className="flex items-center gap-1.5 text-[10px] tabular-nums text-[var(--color-text-tertiary)]">
              {upcoming.length}
              <ChevronDown
                className={cn("h-3.5 w-3.5 transition-transform", showUpcoming && "rotate-180")}
              />
            </span>
          </button>
          {showUpcoming && (
            <div className="mt-1.5">
              {upcoming.map((src) => (
                <div
                  key={src.key}
                  title={src.hint}
                  className="flex items-center gap-2.5 px-1.5 py-[5px]"
                >
                  <span className="h-4 w-4 shrink-0 rounded border border-dashed border-[var(--color-border-secondary)]" />
                  <span className="flex-1 min-w-0 truncate text-[13px] text-[var(--color-text-tertiary)]">
                    {src.label}
                  </span>
                  <span className="text-[10px] text-[var(--color-text-tertiary)] shrink-0">
                    bientôt
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function VehicleSpecsBox({
  specs,
  disabled,
  categoryPath,
  queryText,
  onChange,
  compact = false,
}: {
  specs: VehicleSpecs
  disabled: boolean
  categoryPath: string | null
  queryText: string
  onChange: (specs: VehicleSpecs) => void
  /** Empile les champs sur une colonne (panneau latéral étroit). */
  compact?: boolean
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
    <div className="rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)]/60 p-3">
      <div className={cn("grid gap-2", compact ? "grid-cols-1" : "grid-cols-1 sm:grid-cols-3")}>
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
              "text-[var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-text-primary)]/20 focus:border-[var(--color-text-tertiary)]",
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
              "focus:outline-none focus:ring-2 focus:ring-[var(--color-text-primary)]/20 focus:border-[var(--color-text-tertiary)]",
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
              "focus:outline-none focus:ring-2 focus:ring-[var(--color-text-primary)]/20 focus:border-[var(--color-text-tertiary)]",
            )}
          />
        </label>
      </div>

      {availableOptions.length > 0 && (
        <div className="mt-4 pt-3 border-t border-[var(--color-border-tertiary)]/60">
          <div className="flex items-baseline justify-between gap-2 mb-2.5">
            <div className="min-w-0 flex items-baseline gap-2 flex-wrap">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">
                Options & équipement
              </span>
              {detectedMake && (
                <span className="inline-flex items-center gap-1 text-[10px] font-medium text-[var(--color-text-secondary)] bg-[var(--color-background-secondary)] border border-[var(--color-border-tertiary)] px-1.5 py-0.5 rounded">
                  <span className="capitalize">{detectedMake}</span>
                  <span className="text-[var(--color-text-tertiary)] font-normal">détecté</span>
                </span>
              )}
              <span className="text-[10px] text-[var(--color-text-tertiary)]">
                {specs.options.length === 0
                  ? detectedMake
                    ? "Cochez ce qui s'applique à votre véhicule"
                    : "Tapez une marque pour voir les options spécifiques (ex: Ford → packages 502A, FX4…)"
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
                              ? "bg-[var(--color-text-primary)] border-[var(--color-text-primary)] text-[var(--color-background-primary)]"
                              : "bg-[var(--color-background-primary)] border-[var(--color-border-secondary)] text-[var(--color-text-primary)] hover:border-[var(--color-text-tertiary)]",
                            disabled && "opacity-50 cursor-not-allowed",
                          )}
                          aria-pressed={checked}
                        >
                          <span>{opt.label}</span>
                          <span
                            className={cn(
                              "tabular-nums",
                              checked
                                ? "opacity-70"
                                : "text-[var(--color-text-tertiary)]",
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
        <Loader2 className="h-4 w-4 animate-spin text-[var(--color-text-secondary)]" />
        <span className="text-sm text-[var(--color-text-secondary)]">
          Interrogation des sources en parallèle…
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

/**
 * État vide utile : au lieu d'une carte morte, on propose de reprendre une
 * recherche récente (historique local) ou de partir d'un exemple adapté à
 * la catégorie. Un clic remplit la barre ET lance la recherche.
 */
function EmptyState({
  isVehicle,
  onPick,
}: {
  isVehicle: boolean
  onPick: (query: string) => void
}) {
  const [recent, setRecent] = useState<string[]>([])

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(QUERY_COMPLETION_HISTORY_KEY)
      const parsed = raw ? JSON.parse(raw) : []
      if (Array.isArray(parsed)) {
        setRecent(
          parsed.filter((v): v is string => typeof v === "string").slice(0, 6),
        )
      }
    } catch { /* ignore */ }
  }, [])

  const examples = (
    isVehicle
      ? ["Ski-Doo Summit 850", "Yamaha MT-07 2022", "Can-Am Outlander 850", "KTM 300 XC-W"]
      : ["iPhone 15 Pro 256GB", "casque Bell moto", "Ski-Doo Summit 850"]
  ).filter((e) => !recent.includes(e))

  const chipClass = cn(
    "inline-flex items-center max-w-full px-3 py-1.5 rounded-full text-xs font-medium border transition-colors",
    "border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] text-[var(--color-text-secondary)]",
    "hover:text-[var(--color-text-primary)] hover:border-[var(--color-text-tertiary)]",
  )

  return (
    <div className="bg-[var(--color-background-primary)]/40 border border-dashed border-[var(--color-border-secondary)] rounded-2xl py-8 px-6 text-center backdrop-blur-sm">
      <h3 className="text-base font-semibold text-[var(--color-text-primary)]">
        Cherchez un produit
      </h3>
      <p className="mt-1.5 text-sm text-[var(--color-text-secondary)] max-w-md mx-auto">
        Tapez un nom de produit ci-dessus — la catégorie et les sources se
        règlent dans le panneau de droite.
      </p>

      {recent.length > 0 && (
        <div className="mt-5">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)]">
            Reprendre une recherche
          </div>
          <div className="mt-2 flex flex-wrap justify-center gap-1.5">
            {recent.map((q) => (
              <button key={q} type="button" onClick={() => onPick(q)} className={chipClass}>
                <span className="truncate">{q}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {examples.length > 0 && (
        <div className="mt-4">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)]">
            Exemples
          </div>
          <div className="mt-2 flex flex-wrap justify-center gap-1.5">
            {examples.map((q) => (
              <button key={q} type="button" onClick={() => onPick(q)} className={chipClass}>
                <span className="truncate">{q}</span>
              </button>
            ))}
          </div>
        </div>
      )}
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
  const isApproximate = !!result.is_approximate
  const totalScanned = result.products_scanned ?? 0
  // Nb de hits que le re-scoring frontend (`coreTextMatches`) a écartés. Si
  // > 0, on affiche un sous-titre "(X masqués par le filtre de pertinence)"
  // pour que l'utilisateur ne croie pas que le backend a renvoyé moins que
  // ce qu'annonçait le toast.
  const backendTotal = result.hits.length
  const filteredOut = Math.max(0, backendTotal - scoredHits.length)
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
      {isApproximate && totalHits > 0 && (
        <div className="rounded-xl border border-amber-200 dark:border-amber-500/30 bg-amber-50/70 dark:bg-amber-500/[0.08] px-4 py-3 flex items-start gap-3">
          <Info className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <div className="text-sm text-amber-900 dark:text-amber-200 min-w-0 flex-1">
            <div className="font-semibold">Aucun match exact — voici des comparables approchants</div>
            <p className="mt-0.5 text-amber-800/90 dark:text-amber-200/80 text-[13px]">
              Les sources interrogées n&apos;ont rien qui matche parfaitement ta requête.
              Ces produits diffèrent par l&apos;année, le modèle exact ou la marque.
              Affine ta recherche (retire l&apos;année, garde juste la marque) pour
              re-filtrer.
            </p>
          </div>
        </div>
      )}

      <details className="bg-[var(--color-background-primary)] border border-[var(--color-border-secondary)] rounded-xl overflow-hidden group">
        <summary className="px-4 py-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm cursor-pointer hover:bg-[var(--color-background-hover)] list-none">
          <div className="flex items-center gap-1.5 text-[var(--color-text-primary)] font-semibold">
            <span className="tabular-nums">{totalHits}</span>
            <span className="text-[var(--color-text-secondary)] font-normal">
              résultat{totalHits > 1 ? "s" : ""}
            </span>
            {filteredOut > 0 && (
              <span
                className="text-[11px] font-normal text-[var(--color-text-tertiary)]"
                title={`Le backend a renvoyé ${backendTotal} hits ; ${filteredOut} ont été masqués par le filtre de pertinence textuelle local.`}
              >
                ({filteredOut} masqué{filteredOut > 1 ? "s" : ""})
              </span>
            )}
          </div>
          <span className="text-[var(--color-text-secondary)] tabular-nums">
            {successCount}/{successCount + errorCount} sources
          </span>
          <span className="text-[var(--color-text-secondary)] tabular-nums">
            {result.elapsed_seconds.toFixed(1)}s
          </span>
          {result.cache_hits > 0 && (
            <span className="text-[var(--color-text-secondary)] tabular-nums text-xs">
              {result.cache_hits} en cache
            </span>
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
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--color-background-secondary)] text-[var(--color-text-secondary)] font-semibold uppercase">
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
                  <span
                    className="tabular-nums"
                    title={
                      a.products_scanned
                        ? `${a.products_scanned} produit${a.products_scanned > 1 ? "s" : ""} scanné${a.products_scanned > 1 ? "s" : ""}`
                        : undefined
                    }
                  >
                    {a.hits_returned} hit{a.hits_returned > 1 ? "s" : ""}
                    {a.approximate_returned ? (
                      <span className="ml-1 text-amber-600 dark:text-amber-400">
                        ({a.approximate_returned} approx)
                      </span>
                    ) : null}
                    {a.hits_returned === 0 && a.products_scanned ? (
                      <span className="ml-1 text-[var(--color-text-tertiary)]">
                        / {a.products_scanned} scannés
                      </span>
                    ) : null}
                  </span>
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
            {totalScanned > 0
              ? `${totalScanned.toLocaleString("fr-CA")} produit${totalScanned > 1 ? "s" : ""} scanné${totalScanned > 1 ? "s" : ""} dans les inventaires — aucun ne matche cette combinaison. Essaie de retirer l'année ou de garder juste la marque + le modèle.`
              : "Les caches d'inventaire sont vides pour ces sources. Active d'autres sources (Kijiji, AutoTrader) ou réessaie dans quelques minutes."}
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

function evaluationBadgeTone(score: number): "strong" | "medium" | "weak" | "faint" {
  if (score >= 80) return "strong"
  if (score >= 60) return "medium"
  if (score >= 40) return "weak"
  return "faint"
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
        "rounded-xl overflow-hidden hover:border-[var(--color-text-tertiary)] hover:shadow-md hover:-translate-y-0.5 transition-all",
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
          <div className="absolute inset-0 flex items-center justify-center text-[10px] uppercase tracking-wider text-[var(--color-text-tertiary)]">
            Sans image
          </div>
        )}

        <span
          className={cn(
            "absolute top-2 left-2 inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-bold backdrop-blur-sm",
            matchTone === "strong" && "bg-[var(--color-text-primary)]/90 text-[var(--color-background-primary)]",
            matchTone === "medium" && "bg-[var(--color-text-primary)]/65 text-[var(--color-background-primary)]",
            matchTone === "weak" && "bg-[var(--color-text-primary)]/40 text-[var(--color-background-primary)]",
            matchTone === "faint" && "bg-[var(--color-text-primary)]/25 text-[var(--color-background-primary)]"
          )}
          title={breakdownTitle}
        >
          {matchPct}% match
        </span>

        {hit.is_approximate && (
          <span
            className="absolute top-2 left-1/2 -translate-x-1/2 inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold backdrop-blur-sm bg-amber-500/90 text-white"
            title={hit.match_reason || "Comparable approchant — un veto strict aurait été appliqué"}
          >
            Approchant
          </span>
        )}

        {hit.etat && (
          <span className="absolute top-2 right-2 inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-semibold backdrop-blur-sm capitalize bg-[var(--color-background-primary)]/90 text-[var(--color-text-primary)] border border-[var(--color-border-secondary)]">
            {hit.etat}
          </span>
        )}

        {hit.isDeal && (
          <span className="absolute bottom-2 left-2 inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold backdrop-blur-sm bg-[var(--color-text-primary)] text-[var(--color-background-primary)]">
            Aubaine · {Math.abs(Math.round(hit.priceVsMedian * 100))}% sous médian
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
              <span className="text-lg font-bold text-[var(--color-text-primary)] tabular-nums">
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

        <div className="pt-2 border-t border-[var(--color-border-secondary)]">
          <span className="text-[11px] text-[var(--color-text-secondary)] truncate block">
            {hit.source_site}
          </span>
        </div>
      </div>
    </a>
  )
}
