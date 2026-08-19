"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Layout from "@/components/kokonutui/layout"
import StrategyEditor from "@/components/pricing/strategy-editor"
import {
  DEFAULT_PRICING_SETTINGS,
  normalizePricingSettings,
  type PricingStrategySettings,
} from "@/lib/pricing-strategy"
import { Check, Loader2, Sliders } from "lucide-react"
import { toast } from "sonner"

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
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
  const [settings, setSettings] = useState<PricingStrategySettings>(() =>
    normalizePricingSettings(DEFAULT_PRICING_SETTINGS))
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [setupWarning, setSetupWarning] = useState<string | null>(null)

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

  const applyChange = useCallback(
    (next: PricingStrategySettings, options?: { debounce?: boolean }) => {
      setSettings(next)
      if (persistTimeoutRef.current) clearTimeout(persistTimeoutRef.current)
      if (options?.debounce) {
        persistTimeoutRef.current = setTimeout(() => {
          void persist(latestSettingsRef.current)
        }, 500)
      } else {
        void persist(next)
      }
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

  return (
    <Layout>
      <section className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div className="max-w-2xl">
          <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">
            Stratégie de pricing
          </h1>
          <p className="mt-1.5 text-sm text-[var(--color-text-secondary)]">
            Choisissez votre règle : les prix recommandés se recalculent partout dans le dashboard.
          </p>
        </div>
        {!loading && (
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
        )}
      </section>

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
        <div className="space-y-3">
          <StrategyEditor settings={settings} onChange={applyChange} />

          <div className="flex items-center justify-between gap-4 rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-4 py-3">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--color-background-secondary)] text-[var(--color-text-primary)]">
                <Sliders className="h-4 w-4" />
              </div>
              <div>
                <p className="text-[13px] font-semibold text-[var(--color-text-primary)]">
                  Toujours afficher les prix recommandés
                </p>
                <p className="mt-0.5 text-[12px] text-[var(--color-text-secondary)]">
                  La colonne « Prix recommandé » s&apos;active automatiquement à l&apos;ouverture du dashboard.
                </p>
              </div>
            </div>
            <Switch
              checked={settings.apply_enabled}
              onChange={enabled => applyChange({ ...settings, apply_enabled: enabled })}
              ariaLabel="Toujours afficher les prix recommandés"
            />
          </div>
        </div>
      )}
    </Layout>
  )
}
