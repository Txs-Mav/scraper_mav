"use client"

import { useEffect, useState, useCallback } from "react"
import {
  Loader2, Check, X, RefreshCw, AlertTriangle, PlayCircle,
  ExternalLink, ChevronDown, ChevronRight, Award,
} from "lucide-react"

type ValidationStatus = "pending" | "approved" | "rejected"

interface ScraperRow {
  id: string
  site_name: string
  site_slug: string
  site_url: string
  site_domain: string
  scraper_module: string
  is_active: boolean
  validation_status: ValidationStatus
  validation_score: number | null
  validation_grade: string | null
  validation_report: Record<string, any> | null
  validated_at: string | null
  rejection_reason: string | null
  submitted_by_pipeline: string | null
  last_verified_at: string | null
  created_at: string
  updated_at: string
  extracted_fields: string[] | null
  categories: string[] | null
}

interface TestResult {
  success: boolean
  slug: string
  elapsed_seconds: number
  product_count: number
  sample: any[]
  sample_count: number
  metadata: Record<string, any>
  error?: string
}

const STATUS_LABELS: Record<ValidationStatus | "all", string> = {
  pending: "En attente",
  approved: "Approuvés",
  rejected: "Rejetés",
  all: "Tous",
}

function formatDate(iso: string | null): string {
  if (!iso) return "—"
  try {
    return new Date(iso).toLocaleString("fr-CA", {
      day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
    })
  } catch { return iso }
}

