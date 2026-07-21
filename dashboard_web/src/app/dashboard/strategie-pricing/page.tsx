"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Layout from "@/components/kokonutui/layout"
import {
  DEFAULT_PRICING_SETTINGS,
  VEHICLE_TYPE_LABELS,
  VEHICLE_TYPES,
  normalizePricingSettings,
  normalizeStrategyRule,
  type PricingStrategyKey,
  type PricingStrategyRule,
  type PricingStrategySettings,
  type VehicleType,
} from "@/lib/pricing-strategy"
import {
  Anchor,
  Bike,
  Car,
  Check,
  ChevronDown,
  Cog,
  Hammer,
  HelpCircle,
  Loader2,
  Sailboat,
  Scale,
  Snowflake,
  Sliders,
  Target,
  TrendingDown,
  Truck,
  Waves,
  Wrench,
  type LucideIcon,
} from "lucide-react"
import { toast } from "sonner"
import PageOnboarding, {
  replayPageOnboarding,
  type PageOnboardingStep,
} from "@/components/page-onboarding"

type StrategyMeta = {
  label: string
  tagline: string
  example: string
  icon: LucideIcon
}

const STRATEGY_META: Record<PricingStrategyKey, StrategyMeta> = {
  lowest_minus_amount: {
    label: "Sous le plus bas",
    tagline: "Battre le concurrent le moins cher.",
    example: "Concurrent à 9 999 $ → on recommande 9 949 $.",
    icon: TrendingDown,
  },
  match_lowest: {
    label: "Égaler le plus bas",
    tagline: "Rester compétitif sans rogner la marge.",
    example: "Concurrent à 9 999 $ → on recommande 9 999 $.",
    icon: Target,
  },
  market_average: {
    label: "Moyenne du marché",
    tagline: "Équilibre entre marge et compétitivité.",
    example: "9 999, 10 500, 11 000 $ → on recommande 10 500 $.",
    icon: Scale,
  },
}

const STRATEGY_ORDER: PricingStrategyKey[] = [
  "lowest_minus_amount",
  "match_lowest",
  "market_average",
]

const VEHICLE_ICON: Record<VehicleType, LucideIcon> = {
  moto: Bike,
  vtt: Bike,
  "cote-a-cote": Car,
  motoneige: Snowflake,
  motomarine: Waves,
  "3-roues": Bike,
  ponton: Anchor,
  bateau: Sailboat,
  "moteur-hors-bord": Cog,
  equipement: Hammer,
  remorque: Truck,
  "velo-electrique": Bike,
  autre: Wrench,
}

function cloneDefaultSettings(): PricingStrategySettings {
  return normalizePricingSettings(DEFAULT_PRICING_SETTINGS)
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}

function formatRule(rule: PricingStrategyRule): string {
  const meta = STRATEGY_META[rule.key]
  if (rule.key === "lowest_minus_amount") {
    return `${meta.label} · −${rule.amount ?? 0} $`
  }
  return meta.label
}

/** Puce numérotée devant les titres de section : rend l'ordre du flux
    explicite (1 règle → 2 dashboard → 3 exceptions). */
function StepChip({ n }: { n: number }) {
  return (
    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-orange-600 text-[11px] font-bold text-white">
      {n}
    </span>
  )
}

function StrategyCard({
  strategyKey,
  selected,
  onSelect,
}: {
  strategyKey: PricingStrategyKey
  selected: boolean
  onSelect: () => void
}) {
  const meta = STRATEGY_META[strategyKey]
  const Icon = meta.icon
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`group relative flex flex-col text-left rounded-2xl border p-5 transition-all duration-150 ${
        selected
          ? "border-orange-500/70 bg-orange-50/60 dark:bg-orange-500/10 shadow-[0_0_0_3px_rgba(249,115,22,0.12)]"
          : "border-[var(--color-border-tertiary)] bg-[var(--color-background-primary)] hover:border-[var(--color-border-secondary)] hover:bg-[var(--color-background-hover)]"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div
          className={`flex h-10 w-10 items-center justify-center rounded-xl transition ${
            selected
              ? "bg-orange-500 text-white"
              : "bg-[var(--color-background-secondary)] text-[var(--color-text-primary)] group-hover:bg-[var(--color-background-hover)]"
          }`}
        >
          <Icon className="h-5 w-5" />
        </div>
        <div
          className={`flex h-5 w-5 items-center justify-center rounded-full border-2 transition ${
            selected
              ? "border-orange-500 bg-orange-500 text-white"
              : "border-[var(--color-border-secondary)]"
          }`}
        >
          {selected && <Check className="h-3 w-3" strokeWidth={3} />}
        </div>
      </div>
      <h3 className="mt-4 text-base font-semibold leading-snug text-[var(--color-text-primary)]">
        {meta.label}
      </h3>
      <p className="mt-1.5 text-sm text-[var(--color-text-secondary)]">
        {meta.tagline}
      </p>
      <p className="mt-4 pt-3 border-t border-dashed border-[var(--color-border-tertiary)] text-xs text-[var(--color-text-tertiary)]">
        {meta.example}
      </p>
    </button>
  )
}

function Switch({
  checked,
  onChange,
  ariaLabel,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  ariaLabel?: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={event => {
        event.preventDefault()
        onChange(!checked)
      }}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-2 ${
        checked ? "bg-orange-600" : "bg-[var(--color-background-secondary)] border border-[var(--color-border-tertiary)]"
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform ${
          checked ? "translate-x-6" : "translate-x-1"
        }`}
      />
    </button>
  )
}

