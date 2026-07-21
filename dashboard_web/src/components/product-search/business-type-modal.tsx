"use client"

import { useState, useEffect, useCallback, useMemo } from "react"
import {
  Bike, Car, Anchor, Store, Shirt, Cpu, MoreHorizontal,
  Loader2, Check, Sparkles, X,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useAuth } from "@/contexts/auth-context"
import { useLanguage } from "@/contexts/language-context"
import {
  BUSINESS_TYPES,
  BUSINESS_TYPE_DEFAULT_CATEGORY,
  parseBusinessTypes,
  type BusinessType,
} from "@/lib/account-navigation"
import { toast } from "sonner"

const ICONS: Record<BusinessType, typeof Bike> = {
  recreational_vehicles: Bike,
  automotive: Car,
  marine: Anchor,
  sports_outdoor: Store,
  fashion: Shirt,
  electronics: Cpu,
  other: MoreHorizontal,
}

const LABEL_KEYS: Record<BusinessType, "register.bt.recreationalVehicles" | "register.bt.automotive" | "register.bt.marine" | "register.bt.sportsOutdoor" | "register.bt.fashion" | "register.bt.electronics" | "register.bt.other"> = {
  recreational_vehicles: "register.bt.recreationalVehicles",
  automotive: "register.bt.automotive",
  marine: "register.bt.marine",
  sports_outdoor: "register.bt.sportsOutdoor",
  fashion: "register.bt.fashion",
  electronics: "register.bt.electronics",
  other: "register.bt.other",
}

interface Props {
  open: boolean
  /** Valeurs initiales — peut être un BusinessType unique, une liste, ou la string "fashion,electronics". */
  initialValue?: BusinessType | BusinessType[] | string | null
  /** Si true, le modal ne peut pas être fermé sans choisir (premier onboarding). */
  required?: boolean
  /** Appelé à la confirmation. Reçoit la liste des business_types choisis. */
  onConfirm: (businessTypes: BusinessType[]) => Promise<void> | void
  /** Appelé si l'utilisateur ferme le modal sans confirmer (uniquement si !required). */
  onDismiss?: () => void
}

/**
 * Modal d'onboarding pour /dashboard/recherche.
 *
 * Multi-sélection : un utilisateur peut combiner plusieurs domaines
 * (ex: "concessionnaire moto + accessoires électroniques").
 *
 * - Au premier visit, force l'utilisateur à préciser au moins un domaine.
 * - Peut être ré-ouvert via le bouton "Changer mon domaine" pour modifier.
 */
