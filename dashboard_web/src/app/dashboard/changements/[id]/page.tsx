"use client"

import { use, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import Layout from "@/components/kokonutui/layout"
import { toast } from "sonner"
import {
  ArrowLeft,
  Archive,
  Check,
  CheckCircle2,
  ClipboardList,
  ExternalLink,
  Loader2,
  Pencil,
  RotateCcw,
  Trash2,
  ChevronRight,
} from "lucide-react"
import { VEHICLE_TYPE_LABELS, type VehicleType } from "@/lib/pricing-strategy"

type ChangeSheet = {
  id: string
  name: string
  status: "pending" | "completed" | "archived"
  notes: string | null
  items_count: number
  applied_count: number
  created_at: string
  completed_at: string | null
}

type ChangeSheetItem = {
  id: string
  product_key: string
  product_name: string
  reference_url: string | null
  vehicle_type: VehicleType
  old_price: number | null
  new_price: number
  recommended_price?: number
  strategy_label: string | null
  applied: boolean
  applied_at: string | null
  basis?: { recommendedPrice?: number; difference?: number } | null
}

const STATUS_META: Record<ChangeSheet["status"], { label: string; className: string }> = {
  pending: {
    label: "À appliquer",
    className: "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300 border-amber-200 dark:border-amber-900/40",
  },
  completed: {
    label: "Terminée",
    className: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300 border-emerald-200 dark:border-emerald-900/40",
  },
  archived: {
    label: "Archivée",
    className: "bg-[var(--color-background-secondary)] text-[var(--color-text-secondary)] border-[var(--color-border-tertiary)]",
  },
}

function formatDate(iso: string) {
  try {
    const date = new Date(iso)
    return new Intl.DateTimeFormat("fr-CA", {
      day: "2-digit",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date)
  } catch {
    return iso
  }
}

function formatPrice(value: number | null) {
  if (value == null) return "—"
  return `${Math.round(value).toLocaleString("fr-CA")} $`
}

function getRecommendedPrice(item: ChangeSheetItem): number {
  const fromBasis = item.basis?.recommendedPrice
  if (typeof fromBasis === "number" && Number.isFinite(fromBasis)) return Math.round(fromBasis)
  return Math.round(item.new_price)
}

function PriceEditor({
  item,
  isSaving,
  disabled,
  onSave,
}: {
  item: ChangeSheetItem
  isSaving: boolean
  disabled: boolean
  onSave: (value: number) => void | Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<string>(String(Math.round(item.new_price)))
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!editing) setDraft(String(Math.round(item.new_price)))
  }, [item.new_price, editing])

  useEffect(() => {
    if (editing) {
      requestAnimationFrame(() => {
        inputRef.current?.focus()
        inputRef.current?.select()
      })
    }
  }, [editing])

  const recommended = getRecommendedPrice(item)
  const currentRounded = Math.round(item.new_price)
  const isCustom = currentRounded !== recommended

  const commit = () => {
    const value = Number(draft)
    if (Number.isFinite(value) && value >= 0 && Math.round(value) !== currentRounded) {
      void onSave(Math.round(value))
    }
    setEditing(false)
  }

  const cancel = () => {
    setDraft(String(currentRounded))
    setEditing(false)
  }

  const resetToRecommended = () => {
    if (recommended !== currentRounded) {
      void onSave(recommended)
    }
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1.5 rounded-lg border border-emerald-500 bg-[var(--color-background-primary)] px-2 h-9 shadow-sm">
        <input
          ref={inputRef}
          type="number"
          min={0}
          step={1}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Enter") {
              e.preventDefault()
              commit()
            } else if (e.key === "Escape") {
              e.preventDefault()
              cancel()
            }
          }}
          onBlur={commit}
          className="w-24 bg-transparent text-sm font-bold tabular-nums text-emerald-700 dark:text-emerald-300 focus:outline-none text-right"
        />
        <span className="text-sm text-[var(--color-text-secondary)]">$</span>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-1.5 shrink-0">
      <div className="flex flex-col items-end gap-0">
        <div className="flex items-center gap-1.5">
          <p className={`text-[10px] uppercase tracking-wider font-semibold ${isCustom ? "text-amber-700 dark:text-amber-300" : "text-emerald-700 dark:text-emerald-300"}`}>
            {isCustom ? "Modifié" : "Nouveau"}
          </p>
          {isCustom && (
            <button
              type="button"
              onClick={resetToRecommended}
              disabled={isSaving || disabled}
              className="text-[10px] font-medium text-[var(--color-text-secondary)] hover:text-emerald-700 dark:hover:text-emerald-300 transition disabled:opacity-50"
              title={`Restaurer le prix recommandé (${recommended.toLocaleString("fr-CA")} $)`}
            >
              ↺
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={() => !disabled && !isSaving && setEditing(true)}
          disabled={disabled || isSaving}
          className={`group inline-flex items-center gap-1 rounded-md px-1.5 -mr-1.5 py-0.5 transition ${
            disabled || isSaving
              ? "cursor-not-allowed opacity-60"
              : "cursor-text hover:bg-[var(--color-background-hover)]"
          }`}
          title={disabled ? "Désactivé : ligne déjà appliquée" : "Cliquer pour modifier"}
        >
          <span className={`text-sm font-bold tabular-nums ${isCustom ? "text-amber-700 dark:text-amber-300" : "text-emerald-700 dark:text-emerald-300"}`}>
            {formatPrice(item.new_price)}
          </span>
          {!disabled && !isSaving && (
            <Pencil className="h-3 w-3 text-[var(--color-text-tertiary)] opacity-0 group-hover:opacity-100 transition" />
          )}
          {isSaving && <Loader2 className="h-3 w-3 animate-spin text-[var(--color-text-tertiary)]" />}
        </button>
        {isCustom && (
          <p className="text-[10px] text-[var(--color-text-tertiary)] tabular-nums">
            Recommandé : {recommended.toLocaleString("fr-CA")} $
          </p>
        )}
      </div>
    </div>
  )
}