export default function PricingStrategyPage() {
  const [settings, setSettings] = useState<PricingStrategySettings>(cloneDefaultSettings)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [setupWarning, setSetupWarning] = useState<string | null>(null)
  const [expandedVehicle, setExpandedVehicle] = useState<VehicleType | null>(null)
  const [showCustom, setShowCustom] = useState(false)

  const overrideCount = useMemo(
    () => Object.keys(settings.vehicle_type_strategies).length,
    [settings.vehicle_type_strategies]
  )

  // La personnalisation par type est repliée par défaut (c'est un réglage
  // avancé) — sauf si l'utilisateur a déjà des exceptions actives.
  useEffect(() => {
    if (!loading && overrideCount > 0) setShowCustom(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading])

  // Étapes du guide de première visite. L'étape « écart » n'existe que si
  // la règle active est « Sous le plus bas ».
  const onboardingSteps = useMemo<PageOnboardingStep[]>(() => {
    const steps: PageOnboardingStep[] = [
      {
        targetId: "pricing-rule",
        title: "Choisissez votre règle",
        description:
          "Trois façons de vous positionner face aux prix de vos concurrents. Un clic suffit — la sauvegarde est automatique, et vous gardez toujours le dernier mot avant qu'un prix change.",
      },
    ]
    if (settings.default_strategy.key === "lowest_minus_amount") {
      steps.push({
        targetId: "pricing-amount",
        title: "Réglez l'écart",
        description:
          "De combien voulez-vous passer sous le prix le plus bas ? Un petit écart (1 $) suffit à être premier tout en protégeant votre marge.",
      })
    }
    steps.push(
      {
        targetId: "pricing-apply",
        title: "Affichez les recommandations",
        description:
          "Activez ce commutateur pour voir la colonne « prix recommandé » directement dans votre tableau de surveillance, à chaque ouverture.",
      },
      {
        targetId: "pricing-custom",
        title: "Personnalisez par type (optionnel)",
        description:
          "Besoin d'une règle différente pour vos motoneiges et vos motos ? Ouvrez cette section pour définir des exceptions — tout le reste suit la règle principale.",
      },
    )
    return steps
  }, [settings.default_strategy.key])

  const persistTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latestSettingsRef = useRef<PricingStrategySettings>(settings)
  latestSettingsRef.current = settings

  const persist = useCallback(async (snapshot: PricingStrategySettings) => {
    setSaving(true)
    setError(null)
    try {
      const response = await fetch("/api/pricing/strategy", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: snapshot }),
      })
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data?.error || "Impossible de sauvegarder la stratégie.")
      }
      setSetupWarning(null)
      setSavedAt(Date.now())
    } catch (err: unknown) {
      const message = getErrorMessage(err, "Erreur réseau.")
      setError(message)
      toast.error(message, { duration: 5000 })
    } finally {
      setSaving(false)
    }
  }, [])

  const schedulePersist = useCallback(
    (snapshot: PricingStrategySettings, delay = 350) => {
      if (persistTimeoutRef.current) {
        clearTimeout(persistTimeoutRef.current)
      }
      persistTimeoutRef.current = setTimeout(() => {
        void persist(latestSettingsRef.current ?? snapshot)
      }, delay)
    },
    [persist]
  )

  useEffect(() => {
    return () => {
      if (persistTimeoutRef.current) clearTimeout(persistTimeoutRef.current)
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    async function loadSettings() {
      setLoading(true)
      setError(null)
      setSetupWarning(null)
      try {
        const response = await fetch("/api/pricing/strategy", { cache: "no-store" })
        const data = await response.json()
        if (!response.ok) {
          throw new Error(data?.error || "Impossible de charger la stratégie.")
        }
        if (!cancelled) {
          setSettings(normalizePricingSettings(data?.settings))
          setSetupWarning(data?.setupRequired ? data?.message || "Migration Supabase requise." : null)
        }
      } catch (err: unknown) {
        if (!cancelled) {
          setError(getErrorMessage(err, "Erreur réseau."))
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void loadSettings()
    return () => {
      cancelled = true
    }
  }, [])

  const applyChange = useCallback(
    (
      mutator: (prev: PricingStrategySettings) => PricingStrategySettings,
      options?: { debounce?: boolean }
    ) => {
      setSettings(prev => {
        const next = mutator(prev)
        if (options?.debounce) {
          schedulePersist(next, 500)
        } else {
          if (persistTimeoutRef.current) clearTimeout(persistTimeoutRef.current)
          void persist(next)
        }
        return next
      })
    },
    [persist, schedulePersist]
  )

  const updateDefaultStrategy = (key: PricingStrategyKey) => {
    applyChange(prev => ({
      ...prev,
      default_strategy: normalizeStrategyRule({
        key,
        amount: key === "lowest_minus_amount" ? prev.default_strategy.amount ?? 1 : undefined,
      }),
    }))
  }

  const updateDefaultAmount = (amount: number, options?: { debounce?: boolean }) => {
    applyChange(
      prev => ({
        ...prev,
        default_strategy: normalizeStrategyRule({ key: prev.default_strategy.key, amount }),
      }),
      options
    )
  }

  const setApplyEnabled = (enabled: boolean) => {
    applyChange(prev => ({ ...prev, apply_enabled: enabled }))
  }

  const updateVehicleStrategy = (
    vehicleType: VehicleType,
    rule: PricingStrategyRule | null,
    options?: { debounce?: boolean }
  ) => {
    applyChange(prev => {
      const nextStrategies = { ...prev.vehicle_type_strategies }
      if (rule) {
        nextStrategies[vehicleType] = normalizeStrategyRule(rule)
      } else {
        delete nextStrategies[vehicleType]
      }
      return { ...prev, vehicle_type_strategies: nextStrategies }
    }, options)
  }

  const activeMeta = STRATEGY_META[settings.default_strategy.key]
  const ActiveIcon = activeMeta.icon

  return (
    <Layout>
      <section className="mb-8 flex items-start justify-between gap-4 flex-wrap">
        <div className="max-w-2xl">
          <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">
            Stratégie de pricing
          </h1>
          <p className="mt-1.5 text-sm text-[var(--color-text-secondary)]">
            La règle que GO-DATA applique pour vous proposer un prix face à la concurrence.
            Vous gardez toujours le dernier mot avant qu'un prix change.
          </p>
          {!loading && (
            <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-orange-200 bg-orange-50 px-3 py-1 text-xs font-semibold text-orange-700 dark:border-orange-900/50 dark:bg-orange-950/30 dark:text-orange-300">
              <ActiveIcon className="h-3.5 w-3.5" />
              Règle active : {formatRule(settings.default_strategy)}
            </div>
          )}
        </div>
        {!loading && (
          <div className="flex items-center gap-2">
            <div
              aria-live="polite"
              className="inline-flex items-center gap-1.5 h-9 px-3 text-xs font-medium text-[var(--color-text-secondary)]"
            >
              {saving ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Sauvegarde…
                </>
              ) : savedAt ? (
                <>
                  <Check className="h-3.5 w-3.5 text-orange-600" />
                  Modifications enregistrées
                </>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => replayPageOnboarding("strategie-pricing")}
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-[var(--color-border-tertiary)] text-xs font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-background-hover)] transition-colors"
            >
              <HelpCircle className="h-3.5 w-3.5" />
              Revoir le guide
            </button>
          </div>
        )}
      </section>

      <PageOnboarding
        pageKey="strategie-pricing"
        ready={!loading}
        steps={onboardingSteps}
      />

      {error && (
        <div className="mb-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/20 dark:text-red-300">
          {error}
        </div>
      )}

      {setupWarning && (
        <div className="mb-5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-200">
          {setupWarning}
        </div>
      )}

      {loading ? (
        <div className="rounded-xl border border-[var(--color-border-tertiary)] bg-[var(--color-background-primary)] p-8 text-sm text-[var(--color-text-secondary)]">
          <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
          Chargement…
        </div>
      ) : (
        <div className="space-y-7">
          {/* ── Étape 1 : la règle principale (+ son écart, qui en fait
              partie visuellement — ce n'est pas une étape séparée). ── */}
          <section id="pricing-rule" className="space-y-3">
            <div className="flex items-center gap-2.5">
              <StepChip n={1} />
              <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">
                Choisissez votre règle
              </h2>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              {STRATEGY_ORDER.map(key => (
                <StrategyCard
                  key={key}
                  strategyKey={key}
                  selected={settings.default_strategy.key === key}
                  onSelect={() => updateDefaultStrategy(key)}
                />
              ))}
            </div>

          {settings.default_strategy.key === "lowest_minus_amount" && (
            <div id="pricing-amount" className="flex flex-wrap items-center gap-3 rounded-xl border border-orange-500/25 bg-orange-50/40 dark:bg-orange-500/[0.06] px-5 py-4">
              <div className="flex items-center gap-3 flex-1 min-w-[200px]">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-orange-500/10 text-orange-700 dark:text-orange-300">
                  <TrendingDown className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-[var(--color-text-primary)]">
                    Combien sous le plus bas prix&nbsp;?
                  </p>
                  <p className="mt-0.5 text-xs text-[var(--color-text-secondary)]">
                    Plus l'écart est petit, plus votre marge est protégée.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {[1, 25, 50, 100].map(preset => {
                  const active = (settings.default_strategy.amount ?? 0) === preset
                  return (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => updateDefaultAmount(preset)}
                      className={`h-9 px-3 rounded-lg text-sm font-semibold transition ${
                        active
                          ? "bg-orange-600 text-white"
                          : "bg-[var(--color-background-primary)] border border-[var(--color-border-tertiary)] text-[var(--color-text-primary)] hover:bg-[var(--color-background-hover)]"
                      }`}
                    >
                      {preset} $
                    </button>
                  )
                })}
                <div className="flex items-center gap-1.5 rounded-lg border border-[var(--color-border-tertiary)] bg-[var(--color-background-primary)] px-2.5 h-9">
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={settings.default_strategy.amount ?? 1}
                    onChange={event => updateDefaultAmount(Number(event.target.value), { debounce: true })}
                    className="w-16 bg-transparent text-sm font-semibold tabular-nums text-[var(--color-text-primary)] focus:outline-none"
                  />
                  <span className="text-sm text-[var(--color-text-secondary)]">$</span>
                </div>
              </div>
            </div>
          )}
          </section>

          {/* ── Étape 2 : affichage dans le dashboard ── */}
          <section id="pricing-apply" className="space-y-3">
            <div className="flex items-center gap-2.5">
              <StepChip n={2} />
              <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">
                Affichez les recommandations
              </h2>
            </div>
            <div className="flex items-center justify-between gap-4 rounded-xl border border-[var(--color-border-tertiary)] bg-[var(--color-background-primary)] px-5 py-4">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--color-background-secondary)] text-[var(--color-text-primary)]">
                  <Sliders className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-[var(--color-text-primary)]">
                    Afficher les recommandations dans le dashboard
                  </p>
                  <p className="mt-0.5 text-xs text-[var(--color-text-secondary)]">
                    Active automatiquement la colonne « prix recommandé » à l'ouverture.
                  </p>
                </div>
              </div>
              <Switch
                checked={settings.apply_enabled}
                onChange={setApplyEnabled}
                ariaLabel="Afficher les recommandations dans le dashboard"
              />
            </div>
          </section>

          {/* ── Étape 3 (optionnelle) : exceptions par type de véhicule.
              Repliée par défaut — c'est un réglage avancé qui noyait la
              page quand ses 12 lignes étaient toujours visibles. ── */}
          <section id="pricing-custom" className="space-y-3">
            <div className="flex items-center gap-2.5">
              <StepChip n={3} />
              <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">
                Personnalisez par type de véhicule
              </h2>
              <span className="text-xs text-[var(--color-text-tertiary)]">optionnel</span>
            </div>
            <div className="rounded-xl border border-[var(--color-border-tertiary)] bg-[var(--color-background-primary)] overflow-hidden">
            <button
              type="button"
              onClick={() => setShowCustom(v => !v)}
              aria-expanded={showCustom}
              className={`flex w-full items-center gap-3 px-5 py-4 text-left transition-colors hover:bg-[var(--color-background-hover)] ${
                showCustom ? "border-b border-[var(--color-border-tertiary)]" : ""
              }`}
            >
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--color-background-secondary)] text-[var(--color-text-primary)]">
                <Cog className="h-4 w-4" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-[var(--color-text-primary)]">
                  Règles par type de véhicule
                </p>
                <p className="mt-0.5 text-xs text-[var(--color-text-secondary)]">
                  {overrideCount === 0
                    ? "Tous les véhicules suivent la stratégie principale."
                    : `${overrideCount} type${overrideCount > 1 ? "s" : ""} avec règle personnalisée.`}
                </p>
              </div>
              <ChevronDown
                className={`h-4 w-4 shrink-0 text-[var(--color-text-secondary)] transition-transform ${
                  showCustom ? "rotate-180" : ""
                }`}
              />
            </button>

            {showCustom && (
            <div className="divide-y divide-[var(--color-border-tertiary)]">
              {VEHICLE_TYPES.filter(type => type !== "autre").map(vehicleType => {
                const override = settings.vehicle_type_strategies[vehicleType]
                const Icon = VEHICLE_ICON[vehicleType]
                const isExpanded = expandedVehicle === vehicleType
                const activeRule = override || settings.default_strategy
                const RuleIcon = STRATEGY_META[activeRule.key].icon

                return (
                  <div key={vehicleType} className="px-5 py-3">
                    <button
                      type="button"
                      onClick={() => setExpandedVehicle(isExpanded ? null : vehicleType)}
                      className="flex w-full items-center justify-between gap-4 text-left"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div
                          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                            override
                              ? "bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300"
                              : "bg-[var(--color-background-secondary)] text-[var(--color-text-secondary)]"
                          }`}
                        >
                          <Icon className="h-4 w-4" />
                        </div>
                        <p className="text-sm font-semibold text-[var(--color-text-primary)] truncate">
                          {VEHICLE_TYPE_LABELS[vehicleType]}
                        </p>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <span
                          className={`hidden sm:inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                            override
                              ? "bg-orange-500/10 text-orange-700 dark:text-orange-300"
                              : "bg-[var(--color-background-secondary)] text-[var(--color-text-secondary)]"
                          }`}
                        >
                          <RuleIcon className="h-3 w-3" />
                          {override ? formatRule(activeRule) : "Stratégie globale"}
                        </span>
                        <ChevronDown
                          className={`h-4 w-4 text-[var(--color-text-secondary)] transition-transform ${
                            isExpanded ? "rotate-180" : ""
                          }`}
                        />
                      </div>
                    </button>

                    {isExpanded && (
                      <div className="mt-4 space-y-3 rounded-lg bg-[var(--color-background-secondary)]/40 p-4">
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => updateVehicleStrategy(vehicleType, null)}
                            className={`h-9 px-3 rounded-lg text-sm font-medium transition ${
                              !override
                                ? "bg-[var(--color-text-primary)] text-[var(--color-background-primary)]"
                                : "bg-[var(--color-background-primary)] border border-[var(--color-border-tertiary)] text-[var(--color-text-primary)] hover:bg-[var(--color-background-hover)]"
                            }`}
                          >
                            Globale
                          </button>
                          {STRATEGY_ORDER.map(key => {
                            const meta = STRATEGY_META[key]
                            const MetaIcon = meta.icon
                            const active = override?.key === key
                            return (
                              <button
                                key={key}
                                type="button"
                                onClick={() =>
                                  updateVehicleStrategy(vehicleType, {
                                    key,
                                    amount:
                                      key === "lowest_minus_amount"
                                        ? override?.amount ?? settings.default_strategy.amount ?? 1
                                        : undefined,
                                  })
                                }
                                className={`inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-sm font-medium transition ${
                                  active
                                    ? "bg-orange-600 text-white"
                                    : "bg-[var(--color-background-primary)] border border-[var(--color-border-tertiary)] text-[var(--color-text-primary)] hover:bg-[var(--color-background-hover)]"
                                }`}
                              >
                                <MetaIcon className="h-3.5 w-3.5" />
                                {meta.label}
                              </button>
                            )
                          })}
                        </div>

                        {override?.key === "lowest_minus_amount" && (
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs text-[var(--color-text-secondary)]">
                              Sous le plus bas de
                            </span>
                            <div className="flex items-center gap-1.5 rounded-lg border border-[var(--color-border-tertiary)] bg-[var(--color-background-primary)] px-2.5 h-9">
                              <input
                                type="number"
                                min={0}
                                step={1}
                                value={override.amount ?? 1}
                                onChange={event =>
                                  updateVehicleStrategy(
                                    vehicleType,
                                    {
                                      key: "lowest_minus_amount",
                                      amount: Number(event.target.value),
                                    },
                                    { debounce: true }
                                  )
                                }
                                className="w-16 bg-transparent text-sm font-semibold tabular-nums text-[var(--color-text-primary)] focus:outline-none"
                              />
                              <span className="text-sm text-[var(--color-text-secondary)]">$</span>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
            )}
            </div>
          </section>
        </div>
      )}
    </Layout>
  )
}
