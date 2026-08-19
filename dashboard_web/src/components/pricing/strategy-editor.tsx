"use client"

/**
 * Éditeur de stratégie de pricing — composant UNIQUE partagé entre
 * /dashboard/strategie-pricing (compte réel, persistance API) et les pages
 * démo (/falardeau, /smsport, … — état éphémère). Une seule implémentation :
 * les trois cartes de règle, le montant, et les exceptions par type de
 * véhicule. La persistance, le toggle d'affichage et les CTA restent dans
 * les pages appelantes.
 */

import { useState } from "react"
import { ChevronDown, Scale, Target, TrendingDown, type LucideIcon } from "lucide-react"

import {
  VEHICLE_TYPE_LABELS,
  VEHICLE_TYPES,
  normalizePricingSettings,
  type PricingStrategyKey,
  type PricingStrategySettings,
  type VehicleType,
} from "@/lib/pricing-strategy"

export const STRATEGY_META: Record<PricingStrategyKey, { label: string; tagline: string; icon: LucideIcon }> = {
  lowest_minus_amount: { label: "Sous le plus bas", tagline: "Battre le concurrent le moins cher.", icon: TrendingDown },
  match_lowest: { label: "Égaler le plus bas", tagline: "Rester compétitif sans rogner la marge.", icon: Target },
  market_average: { label: "Moyenne du marché", tagline: "Équilibre entre marge et compétitivité.", icon: Scale },
}
export const STRATEGY_ORDER: PricingStrategyKey[] = ["lowest_minus_amount", "match_lowest", "market_average"]

const AMOUNT_PRESETS = [1, 25, 50, 100]