export default function ChangementDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = use(params)
  const router = useRouter()
  const [sheet, setSheet] = useState<ChangeSheet | null>(null)
  const [items, setItems] = useState<ChangeSheetItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [savingItemIds, setSavingItemIds] = useState<Set<string>>(new Set())
  const [updatingStatus, setUpdatingStatus] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function loadSheet() {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch(`/api/pricing/change-sheets/${id}`, { cache: "no-store" })
        const data = await res.json()
        if (!res.ok) {
          throw new Error(data?.error || "Impossible de charger la fiche.")
        }
        if (!cancelled) {
          setSheet(data?.sheet || null)
          setItems(Array.isArray(data?.items) ? data.items : [])
        }
      } catch (err: unknown) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Erreur réseau.")
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void loadSheet()
    return () => {
      cancelled = true
    }
  }, [id])

  const stats = useMemo(() => {
    const total = items.length
    const applied = items.filter(item => item.applied).length
    const remaining = total - applied
    return { total, applied, remaining }
  }, [items])

  const setItemApplied = async (item: ChangeSheetItem, applied: boolean) => {
    setSavingItemIds(prev => new Set(prev).add(item.id))
    setItems(prev =>
      prev.map(it => (it.id === item.id ? { ...it, applied, applied_at: applied ? new Date().toISOString() : null } : it))
    )
    try {
      const res = await fetch(`/api/pricing/change-sheets/${id}/items/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ applied }),
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data?.error || "Mise à jour impossible.")
      }
      if (sheet) {
        setSheet({
          ...sheet,
          applied_count: applied ? sheet.applied_count + 1 : sheet.applied_count - 1,
        })
      }
    } catch (err: unknown) {
      setItems(prev => prev.map(it => (it.id === item.id ? item : it)))
      toast.error(err instanceof Error ? err.message : "Erreur réseau.")
    } finally {
      setSavingItemIds(prev => {
        const next = new Set(prev)
        next.delete(item.id)
        return next
      })
    }
  }

  const updateItemPrice = async (item: ChangeSheetItem, newPrice: number) => {
    if (!Number.isFinite(newPrice) || newPrice < 0) {
      toast.error("Prix invalide.")
      return
    }
    if (Math.round(newPrice) === Math.round(item.new_price)) return
    setSavingItemIds(prev => new Set(prev).add(item.id))
    const previousPrice = item.new_price
    setItems(prev =>
      prev.map(it => (it.id === item.id ? { ...it, new_price: Math.round(newPrice) } : it))
    )
    try {
      const res = await fetch(`/api/pricing/change-sheets/${id}/items/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ new_price: Math.round(newPrice) }),
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data?.error || "Mise à jour impossible.")
      }
      if (data?.item) {
        setItems(prev => prev.map(it => (it.id === item.id ? { ...it, ...data.item } : it)))
      }
    } catch (err: unknown) {
      setItems(prev => prev.map(it => (it.id === item.id ? { ...it, new_price: previousPrice } : it)))
      toast.error(err instanceof Error ? err.message : "Erreur réseau.")
    } finally {
      setSavingItemIds(prev => {
        const next = new Set(prev)
        next.delete(item.id)
        return next
      })
    }
  }

  const updateSheetStatus = async (status: ChangeSheet["status"]) => {
    if (!sheet) return
    setUpdatingStatus(true)
    try {
      const res = await fetch(`/api/pricing/change-sheets/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data?.error || "Mise à jour impossible.")
      }
      setSheet(data?.sheet || sheet)
      toast.success(
        status === "completed"
          ? "Fiche marquée terminée"
          : status === "archived"
            ? "Fiche archivée"
            : "Fiche réouverte"
      )
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Erreur réseau.")
    } finally {
      setUpdatingStatus(false)
    }
  }

  const deleteSheet = async () => {
    if (!confirm("Supprimer définitivement cette fiche ? Cette action est irréversible.")) return
    setUpdatingStatus(true)
    try {
      const res = await fetch(`/api/pricing/change-sheets/${id}`, { method: "DELETE" })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.error || "Suppression impossible.")
      }
      toast.success("Fiche supprimée")
      router.push("/dashboard/changements")
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Erreur réseau.")
    } finally {
      setUpdatingStatus(false)
    }
  }

  return (
    <Layout>
      <section className="mb-6">
        <Link
          href="/dashboard/changements"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Toutes les fiches
        </Link>
        {sheet && (
          <div className="mt-3 flex items-start justify-between gap-4 flex-wrap">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-orange-500/10 text-orange-700 dark:text-orange-300">
                <ClipboardList className="h-5 w-5" />
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-xl font-bold text-[var(--color-text-primary)]">{sheet.name}</h1>
                  <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${STATUS_META[sheet.status].className}`}>
                    {STATUS_META[sheet.status].label}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-[var(--color-text-secondary)]">
                  Créée le {formatDate(sheet.created_at)}
                  {sheet.completed_at && ` · Terminée le ${formatDate(sheet.completed_at)}`}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {sheet.status === "pending" && (
                <button
                  type="button"
                  onClick={() => updateSheetStatus("completed")}
                  disabled={updatingStatus || stats.total === 0}
                  className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg bg-orange-600 text-white text-sm font-semibold hover:bg-orange-700 transition disabled:opacity-50"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  Marquer terminée
                </button>
              )}
              {sheet.status === "completed" && (
                <button
                  type="button"
                  onClick={() => updateSheetStatus("pending")}
                  disabled={updatingStatus}
                  className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg bg-[var(--color-background-primary)] border border-[var(--color-border-tertiary)] text-[var(--color-text-primary)] text-sm font-medium hover:bg-[var(--color-background-hover)] transition"
                >
                  <RotateCcw className="h-4 w-4" />
                  Réouvrir
                </button>
              )}
              {sheet.status !== "archived" && (
                <button
                  type="button"
                  onClick={() => updateSheetStatus("archived")}
                  disabled={updatingStatus}
                  className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg bg-[var(--color-background-primary)] border border-[var(--color-border-tertiary)] text-[var(--color-text-primary)] text-sm font-medium hover:bg-[var(--color-background-hover)] transition"
                >
                  <Archive className="h-4 w-4" />
                  Archiver
                </button>
              )}
              <button
                type="button"
                onClick={deleteSheet}
                disabled={updatingStatus}
                className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-red-600 hover:bg-red-50 dark:hover:bg-red-950/20 text-sm font-medium transition"
              >
                <Trash2 className="h-4 w-4" />
                Supprimer
              </button>
            </div>
          </div>
        )}
      </section>

      {error && (
        <div className="mb-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/20 dark:text-red-300">
          {error}
        </div>
      )}

      {loading ? (
        <div className="rounded-xl border border-[var(--color-border-tertiary)] bg-[var(--color-background-primary)] p-8 text-sm text-[var(--color-text-secondary)]">
          <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
          Chargement…
        </div>
      ) : sheet ? (
        <>
          <section className="mb-5 grid gap-3 grid-cols-3">
            <div className="rounded-xl border border-[var(--color-border-tertiary)] bg-[var(--color-background-primary)] px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-secondary)]">Total</p>
              <p className="mt-1 text-xl font-bold text-[var(--color-text-primary)] tabular-nums">{stats.total}</p>
            </div>
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 dark:border-emerald-900/40 dark:bg-emerald-950/20">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-300">Appliqués</p>
              <p className="mt-1 text-xl font-bold text-emerald-700 dark:text-emerald-300 tabular-nums">{stats.applied}</p>
            </div>
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-900/40 dark:bg-amber-950/20">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-300">Restants</p>
              <p className="mt-1 text-xl font-bold text-amber-700 dark:text-amber-300 tabular-nums">{stats.remaining}</p>
            </div>
          </section>

          <section className="rounded-xl border border-[var(--color-border-tertiary)] bg-[var(--color-background-primary)] overflow-hidden">
            {items.length === 0 ? (
              <div className="p-8 text-center text-sm text-[var(--color-text-secondary)]">
                Aucun produit dans cette fiche.
              </div>
            ) : (
              <div className="divide-y divide-[var(--color-border-tertiary)]">
                {items.map(item => {
                  const isSaving = savingItemIds.has(item.id)
                  const diff = item.old_price != null ? item.new_price - item.old_price : null
                  return (
                    <div
                      key={item.id}
                      className={`flex items-center gap-3 px-5 py-3.5 transition ${
                        item.applied ? "bg-[var(--color-background-secondary)]/40" : "hover:bg-[var(--color-background-hover)]"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => setItemApplied(item, !item.applied)}
                        disabled={isSaving}
                        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 transition ${
                          item.applied
                            ? "border-orange-500 bg-orange-500 text-white"
                            : "border-[var(--color-border-secondary)] hover:border-[var(--color-text-secondary)]"
                        } ${isSaving ? "opacity-60" : ""}`}
                        aria-label={item.applied ? "Marquer comme non appliqué" : "Marquer comme appliqué"}
                      >
                        {isSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : item.applied && <Check className="h-3 w-3" strokeWidth={3} />}
                      </button>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className={`text-sm font-semibold truncate ${item.applied ? "text-[var(--color-text-secondary)] line-through" : "text-[var(--color-text-primary)]"}`}>
                            {item.product_name}
                          </p>
                          <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-secondary)]">
                            {VEHICLE_TYPE_LABELS[item.vehicle_type] || item.vehicle_type}
                          </span>
                        </div>
                        <p className="mt-0.5 text-xs text-[var(--color-text-secondary)] truncate">
                          {item.strategy_label || "—"}
                          {item.applied && item.applied_at && ` · Appliqué le ${formatDate(item.applied_at)}`}
                        </p>
                      </div>

                      <div className="flex items-center gap-4 shrink-0">
                        <div className="hidden sm:flex flex-col items-end gap-0">
                          <p className="text-[10px] uppercase tracking-wider text-[var(--color-text-secondary)] font-semibold">
                            Ancien
                          </p>
                          <p className={`text-sm tabular-nums ${item.applied ? "text-[var(--color-text-secondary)] line-through" : "text-[var(--color-text-primary)]"}`}>
                            {formatPrice(item.old_price)}
                          </p>
                        </div>
                        <ChevronRight className="hidden sm:block h-3.5 w-3.5 text-[var(--color-text-tertiary)]" />
                        <PriceEditor
                          item={item}
                          isSaving={isSaving}
                          disabled={item.applied}
                          onSave={(value) => updateItemPrice(item, value)}
                        />
                        {diff != null && (
                          <span
                            className={`hidden md:inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums ${
                              diff < 0
                                ? "bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300"
                                : diff > 0
                                  ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"
                                  : "bg-[var(--color-background-secondary)] text-[var(--color-text-secondary)]"
                            }`}
                          >
                            {diff > 0 ? "+" : ""}
                            {Math.round(diff).toLocaleString("fr-CA")} $
                          </span>
                        )}
                        {item.reference_url && (
                          <a
                            href={item.reference_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center justify-center h-8 w-8 rounded-lg text-[var(--color-text-secondary)] hover:bg-[var(--color-background-hover)] hover:text-[var(--color-text-primary)] transition"
                            title="Ouvrir la fiche produit"
                            aria-label="Ouvrir la fiche produit"
                          >
                            <ExternalLink className="h-4 w-4" />
                          </a>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </section>
        </>
      ) : null}
    </Layout>
  )
}