export default function BusinessTypeOnboardingModal({
  open,
  initialValue,
  required = false,
  onConfirm,
  onDismiss,
}: Props) {
  const { t } = useLanguage()
  const { refreshUser } = useAuth()
  const initialList = useMemo(() => parseBusinessTypes(initialValue ?? null), [initialValue])
  const [selected, setSelected] = useState<Set<BusinessType>>(new Set(initialList))
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) setSelected(new Set(initialList))
  }, [open, initialList])

  const toggle = useCallback((bt: BusinessType) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(bt)) next.delete(bt)
      else next.add(bt)
      return next
    })
  }, [])

  const handleConfirm = useCallback(async () => {
    if (selected.size === 0) return
    const arr = BUSINESS_TYPES.filter((bt) => selected.has(bt))
    setSaving(true)
    try {
      const res = await fetch("/api/users/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ business_types: arr }),
      })
      if (res.status === 401) {
        toast.error("Session expirée — reconnecte-toi pour sauvegarder")
        if (typeof window !== "undefined") {
          setTimeout(() => {
            window.location.href = `/login?next=${encodeURIComponent("/dashboard/recherche")}`
          }, 1200)
        }
        return
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.error || `HTTP ${res.status}`)
      }
      await refreshUser()
      await onConfirm(arr)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      toast.error(`Impossible de sauvegarder : ${msg}`)
    } finally {
      setSaving(false)
    }
  }, [selected, refreshUser, onConfirm])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div
        className={cn(
          "w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden",
          "bg-[var(--color-background-primary)] border border-[var(--color-border-secondary)]",
          "max-h-[90vh] flex flex-col",
        )}
        role="dialog"
        aria-modal="true"
        aria-labelledby="bt-modal-title"
      >
        {/* Header */}
        <div className="px-6 py-5 border-b border-[var(--color-border-secondary)] flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-orange-600 dark:text-orange-400 text-xs font-semibold uppercase tracking-wide mb-1.5">
              <Sparkles className="h-3.5 w-3.5" />
              <span>Recherche par produit</span>
            </div>
            <h2
              id="bt-modal-title"
              className="text-xl font-bold text-[var(--color-text-primary)] leading-snug"
            >
              Dans quels domaines recherches-tu des produits&nbsp;?
            </h2>
            <p className="mt-1.5 text-sm text-[var(--color-text-secondary)] leading-relaxed">
              Coche tous ceux qui s&apos;appliquent. On utilise ta réponse pour pré-sélectionner
              la catégorie la plus pertinente. Tu pourras toujours en choisir une autre au cas
              par cas, et changer ce réglage plus tard depuis ton profil.
            </p>
          </div>
          {!required && onDismiss && (
            <button
              type="button"
              onClick={onDismiss}
              className="shrink-0 p-1.5 rounded-lg text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-background-hover)]"
              aria-label="Fermer"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Liste des choix */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {BUSINESS_TYPES.map((bt) => {
              const Icon = ICONS[bt]
              const isSelected = selected.has(bt)
              return (
                <button
                  key={bt}
                  type="button"
                  onClick={() => toggle(bt)}
                  role="checkbox"
                  aria-checked={isSelected}
                  className={cn(
                    "group relative text-left p-3 rounded-xl border transition-all",
                    "focus:outline-none focus:ring-2 focus:ring-orange-500/30",
                    isSelected
                      ? "border-orange-500 bg-orange-50/60 dark:bg-orange-500/[0.08] ring-1 ring-orange-500/20"
                      : "border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] hover:border-orange-400/40 hover:bg-[var(--color-background-hover)]",
                  )}
                >
                  <div className="flex items-center gap-3">
                    {/* Checkbox visuel */}
                    <span
                      className={cn(
                        "shrink-0 w-4 h-4 rounded border flex items-center justify-center transition-colors",
                        isSelected
                          ? "bg-orange-600 border-orange-600"
                          : "bg-[var(--color-background-primary)] border-[var(--color-border-secondary)] group-hover:border-orange-400",
                      )}
                    >
                      {isSelected && <Check className="h-3 w-3 text-white" strokeWidth={3} />}
                    </span>

                    <Icon
                      className={cn(
                        "h-4 w-4 shrink-0 transition-colors",
                        isSelected
                          ? "text-orange-700 dark:text-orange-300"
                          : "text-[var(--color-text-secondary)]",
                      )}
                    />

                    <span className="text-sm font-medium text-[var(--color-text-primary)] truncate flex-1">
                      {t(LABEL_KEYS[bt])}
                    </span>
                  </div>
                </button>
              )
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] flex items-center justify-between gap-3">
          <p className="text-[11.5px] text-[var(--color-text-tertiary)] flex-1 min-w-0">
            {selected.size === 0
              ? "Sélectionne au moins un domaine pour continuer."
              : selected.size === 1
                ? "1 domaine sélectionné."
                : `${selected.size} domaines sélectionnés.`}
          </p>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={selected.size === 0 || saving}
            className={cn(
              "inline-flex items-center justify-center gap-2 px-5 py-2 rounded-lg font-semibold text-sm transition-colors shrink-0",
              "bg-orange-600 text-white hover:bg-orange-700",
              "disabled:opacity-50 disabled:cursor-not-allowed",
              "shadow-sm shadow-orange-600/20",
            )}
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            {saving ? "Sauvegarde…" : "Confirmer"}
          </button>
        </div>
      </div>
    </div>
  )
}

// Re-export pour pratique côté consommateur
export { BUSINESS_TYPE_DEFAULT_CATEGORY }