export default function StrategyEditor({
  settings,
  onChange,
  vehicleTypes,
}: {
  settings: PricingStrategySettings
  /** Reçoit des settings déjà normalisés. `debounce` = saisie clavier en cours. */
  onChange: (next: PricingStrategySettings, options?: { debounce?: boolean }) => void
  /** Types affichés dans les exceptions (démo : ceux présents dans les données). */
  vehicleTypes?: VehicleType[]
}) {
  const types = vehicleTypes ?? VEHICLE_TYPES.filter(t => t !== "autre")
  const overrideCount = Object.keys(settings.vehicle_type_strategies).length
  const [showExceptions, setShowExceptions] = useState(overrideCount > 0)

  const defaultKey = settings.default_strategy.key
  const amount = settings.default_strategy.amount ?? 1

  const setDefault = (key: PricingStrategyKey) =>
    onChange(normalizePricingSettings({
      ...settings,
      default_strategy: key === "lowest_minus_amount" ? { key, amount } : { key },
    }))

  const setAmount = (next: number, options?: { debounce?: boolean }) =>
    onChange(normalizePricingSettings({
      ...settings,
      default_strategy: { key: "lowest_minus_amount", amount: Math.max(0, next) },
    }), options)

  const setOverride = (vt: VehicleType, key: PricingStrategyKey | "default") => {
    const overrides = { ...settings.vehicle_type_strategies }
    if (key === "default") delete overrides[vt]
    else overrides[vt] = key === "lowest_minus_amount" ? { key, amount: overrides[vt]?.amount ?? amount } : { key }
    onChange(normalizePricingSettings({ ...settings, vehicle_type_strategies: overrides }))
  }

  const setOverrideAmount = (vt: VehicleType, next: number) => {
    const overrides = { ...settings.vehicle_type_strategies }
    overrides[vt] = { key: "lowest_minus_amount", amount: Math.max(0, next) }
    onChange(normalizePricingSettings({ ...settings, vehicle_type_strategies: overrides }), { debounce: true })
  }

  return (
    <div className="space-y-3">
      {/* ── Les trois règles ── */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {STRATEGY_ORDER.map(key => {
          const meta = STRATEGY_META[key]
          const Icon = meta.icon
          const selected = defaultKey === key
          return (
            <button
              key={key}
              type="button"
              onClick={() => setDefault(key)}
              aria-pressed={selected}
              className={`rounded-xl border p-4 text-left transition-all ${
                selected
                  ? "border-orange-600 bg-orange-50 ring-1 ring-orange-600 dark:border-orange-400 dark:bg-orange-400/10 dark:ring-orange-400"
                  : "border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] hover:border-gray-300 dark:hover:border-white/20"
              }`}
            >
              <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${
                selected ? "bg-orange-600 text-white dark:bg-orange-400 dark:text-black" : "bg-[var(--color-background-secondary)] text-[var(--color-text-secondary)]"
              }`}>
                <Icon className="h-4 w-4" />
              </span>
              <p className="mt-2.5 text-[14px] font-semibold text-[var(--color-text-primary)]">{meta.label}</p>
              <p className="mt-0.5 text-[12px] leading-relaxed text-[var(--color-text-secondary)]">{meta.tagline}</p>
            </button>
          )
        })}
      </div>

      {/* ── Montant (uniquement pour « Sous le plus bas ») ── */}
      {defaultKey === "lowest_minus_amount" && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-4 py-3">
          <p className="text-[13px] font-medium text-[var(--color-text-primary)]">
            Montant sous le plus bas :
          </p>
          <div className="flex items-center gap-1.5">
            {AMOUNT_PRESETS.map(preset => (
              <button
                key={preset}
                type="button"
                onClick={() => setAmount(preset)}
                className={`h-8 px-2.5 rounded-lg text-[13px] font-semibold tabular-nums transition ${
                  amount === preset
                    ? "bg-orange-600 text-white dark:bg-orange-400 dark:text-black"
                    : "border border-[var(--color-border-secondary)] text-[var(--color-text-primary)] hover:bg-[var(--color-background-hover)]"
                }`}
              >
                {preset} $
              </button>
            ))}
            <div className="flex h-8 items-center gap-1 rounded-lg border border-[var(--color-border-secondary)] px-2">
              <input
                type="number"
                min={0}
                step={1}
                value={amount}
                onChange={e => setAmount(Number(e.target.value), { debounce: true })}
                aria-label="Montant personnalisé sous le plus bas prix"
                className="w-14 bg-transparent text-[13px] font-semibold tabular-nums text-[var(--color-text-primary)] focus:outline-none"
              />
              <span className="text-[12px] text-[var(--color-text-secondary)]">$</span>
            </div>
          </div>
        </div>
      )}

      {/* ── Exceptions par type de véhicule (repliées par défaut) ── */}
      <div className="overflow-hidden rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)]">
        <button
          type="button"
          onClick={() => setShowExceptions(v => !v)}
          aria-expanded={showExceptions}
          className={`flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--color-background-hover)] ${
            showExceptions ? "border-b border-[var(--color-border-tertiary)]" : ""
          }`}
        >
          <div>
            <p className="text-[13px] font-semibold text-[var(--color-text-primary)]">Exceptions par type de véhicule</p>
            <p className="mt-0.5 text-[12px] text-[var(--color-text-secondary)]">
              {overrideCount === 0
                ? "Optionnel — la règle ci-dessus s'applique partout."
                : `${overrideCount} type${overrideCount > 1 ? "s" : ""} avec règle différente.`}
            </p>
          </div>
          <ChevronDown className={`h-4 w-4 shrink-0 text-[var(--color-text-secondary)] transition-transform ${showExceptions ? "rotate-180" : ""}`} />
        </button>

        {showExceptions && (
          <div className="divide-y divide-[var(--color-border-tertiary)]">
            {types.map(vt => {
              const override = settings.vehicle_type_strategies[vt]
              return (
                <div key={vt} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                  <span className={`text-[13px] font-medium ${override ? "text-[var(--color-text-primary)]" : "text-[var(--color-text-secondary)]"}`}>
                    {VEHICLE_TYPE_LABELS[vt] || vt}
                  </span>
                  <div className="flex items-center gap-1.5">
                    {override?.key === "lowest_minus_amount" && (
                      <div className="flex h-8 items-center gap-1 rounded-lg border border-[var(--color-border-secondary)] px-2">
                        <span className="text-[12px] text-[var(--color-text-secondary)]">−</span>
                        <input
                          type="number"
                          min={0}
                          step={1}
                          value={override.amount ?? 1}
                          onChange={e => setOverrideAmount(vt, Number(e.target.value))}
                          aria-label={`Montant sous le plus bas pour ${VEHICLE_TYPE_LABELS[vt]}`}
                          className="w-12 bg-transparent text-[12px] font-semibold tabular-nums text-[var(--color-text-primary)] focus:outline-none"
                        />
                        <span className="text-[12px] text-[var(--color-text-secondary)]">$</span>
                      </div>
                    )}
                    <select
                      value={override?.key ?? "default"}
                      onChange={e => setOverride(vt, e.target.value as PricingStrategyKey | "default")}
                      aria-label={`Règle pour ${VEHICLE_TYPE_LABELS[vt]}`}
                      className="h-8 rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-2 text-[12px] text-[var(--color-text-primary)] focus:border-orange-500 focus:outline-none"
                    >
                      <option value="default">Règle par défaut</option>
                      {STRATEGY_ORDER.map(key => (
                        <option key={key} value={key}>{STRATEGY_META[key].label}</option>
                      ))}
                    </select>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