function timeAgo(iso: string | null): string {
  if (!iso) return "—"
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`
  if (ms < 3600_000) return `${Math.round(ms / 60_000)} min`
  if (ms < 86400_000) return `${Math.round(ms / 3600_000)} h`
  return `${Math.round(ms / 86400_000)} j`
}

function gradeStyles(score: number | null): string {
  const s = score ?? 0
  if (s >= 95) return "bg-emerald-50 text-emerald-700 ring-emerald-200"
  if (s >= 80) return "bg-gray-100 text-gray-800 ring-gray-200"
  if (s >= 60) return "bg-amber-50 text-amber-700 ring-amber-200"
  return "bg-red-50 text-red-700 ring-red-200"
}

export default function AdminScrapersPage() {
  const [items, setItems] = useState<ScraperRow[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<ValidationStatus | "all">("pending")
  const [busy, setBusy] = useState<string | null>(null)
  const [testResults, setTestResults] = useState<Record<string, TestResult | { error: string }>>({})
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/scrapers?status=${filter}`, { cache: "no-store" })
      const data = await res.json()
      if (!res.ok) {
        setError(data?.error || "Erreur de chargement")
        setItems([])
        return
      }
      setItems(Array.isArray(data?.scrapers) ? data.scrapers : [])
    } catch (e: any) {
      setError(e?.message || "Erreur réseau")
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [filter])

  useEffect(() => { void load() }, [load])

  const toggleExpand = (slug: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(slug)) next.delete(slug)
      else next.add(slug)
      return next
    })
  }

  const runTest = async (slug: string) => {
    setBusy(`test:${slug}`)
    setTestResults(prev => ({ ...prev, [slug]: undefined as any }))
    try {
      const res = await fetch(`/api/admin/scrapers/${slug}/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sampleLimit: 10 }),
      })
      const data = await res.json()
      if (!res.ok) {
        setTestResults(prev => ({ ...prev, [slug]: { error: data?.error || data?.message || "Erreur" } }))
      } else {
        setTestResults(prev => ({ ...prev, [slug]: data }))
      }
      setExpanded(prev => new Set(prev).add(slug))
    } catch (e: any) {
      setTestResults(prev => ({ ...prev, [slug]: { error: e?.message || "Erreur réseau" } }))
    } finally {
      setBusy(null)
    }
  }

  const approve = async (slug: string) => {
    if (!confirm(`Approuver "${slug}" ? Il sera repris par le cron horaire et un workflow GitHub Action dédié sera déployé.`)) return
    setBusy(`approve:${slug}`)
    try {
      const res = await fetch(`/api/admin/scrapers/${slug}/approve`, { method: "POST" })
      const data = await res.json()
      if (!res.ok) { alert(data?.error || "Erreur d'approbation"); return }

      const wf = data?.workflow
      if (wf?.ok) {
        const action = wf.action === 'unchanged'
          ? `workflow déjà à jour`
          : wf.action === 'updated'
            ? `workflow mis à jour`
            : `workflow créé`
        const sha = wf.commitSha ? ` (commit ${wf.commitSha})` : ''
        alert(`✅ ${slug} approuvé. ${action}${sha}.`)
      } else if (wf?.skipped === 'env_missing') {
        alert(`✅ ${slug} approuvé.\n\n⚠️ Workflow GitHub Action non poussé (GITHUB_PAT/GITHUB_REPO absents).\nLe scraper est actif via le cron orchestrateur principal.`)
      } else if (wf && !wf.ok) {
        alert(`✅ ${slug} approuvé en base.\n\n⚠️ Échec du déploiement du workflow GitHub Action :\n${wf.message ?? wf.skipped ?? 'inconnu'}`)
      }
      await load()
    } finally { setBusy(null) }
  }

  const reject = async (slug: string) => {
    const reason = prompt(`Raison du rejet pour "${slug}" (optionnel) :`)
    if (reason === null) return
    setBusy(`reject:${slug}`)
    try {
      const res = await fetch(`/api/admin/scrapers/${slug}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      })
      const data = await res.json()
      if (!res.ok) { alert(data?.error || "Erreur de rejet"); return }
      await load()
    } finally { setBusy(null) }
  }

  return (
    <div>
      <header className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-[22px] font-semibold text-gray-900 tracking-tight">Scrapers</h1>
          <p className="text-sm text-gray-500 mt-1">
            Validation des scrapers générés par scraper_usine avant production.
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-gray-200 bg-white text-xs font-medium text-gray-700 hover:bg-gray-50 hover:border-gray-300 transition disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          Actualiser
        </button>
      </header>

      {/* Filtres : segmented control */}
      <div className="inline-flex items-center bg-white border border-gray-200 rounded-md p-0.5 mb-5">
        {(["pending", "approved", "rejected", "all"] as const).map(f => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded text-xs font-medium transition ${
              filter === f
                ? "bg-gray-900 text-white"
                : "text-gray-600 hover:text-gray-900"
            }`}
          >
            {STATUS_LABELS[f]}
          </button>
        ))}
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 text-red-600 mt-0.5" />
          <p className="text-sm text-red-800">{error}</p>
        </div>
      )}

      <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        {loading && !items ? (
          <div className="py-16 text-center">
            <Loader2 className="h-5 w-5 animate-spin text-gray-400 mx-auto" />
          </div>
        ) : items && items.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-sm text-gray-500">
              Aucun scraper {filter !== "all" && `en statut "${STATUS_LABELS[filter].toLowerCase()}"`}.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {items?.map(item => {
              const isOpen = expanded.has(item.site_slug)
              const result = testResults[item.site_slug]
              return (
                <li key={item.id}>
                  <div className="px-5 py-3.5 flex items-start gap-4 hover:bg-gray-50/50 transition">
                    <button
                      type="button"
                      onClick={() => toggleExpand(item.site_slug)}
                      className="mt-1 text-gray-400 hover:text-gray-700 transition"
                      aria-label={isOpen ? "Replier" : "Déplier"}
                    >
                      {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    </button>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-medium text-gray-900">{item.site_name}</p>
                        <StatusBadge status={item.validation_status} isActive={item.is_active} />
                        {item.validation_score !== null && (
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold inline-flex items-center gap-1 ring-1 ring-inset ${gradeStyles(item.validation_score)}`}>
                            <Award className="h-2.5 w-2.5" />
                            {item.validation_score}
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 text-xs text-gray-500 flex items-center gap-2 flex-wrap">
                        <span className="font-mono">{item.site_slug}</span>
                        <span>·</span>
                        <a
                          href={item.site_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 hover:text-gray-900 transition"
                        >
                          {item.site_domain}
                          <ExternalLink className="h-3 w-3" />
                        </a>
                        <span>·</span>
                        <span>il y a {timeAgo(item.created_at)}</span>
                      </div>
                      {item.rejection_reason && (
                        <p className="mt-1 text-xs text-red-700">Rejet : {item.rejection_reason}</p>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <button
                        type="button"
                        onClick={() => runTest(item.site_slug)}
                        disabled={!!busy}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-gray-200 bg-white text-xs font-medium text-gray-700 hover:bg-gray-50 hover:border-gray-300 disabled:opacity-40 transition"
                      >
                        {busy === `test:${item.site_slug}` ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <PlayCircle className="h-3 w-3" />
                        )}
                        Tester
                      </button>
                      {item.validation_status !== "approved" && (
                        <button
                          type="button"
                          onClick={() => approve(item.site_slug)}
                          disabled={!!busy}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-gray-900 text-white text-xs font-medium hover:bg-gray-800 disabled:opacity-40 transition"
                        >
                          {busy === `approve:${item.site_slug}` ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Check className="h-3 w-3" />
                          )}
                          Approuver
                        </button>
                      )}
                      {item.validation_status !== "rejected" && (
                        <button
                          type="button"
                          onClick={() => reject(item.site_slug)}
                          disabled={!!busy}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-gray-200 bg-white text-xs font-medium text-red-600 hover:bg-red-50 hover:border-red-200 disabled:opacity-40 transition"
                        >
                          {busy === `reject:${item.site_slug}` ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <X className="h-3 w-3" />
                          )}
                          Rejeter
                        </button>
                      )}
                    </div>
                  </div>

                  {isOpen && (
                    <div className="border-t border-gray-100 bg-gray-50/50 px-5 py-4 space-y-4">
                      {item.validation_report && (
                        <ValidationReportBlock report={item.validation_report} fields={item.extracted_fields} categories={item.categories} />
                      )}
                      {result && (
                        <TestResultBlock result={result} />
                      )}
                      <p className="text-[11px] text-gray-500 font-mono">
                        scraper_ai/dedicated_scrapers/{item.scraper_module}.py
                      </p>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}

function StatusBadge({ status, isActive }: { status: ValidationStatus; isActive: boolean }) {
  if (status === "approved" && isActive) {
    return <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200">En production</span>
  }
  if (status === "approved") {
    return <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200">Approuvé (inactif)</span>
  }
  if (status === "rejected") {
    return <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-700 ring-1 ring-inset ring-gray-200">Rejeté</span>
  }
  return <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-200">En attente</span>
}

function ValidationReportBlock({
  report, fields, categories,
}: {
  report: Record<string, any>
  fields: string[] | null
  categories: string[] | null
}) {
  const coverage = (report.field_coverage || {}) as Record<string, number>
  const sample = (report.sample_products || []) as any[]
  const warnings = (report.warnings || []) as string[]

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <p className="text-xs font-semibold text-gray-900 mb-3 uppercase tracking-wider">Validation auto</p>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4 text-xs">
        <Stat label="Stratégie" value={report.strategy_used || "—"} />
        <Stat label="Plateforme" value={report.platform_detected || "—"} />
        <Stat label="Produits testés" value={String(report.products_tested ?? "—")} />
        <Stat label="Durée" value={report.execution_time_seconds ? `${report.execution_time_seconds.toFixed(1)}s` : "—"} />
      </div>

      {Object.keys(coverage).length > 0 && (
        <div className="mb-3">
          <p className="text-[10px] uppercase tracking-wider text-gray-500 font-medium mb-1.5">Couverture par champ</p>
          <div className="flex flex-wrap gap-1">
            {Object.entries(coverage).map(([f, cov]) => {
              const pct = Math.round((cov as number) * 100)
              const cls = pct >= 90
                ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                : pct >= 60
                ? "bg-amber-50 text-amber-700 ring-amber-200"
                : "bg-red-50 text-red-700 ring-red-200"
              return (
                <span key={f} className={`px-1.5 py-0.5 rounded text-[10px] font-mono ring-1 ring-inset ${cls}`}>
                  {f}: {pct}%
                </span>
              )
            })}
          </div>
        </div>
      )}

      {categories && categories.length > 0 && (
        <p className="text-xs text-gray-700 mb-1">
          <span className="font-medium">Catégories :</span> {categories.join(", ")}
        </p>
      )}
      {fields && fields.length > 0 && (
        <p className="text-xs text-gray-700 mb-1">
          <span className="font-medium">Champs :</span> {fields.join(", ")}
        </p>
      )}

      {warnings.length > 0 && (
        <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
          <p className="text-[10px] uppercase tracking-wider text-amber-800 font-medium mb-1">Warnings</p>
          <ul className="text-xs text-amber-900 space-y-0.5">
            {warnings.slice(0, 5).map((w, i) => (<li key={i}>· {w}</li>))}
          </ul>
        </div>
      )}

      {sample.length > 0 && (
        <details className="mt-3">
          <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-900">
            Échantillon validation ({sample.length})
          </summary>
          <pre className="mt-2 text-[10px] font-mono bg-gray-50 border border-gray-200 p-2 rounded overflow-auto max-h-60 text-gray-700">
            {JSON.stringify(sample, null, 2)}
          </pre>
        </details>
      )}
    </div>
  )
}

function TestResultBlock({ result }: { result: TestResult | { error: string } }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <p className="text-xs font-semibold text-gray-900 mb-3 uppercase tracking-wider">Test live</p>
      {"error" in result ? (
        <p className="text-sm text-red-700">{result.error}</p>
      ) : !result.success ? (
        <p className="text-sm text-red-700">Échec : {result.error || "erreur inconnue"}</p>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-gray-700">
            <span className="font-semibold text-gray-900">{result.product_count}</span> produits trouvés
            en {result.elapsed_seconds}s ({result.sample_count} en échantillon)
          </p>
          {result.sample.length > 0 && (
            <div className="max-h-72 overflow-auto rounded-md border border-gray-200 bg-gray-50 p-3">
              <ul className="space-y-1.5">
                {result.sample.slice(0, 10).map((p, i) => (
                  <li key={i} className="text-xs text-gray-700 border-b border-gray-200 pb-1.5 last:border-0">
                    <p className="font-medium text-gray-900">{p.name || "(sans nom)"}</p>
                    <p className="font-mono text-[10px] text-gray-500">
                      {p.prix ? `${p.prix} $ · ` : ""}
                      {p.marque || ""} {p.modele || ""} {p.annee ? `(${p.annee})` : ""}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-gray-500 font-medium">{label}</p>
      <p className="text-sm font-medium text-gray-900 truncate">{value}</p>
    </div>
  )
}
