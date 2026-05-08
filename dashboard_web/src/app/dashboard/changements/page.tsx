"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import Layout from "@/components/kokonutui/layout"
import {
  ChevronRight,
  ClipboardList,
  Loader2,
  Inbox,
  CheckCircle2,
  Archive,
  CircleDashed,
} from "lucide-react"

type ChangeSheet = {
  id: string
  name: string
  status: "pending" | "completed" | "archived"
  items_count: number
  applied_count: number
  created_at: string
  completed_at: string | null
}

type Filter = "pending" | "completed" | "archived" | "all"

const FILTER_LABELS: Record<Filter, string> = {
  pending: "À appliquer",
  completed: "Terminées",
  archived: "Archivées",
  all: "Toutes",
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

export default function ChangementsListPage() {
  const [sheets, setSheets] = useState<ChangeSheet[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [setupWarning, setSetupWarning] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>("pending")

  useEffect(() => {
    let cancelled = false

    async function loadSheets() {
      setLoading(true)
      setError(null)
      setSetupWarning(null)
      try {
        const res = await fetch("/api/pricing/change-sheets", { cache: "no-store" })
        const data = await res.json()
        if (!res.ok) {
          throw new Error(data?.error || "Impossible de charger les fiches.")
        }
        if (!cancelled) {
          setSheets(Array.isArray(data?.sheets) ? data.sheets : [])
          setSetupWarning(data?.setupRequired ? data?.message || "Migration Supabase requise." : null)
        }
      } catch (err: unknown) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Erreur réseau.")
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void loadSheets()
    return () => {
      cancelled = true
    }
  }, [])

  const filteredSheets = useMemo(() => {
    if (filter === "all") return sheets
    return sheets.filter(s => s.status === filter)
  }, [sheets, filter])

  const counts = useMemo(() => {
    const pending = sheets.filter(s => s.status === "pending").length
    const completed = sheets.filter(s => s.status === "completed").length
    const archived = sheets.filter(s => s.status === "archived").length
    return { pending, completed, archived, all: sheets.length }
  }, [sheets])

  return (
    <Layout>
      <section className="mb-8">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
            <ClipboardList className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">
              Changements à appliquer
            </h1>
            <p className="mt-0.5 text-sm text-[var(--color-text-secondary)]">
              Les fiches de prix à mettre à jour dans votre site web ou DMS.
            </p>
          </div>
        </div>
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

      <div className="mb-5 flex flex-wrap items-center gap-2">
        {(["pending", "completed", "archived", "all"] as Filter[]).map(f => {
          const active = filter === f
          const count = counts[f]
          return (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`inline-flex items-center gap-2 h-9 px-3.5 rounded-full text-sm font-medium transition ${
                active
                  ? "bg-[var(--color-text-primary)] text-[var(--color-background-primary)]"
                  : "bg-[var(--color-background-primary)] border border-[var(--color-border-tertiary)] text-[var(--color-text-primary)] hover:bg-[var(--color-background-hover)]"
              }`}
            >
              {FILTER_LABELS[f]}
              <span className={`tabular-nums text-xs ${active ? "opacity-80" : "text-[var(--color-text-secondary)]"}`}>
                {count}
              </span>
            </button>
          )
        })}
      </div>

      {loading ? (
        <div className="rounded-xl border border-[var(--color-border-tertiary)] bg-[var(--color-background-primary)] p-8 text-sm text-[var(--color-text-secondary)]">
          <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
          Chargement…
        </div>
      ) : filteredSheets.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[var(--color-border-tertiary)] bg-[var(--color-background-primary)] p-10 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[var(--color-background-secondary)] text-[var(--color-text-secondary)]">
            <Inbox className="h-5 w-5" />
          </div>
          <p className="mt-4 text-sm font-semibold text-[var(--color-text-primary)]">
            {filter === "pending"
              ? "Aucune fiche en attente."
              : filter === "completed"
                ? "Aucune fiche terminée."
                : filter === "archived"
                  ? "Aucune fiche archivée."
                  : "Aucune fiche pour le moment."}
          </p>
          <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
            Allez dans le dashboard, activez les recommandations de prix puis cliquez sur « Créer une fiche ».
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-[var(--color-border-tertiary)] bg-[var(--color-background-primary)] overflow-hidden divide-y divide-[var(--color-border-tertiary)]">
          {filteredSheets.map(sheet => {
            const meta = STATUS_META[sheet.status]
            const remaining = Math.max(0, sheet.items_count - sheet.applied_count)
            const StatusIcon =
              sheet.status === "pending" ? CircleDashed : sheet.status === "completed" ? CheckCircle2 : Archive
            return (
              <Link
                key={sheet.id}
                href={`/dashboard/changements/${sheet.id}`}
                className="group flex items-center gap-4 px-5 py-4 hover:bg-[var(--color-background-hover)] transition"
              >
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--color-background-secondary)] text-[var(--color-text-primary)] shrink-0">
                  <StatusIcon className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-semibold text-[var(--color-text-primary)] truncate">
                      {sheet.name}
                    </p>
                    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${meta.className}`}>
                      {meta.label}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
                    Créée le {formatDate(sheet.created_at)}
                  </p>
                </div>
                <div className="hidden sm:flex flex-col items-end gap-0.5 shrink-0 mr-1">
                  <p className="text-sm font-semibold text-[var(--color-text-primary)] tabular-nums">
                    {sheet.applied_count} / {sheet.items_count}
                  </p>
                  <p className="text-[10px] uppercase tracking-wider text-[var(--color-text-secondary)] font-semibold">
                    {sheet.status === "pending" && remaining > 0
                      ? `${remaining} restant${remaining === 1 ? "" : "s"}`
                      : sheet.status === "completed"
                        ? "Tout fait"
                        : "Appliqué"}
                  </p>
                </div>
                <ChevronRight className="h-4 w-4 text-[var(--color-text-secondary)] group-hover:text-[var(--color-text-primary)] transition shrink-0" />
              </Link>
            )
          })}
        </div>
      )}
    </Layout>
  )
}
