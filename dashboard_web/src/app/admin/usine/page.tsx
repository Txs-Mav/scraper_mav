"use client"

import { useEffect, useRef, useState } from "react"
import {
  Loader2, Hammer, PlayCircle, AlertTriangle, Globe, Eye,
  Settings2, Terminal, CheckCircle2, XCircle, Upload, FileText,
  ListPlus, Trash2, GraduationCap, CheckCheck, Filter, Zap, RefreshCw,
  DollarSign, TrendingUp,
} from "lucide-react"

interface JobStatus {
  jobId: string
  pid?: number
  isComplete?: boolean
  hasError?: boolean
  logLines?: string[]
}

type Mode = "single" | "batch"
type TopTab = "generate" | "lessons"

interface LessonRow {
  id: string
  created_at: string
  slug: string | null
  url: string | null
  platform: string | null
  phase: string
  error_signature: string
  field_fixed: string | null
  diff: string | null
  claude_rationale: string | null
  tokens_used: number | null
  iterations: number | null
  applied_to_template: boolean
  applied_at: string | null
  applied_notes: string | null
}

interface LessonsSummary {
  total: number
  pending: number
  byPlatform: { key: string; count: number }[]
  byField: { key: string; count: number }[]
  byPlatformField: { key: string; count: number }[]
}

export default function AdminUsinePage() {
  const [topTab, setTopTab] = useState<TopTab>("generate")
  const [mode, setMode] = useState<Mode>("single")

  // Mode unique
  const [url, setUrl] = useState("")

  // Mode batch
  const [batchUrls, setBatchUrls] = useState<string[]>([])
  const [batchSource, setBatchSource] = useState<string>("")
  const [dragOver, setDragOver] = useState(false)

  // Options communes
  const [dryRun, setDryRun] = useState(false)
  const [forcePlaywright, setForcePlaywright] = useState(false)
  // Phase 2.8 du plan optim couts : toggle "Mode qualite max" (force Opus full)
  // pour ce run uniquement. Defaut OFF : on utilise le mode hybride par defaut
  // si CLAUDE_HYBRID_ENABLED=1 cote serveur.
  const [forceFullClaude, setForceFullClaude] = useState(false)
  const [threshold, setThreshold] = useState(95)

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [job, setJob] = useState<JobStatus | null>(null)
  const [logs, setLogs] = useState<string[]>([])
  const [polling, setPolling] = useState(false)
  const logEndRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Parse texte → URLs (filtrage commentaires/vides)
  const parseUrls = (text: string): string[] => {
    const out: string[] = []
    const seen = new Set<string>()
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim()
      if (!line || line.startsWith("#")) continue
      if (!/^https?:\/\//i.test(line)) continue
      if (seen.has(line)) continue
      seen.add(line)
      out.push(line)
    }
    return out
  }

  const handleFile = async (file: File) => {
    if (file.size > 1024 * 1024) {
      setError("Fichier trop volumineux (>1MB)")
      return
    }
    setError(null)
    const text = await file.text()
    const urls = parseUrls(text)
    if (urls.length === 0) {
      setError(`Aucune URL valide dans ${file.name}`)
      return
    }
    if (urls.length > 100) {
      setError(`Trop d'URLs (${urls.length}, max 100)`)
      return
    }
    setBatchUrls(urls)
    setBatchSource(file.name)
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (file) void handleFile(file)
  }

  const submitSingle = async (overrideForceFull?: boolean) => {
    setError(null)
    if (!url.trim()) { setError("URL requise"); return }
    setSubmitting(true); setLogs([]); setJob(null)
    try {
      const res = await fetch("/api/admin/usine/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: url.trim(),
          dryRun,
          forcePlaywright,
          // Phase 2.8 : si overrideForceFull est passe (bouton Relancer en mode
          // qualite max), il prend le pas sur la valeur du toggle.
          forceFullClaude: overrideForceFull ?? forceFullClaude,
          publishThreshold: threshold,
        }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data?.error || data?.message || "Erreur"); return }
      setJob({ jobId: data.jobId, pid: data.pid })
      setPolling(true)
    } catch (e: any) {
      setError(e?.message || "Erreur réseau")
    } finally {
      setSubmitting(false)
    }
  }

  const submitBatch = async () => {
    setError(null)
    if (batchUrls.length === 0) { setError("Aucune URL chargée"); return }
    setSubmitting(true); setLogs([]); setJob(null)
    try {
      const res = await fetch("/api/admin/usine/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          urls: batchUrls, dryRun, forcePlaywright, publishThreshold: threshold,
        }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data?.error || data?.message || "Erreur"); return }
      setJob({ jobId: data.jobId, pid: data.pid })
      setPolling(true)
    } catch (e: any) {
      setError(e?.message || "Erreur réseau")
    } finally {
      setSubmitting(false)
    }
  }

  // Polling logs
  useEffect(() => {
    if (!polling || !job?.jobId) return
    let cancelled = false
    let lastLine = 0

    const poll = async () => {
      while (!cancelled) {
        try {
          const res = await fetch(`/api/admin/usine/logs?jobId=${job.jobId}&lastLine=${lastLine}`, { cache: "no-store" })
          const data = await res.json()
          if (data?.lines && Array.isArray(data.lines)) {
            setLogs(prev => [...prev, ...data.lines])
            lastLine += data.lines.length
            setTimeout(() => logEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50)
          }
          if (data?.isComplete) {
            setJob(j => j ? { ...j, isComplete: true, hasError: data?.hasError } : null)
            setPolling(false)
            return
          }
        } catch { /* ignore */ }
        await new Promise(r => setTimeout(r, 2500))
      }
    }
    void poll()
    return () => { cancelled = true }
  }, [polling, job?.jobId])

  return (
    <div>
      <header className="flex items-center gap-3 mb-6">
        <div className="p-2.5 rounded-xl bg-orange-500/15 ring-1 ring-orange-500/30">
          <Hammer className="h-5 w-5 text-orange-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Scraper Usine</h1>
          <p className="text-sm text-slate-400 mt-0.5">
            Génère un nouveau scraper dédié et capture ce que Claude a corrigé
            pour améliorer l&apos;usine au fil du temps. Les scrapers validés
            apparaissent en pending dans <span className="text-indigo-300">/admin/scrapers</span>.
          </p>
        </div>
      </header>

      {/* Onglets de premier niveau : Générer vs Apprentissages */}
      <div className="inline-flex rounded-xl bg-slate-900/60 border border-slate-800 p-1 mb-5 mr-3">
        <button
          type="button"
          onClick={() => setTopTab("generate")}
          className={`px-4 py-1.5 rounded-lg text-sm font-medium transition ${
            topTab === "generate"
              ? "bg-orange-600 text-white shadow shadow-orange-600/30"
              : "text-slate-400 hover:text-slate-200"
          }`}
        >
          <Hammer className="h-3.5 w-3.5 inline mr-1.5" />
          Générer
        </button>
        <button
          type="button"
          onClick={() => setTopTab("lessons")}
          className={`px-4 py-1.5 rounded-lg text-sm font-medium transition ${
            topTab === "lessons"
              ? "bg-orange-600 text-white shadow shadow-orange-600/30"
              : "text-slate-400 hover:text-slate-200"
          }`}
        >
          <GraduationCap className="h-3.5 w-3.5 inline mr-1.5" />
          Apprentissages
        </button>
      </div>

      {topTab === "lessons" ? (
        <LessonsTab />
      ) : (
        <>
      {/* Phase 5.3 du plan optim couts : cartes de cout Claude */}
      <CostCards />

      {/* Tabs internes (single / batch) */}
      <div className="inline-flex rounded-xl bg-slate-900/60 border border-slate-800 p-1 mb-5">
        <button
          type="button"
          onClick={() => setMode("single")}
          className={`px-4 py-1.5 rounded-lg text-sm font-medium transition ${
            mode === "single"
              ? "bg-indigo-600 text-white shadow shadow-indigo-600/30"
              : "text-slate-400 hover:text-slate-200"
          }`}
        >
          <Globe className="h-3.5 w-3.5 inline mr-1.5" />
          URL unique
        </button>
        <button
          type="button"
          onClick={() => setMode("batch")}
          className={`px-4 py-1.5 rounded-lg text-sm font-medium transition ${
            mode === "batch"
              ? "bg-indigo-600 text-white shadow shadow-indigo-600/30"
              : "text-slate-400 hover:text-slate-200"
          }`}
        >
          <ListPlus className="h-3.5 w-3.5 inline mr-1.5" />
          Batch (fichier)
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 text-red-400 mt-0.5" />
          <p className="text-sm text-red-200">{error}</p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Form */}
        <section className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6 space-y-4">
          {mode === "single" ? (
            <div>
              <label className="block text-xs uppercase tracking-wide text-slate-500 mb-1.5">URL du site</label>
              <div className="relative">
                <Globe className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                <input
                  type="url"
                  value={url}
                  onChange={e => setUrl(e.target.value)}
                  placeholder="https://www.exemple.com/"
                  className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-700 bg-slate-950/60 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                />
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <label className="block text-xs uppercase tracking-wide text-slate-500">Fichier d&apos;URLs (.txt / .csv)</label>

              {/* Drop zone */}
              <div
                onDragOver={e => { e.preventDefault(); setDragOver(true) }}
                onDragLeave={() => setDragOver(false)}
                onDrop={onDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`relative rounded-xl border-2 border-dashed transition cursor-pointer p-5 text-center ${
                  dragOver
                    ? "border-indigo-500 bg-indigo-500/5"
                    : "border-slate-700 bg-slate-950/40 hover:border-slate-600"
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".txt,.csv,text/plain,text/csv"
                  className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) void handleFile(f) }}
                />
                <Upload className={`h-7 w-7 mx-auto mb-2 ${dragOver ? "text-indigo-300" : "text-slate-500"}`} />
                <p className="text-sm text-slate-300 font-medium">
                  Glisser un fichier ou cliquer pour parcourir
                </p>
                <p className="text-[11px] text-slate-500 mt-1">
                  1 URL par ligne. Lignes vides et commentaires (#) ignorés. Max 100 URLs, 1 MB.
                </p>
              </div>

              {/* Liste des URLs chargées */}
              {batchUrls.length > 0 && (
                <div className="rounded-xl border border-slate-800 bg-slate-950/60 overflow-hidden">
                  <div className="px-3 py-2 border-b border-slate-800 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <FileText className="h-3.5 w-3.5 text-emerald-400" />
                      <p className="text-xs font-mono text-slate-300">{batchSource}</p>
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/20">
                        {batchUrls.length} URL{batchUrls.length > 1 ? "s" : ""}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => { setBatchUrls([]); setBatchSource("") }}
                      className="text-slate-500 hover:text-red-300 transition"
                      title="Vider la liste"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className="max-h-48 overflow-auto p-2 space-y-1">
                    {batchUrls.map((u, i) => (
                      <div key={i} className="flex items-center gap-2 px-2 py-1 rounded text-[11px] font-mono">
                        <span className="text-slate-600 w-6 text-right">{i + 1}</span>
                        <span className="text-slate-300 truncate">{u}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Toggle
              label="Dry run"
              description="Analyse + stratégie sans générer de fichier."
              checked={dryRun}
              onChange={setDryRun}
              icon={Eye}
            />
            <Toggle
              label="Forcer Playwright"
              description="Utile si le site est full SPA / JS."
              checked={forcePlaywright}
              onChange={setForcePlaywright}
              icon={Settings2}
            />
            <Toggle
              label="Mode qualité max"
              description="Force Opus full (plus cher, qualité maximale)."
              checked={forceFullClaude}
              onChange={setForceFullClaude}
              icon={Zap}
            />
          </div>

          <div>
            <label className="block text-xs uppercase tracking-wide text-slate-500 mb-1.5">
              Seuil de publication ({threshold}/100)
            </label>
            <input
              type="range"
              min="50"
              max="100"
              step="5"
              value={threshold}
              onChange={e => setThreshold(parseInt(e.target.value, 10))}
              className="w-full accent-indigo-500"
            />
            <p className="text-[11px] text-slate-500 mt-1">
              Score minimum pour publier en pending dans Supabase.
            </p>
          </div>

          <button
            type="button"
            onClick={mode === "single" ? () => void submitSingle() : submitBatch}
            disabled={
              submitting || polling ||
              (mode === "single" ? !url.trim() : batchUrls.length === 0)
            }
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-indigo-600 text-white text-sm font-semibold shadow shadow-indigo-600/30 hover:bg-indigo-700 disabled:opacity-40 transition"
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />}
            {mode === "single"
              ? "Générer le scraper"
              : `Générer ${batchUrls.length} scraper${batchUrls.length > 1 ? "s" : ""} en série`
            }
          </button>

          <div className="text-[11px] text-slate-500 leading-relaxed">
            <p>
              {mode === "single"
                ? "Phases (≈ 5–15 min) :"
                : `Estimation : ~8 min par site, soit ~${Math.max(1, batchUrls.length) * 8} min total max.`
              }
            </p>
            {mode === "single" && (
              <ol className="list-decimal pl-5 mt-1 space-y-0.5">
                <li>Analyse (HTML + APIs + sitemap)</li>
                <li>Planification de stratégie</li>
                <li>Génération du fichier Python</li>
                <li>Validation par exécution réelle</li>
                <li>Publication en pending dans Supabase</li>
              </ol>
            )}
          </div>
        </section>

        {/* Logs */}
        <section className="rounded-2xl border border-slate-800 bg-slate-900/40 overflow-hidden flex flex-col">
          <header className="px-5 py-3 border-b border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Terminal className="h-4 w-4 text-emerald-400" />
              <p className="text-sm font-semibold text-slate-100">Logs</p>
            </div>
            <div className="flex items-center gap-2">
              {job && (
                <span className="font-mono text-[11px] text-slate-500">
                  job {job.jobId.slice(0, 8)}…
                </span>
              )}
              {polling && <Loader2 className="h-3.5 w-3.5 animate-spin text-indigo-400" />}
              {job?.isComplete && !job.hasError && <CheckCircle2 className="h-4 w-4 text-emerald-400" />}
              {job?.isComplete && job.hasError && <XCircle className="h-4 w-4 text-red-400" />}
            </div>
          </header>

          <div className="flex-1 overflow-auto bg-slate-950/60 p-3 font-mono text-[11px] text-slate-300 min-h-[400px] max-h-[60vh]">
            {logs.length === 0 ? (
              <p className="text-slate-600 italic">
                {polling ? "En attente des premiers logs…" : "Aucun job lancé."}
              </p>
            ) : (
              logs.map((line, i) => (
                <div key={i} className={
                  line.includes("❌") || line.toLowerCase().includes("error") ? "text-red-300" :
                  line.includes("⚠️") || line.toLowerCase().includes("warning") ? "text-amber-300" :
                  line.includes("✅") || line.toLowerCase().includes("publié") ? "text-emerald-300" :
                  ""
                }>
                  {line}
                </div>
              ))
            )}
            <div ref={logEndRef} />
          </div>

          {/* Phase 2.8 : bouton "Relancer en mode qualité max"
              apparait apres tout run termine, peu importe le score.
              Reinjette la meme URL avec forceFullClaude=true. */}
          {mode === "single" && job?.isComplete && url.trim() && !polling && (
            <div className="border-t border-slate-800 px-5 py-3 bg-slate-950/40">
              <button
                type="button"
                onClick={() => void submitSingle(true)}
                disabled={submitting}
                className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-amber-500/40 bg-amber-500/10 text-amber-200 text-xs font-medium hover:bg-amber-500/20 transition disabled:opacity-40"
                title="Relance ce site avec Opus full (mode qualité max). Plus cher mais ignore l'hybride."
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Relancer ce site en mode qualité max
              </button>
              <p className="mt-1.5 text-[10px] text-slate-500 text-center">
                Force Opus full pour ce run (écrase la version actuelle)
              </p>
            </div>
          )}
        </section>
      </div>

      {/* Format expected */}
      {mode === "batch" && (
        <section className="mt-5 rounded-2xl border border-slate-800 bg-slate-900/40 p-5">
          <div className="flex items-center gap-2 mb-3">
            <FileText className="h-4 w-4 text-slate-400" />
            <h2 className="text-sm font-semibold text-slate-100">Format de fichier attendu</h2>
          </div>
          <pre className="rounded-lg bg-slate-950/60 border border-slate-800 p-3 text-[11px] font-mono text-slate-400 overflow-auto">
{`# concessionnaires-quebec.txt
https://www.adrenalinesports.ca/fr/
https://www.exemple-moto.ca/

# Lignes vides ignorées, les # commentent

https://www.autre-site.com/`}
          </pre>
        </section>
      )}
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Onglet "Apprentissages" — table usine_lessons (Phase 2 du plan)
// ---------------------------------------------------------------------------

type LessonStatusFilter = "pending" | "applied" | "all"

function LessonsTab() {
  const [statusFilter, setStatusFilter] = useState<LessonStatusFilter>("pending")
  const [sinceDays, setSinceDays] = useState<number>(30)
  const [lessons, setLessons] = useState<LessonRow[]>([])
  const [summary, setSummary] = useState<LessonsSummary | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [savingId, setSavingId] = useState<string | null>(null)

  const reload = async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({
        status: statusFilter,
        sinceDays: String(sinceDays),
        limit: "100",
      })
      const res = await fetch(`/api/admin/usine/lessons?${params.toString()}`, {
        cache: "no-store",
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data?.error || "Erreur de chargement")
        setLessons([])
        setSummary(null)
        return
      }
      setLessons(data.lessons || [])
      setSummary(data.summary || null)
    } catch (e: any) {
      setError(e?.message || "Erreur réseau")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, sinceDays])

  const toggleApplied = async (lesson: LessonRow) => {
    setSavingId(lesson.id)
    try {
      const res = await fetch("/api/admin/usine/lessons", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: lesson.id,
          applied: !lesson.applied_to_template,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data?.error || `HTTP ${res.status}`)
        return
      }
      await reload()
    } catch (e: any) {
      setError(e?.message || "Erreur réseau")
    } finally {
      setSavingId(null)
    }
  }

  return (
    <div className="space-y-5">
      {/* Filtres */}
      <section className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5 flex flex-wrap items-end gap-4">
        <div>
          <label className="block text-xs uppercase tracking-wide text-slate-500 mb-1.5">
            <Filter className="h-3 w-3 inline mr-1" /> Statut
          </label>
          <div className="inline-flex rounded-lg border border-slate-700 overflow-hidden">
            {(["pending", "applied", "all"] as LessonStatusFilter[]).map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`px-3 py-1.5 text-xs font-medium transition ${
                  statusFilter === s
                    ? "bg-orange-600 text-white"
                    : "bg-slate-950/60 text-slate-400 hover:text-slate-200"
                }`}
              >
                {s === "pending" ? "À intégrer" : s === "applied" ? "Intégrées" : "Toutes"}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-xs uppercase tracking-wide text-slate-500 mb-1.5">
            Fenêtre
          </label>
          <select
            value={sinceDays}
            onChange={(e) => setSinceDays(parseInt(e.target.value, 10))}
            className="rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-1.5 text-xs text-slate-200"
          >
            <option value={7}>7 derniers jours</option>
            <option value={30}>30 derniers jours</option>
            <option value={90}>90 derniers jours</option>
            <option value={365}>365 derniers jours</option>
          </select>
        </div>

        <div className="ml-auto text-xs text-slate-500">
          {summary ? (
            <>
              {summary.total} leçon(s) — {summary.pending} en attente
            </>
          ) : loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin inline" />
          ) : null}
        </div>
      </section>

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 text-red-400 mt-0.5" />
          <p className="text-sm text-red-200">{error}</p>
        </div>
      )}

      {/* Top patterns */}
      {summary && summary.byPlatformField.length > 0 && (
        <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <TopList title="Plateformes" items={summary.byPlatform} />
          <TopList title="Champs corrigés" items={summary.byField} />
          <TopList title="Plateforme × Champ" items={summary.byPlatformField} />
        </section>
      )}

      {/* Liste des leçons */}
      <section className="rounded-2xl border border-slate-800 bg-slate-900/40 overflow-hidden">
        <header className="px-5 py-3 border-b border-slate-800 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-100">
            Leçons capturées par Claude
          </h2>
          {loading && <Loader2 className="h-4 w-4 animate-spin text-indigo-400" />}
        </header>

        {lessons.length === 0 && !loading ? (
          <p className="px-5 py-10 text-center text-sm text-slate-500">
            Aucune leçon sur cette fenêtre. Les hooks s&apos;activent quand
            Claude corrige réellement le code généré.
          </p>
        ) : (
          <ul className="divide-y divide-slate-800">
            {lessons.map((l) => {
              const isOpen = expanded === l.id
              return (
                <li key={l.id} className="px-5 py-3">
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <code className="text-xs px-1.5 py-0.5 rounded bg-slate-800 text-slate-200">
                          {l.platform || "unknown"}
                        </code>
                        <code className="text-xs px-1.5 py-0.5 rounded bg-indigo-500/15 text-indigo-300">
                          {l.field_fixed || "?"}
                        </code>
                        <span className="text-[10px] uppercase tracking-wide text-slate-500">
                          {l.phase}
                        </span>
                        {l.slug && (
                          <span className="text-xs text-slate-400 truncate">
                            · {l.slug}
                          </span>
                        )}
                        {l.applied_to_template && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30">
                            intégrée
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-xs font-mono text-slate-400 truncate">
                        {l.error_signature}
                      </p>
                      <p className="mt-1 text-[11px] text-slate-500">
                        {new Date(l.created_at).toLocaleString()} ·{" "}
                        {l.tokens_used ? `${l.tokens_used} tok` : "—"} ·{" "}
                        {l.iterations ?? "—"} itér.
                      </p>
                    </div>
                    <div className="flex flex-col gap-2 items-end">
                      <button
                        onClick={() => setExpanded(isOpen ? null : l.id)}
                        className="text-xs text-slate-300 hover:text-white"
                      >
                        {isOpen ? "Masquer" : "Diff / Rationale"}
                      </button>
                      <button
                        onClick={() => toggleApplied(l)}
                        disabled={savingId === l.id}
                        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium transition ${
                          l.applied_to_template
                            ? "bg-slate-800 text-slate-300 hover:bg-slate-700"
                            : "bg-emerald-600 text-white hover:bg-emerald-700"
                        }`}
                      >
                        {savingId === l.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <CheckCheck className="h-3 w-3" />
                        )}
                        {l.applied_to_template ? "Marquer non" : "Marquer intégrée"}
                      </button>
                    </div>
                  </div>

                  {isOpen && (
                    <div className="mt-3 space-y-3">
                      {l.claude_rationale && (
                        <div>
                          <p className="text-[10px] uppercase tracking-wide text-slate-500 mb-1">
                            Rationale Claude
                          </p>
                          <p className="rounded-lg bg-slate-950/60 border border-slate-800 p-3 text-xs text-slate-300 whitespace-pre-wrap">
                            {l.claude_rationale}
                          </p>
                        </div>
                      )}
                      {l.diff && (
                        <div>
                          <p className="text-[10px] uppercase tracking-wide text-slate-500 mb-1">
                            Diff (unified)
                          </p>
                          <pre className="rounded-lg bg-slate-950/80 border border-slate-800 p-3 text-[11px] font-mono text-slate-300 overflow-auto max-h-[400px]">
                            {l.diff}
                          </pre>
                        </div>
                      )}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}

function TopList({
  title,
  items,
}: {
  title: string
  items: { key: string; count: number }[]
}) {
  if (!items || items.length === 0) return null
  const max = items[0]?.count || 1
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4">
      <p className="text-xs uppercase tracking-wide text-slate-500 mb-2">{title}</p>
      <ul className="space-y-1.5">
        {items.slice(0, 8).map((it) => (
          <li key={it.key} className="text-xs">
            <div className="flex items-center justify-between gap-2">
              <code className="truncate text-slate-300">{it.key}</code>
              <span className="text-slate-500">{it.count}</span>
            </div>
            <div className="h-1 mt-1 rounded bg-slate-800 overflow-hidden">
              <div
                className="h-full bg-orange-500/60"
                style={{ width: `${(it.count / max) * 100}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

function Toggle({
  label, description, checked, onChange, icon: Icon,
}: {
  label: string
  description: string
  checked: boolean
  onChange: (v: boolean) => void
  icon: any
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`text-left rounded-xl border p-3 transition ${
        checked
          ? "border-indigo-500/40 bg-indigo-500/10"
          : "border-slate-700 bg-slate-800/30 hover:bg-slate-800/60"
      }`}
    >
      <div className="flex items-center gap-2 mb-1">
        <Icon className={`h-3.5 w-3.5 ${checked ? "text-indigo-300" : "text-slate-500"}`} />
        <p className={`text-xs font-semibold ${checked ? "text-indigo-200" : "text-slate-200"}`}>{label}</p>
      </div>
      <p className="text-[11px] text-slate-500">{description}</p>
    </button>
  )
}

// ---------------------------------------------------------------------------
// Phase 5.3 — Cartes de cout Claude
// ---------------------------------------------------------------------------

interface CostSummary {
  cost_7d_usd: number
  cost_30d_usd: number
  runs_7d: number
  runs_30d: number
  average_cost_per_run_7d_usd: number
  average_cost_per_run_30d_usd: number
  mode_distribution: { hybrid: number; full_claude: number; hybrid_pct: number }
  top_5_sites_by_cost: { slug: string; url: string | null; cost_usd_total: number; runs: number; last_score: number | null }[]
}

function CostCards() {
  const [data, setData] = useState<CostSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const res = await fetch("/api/admin/usine/costs", { cache: "no-store" })
        const j = await res.json()
        if (cancelled) return
        if (!res.ok) {
          setError(j?.error || `HTTP ${res.status}`)
          return
        }
        setData(j as CostSummary)
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Erreur réseau")
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [])

  if (loading) {
    return (
      <div className="mb-5 rounded-2xl border border-slate-800 bg-slate-900/40 px-5 py-3 flex items-center gap-2 text-xs text-slate-500">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Chargement coûts Claude…
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="mb-5 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-5 py-3 text-xs text-amber-200">
        Coûts Claude indisponibles ({error || "données vides"}). La migration{" "}
        <code className="px-1 py-0.5 rounded bg-slate-900/60 text-slate-300">
          migration_usine_runs_cost_tracking.sql
        </code>{" "}
        est-elle appliquée ?
      </div>
    )
  }

  return (
    <div className="mb-5 grid grid-cols-2 sm:grid-cols-4 gap-3">
      <CostCard
        label="Coût 7j"
        value={`$${data.cost_7d_usd.toFixed(2)}`}
        subtitle={`${data.runs_7d} run${data.runs_7d > 1 ? "s" : ""}`}
        icon={DollarSign}
        accent="emerald"
      />
      <CostCard
        label="Coût 30j"
        value={`$${data.cost_30d_usd.toFixed(2)}`}
        subtitle={`${data.runs_30d} run${data.runs_30d > 1 ? "s" : ""}`}
        icon={TrendingUp}
        accent="indigo"
      />
      <CostCard
        label="Moy. par run (7j)"
        value={`$${data.average_cost_per_run_7d_usd.toFixed(3)}`}
        subtitle={
          data.average_cost_per_run_30d_usd > 0
            ? `vs $${data.average_cost_per_run_30d_usd.toFixed(3)} sur 30j`
            : ""
        }
        icon={DollarSign}
        accent="slate"
      />
      <CostCard
        label="Mode hybride"
        value={`${data.mode_distribution.hybrid_pct}%`}
        subtitle={`${data.mode_distribution.hybrid} hybrid / ${data.mode_distribution.full_claude} full`}
        icon={Zap}
        accent={data.mode_distribution.hybrid_pct >= 50 ? "emerald" : "amber"}
      />
    </div>
  )
}

function CostCard({
  label, value, subtitle, icon: Icon, accent = "slate",
}: {
  label: string
  value: string
  subtitle: string
  icon: any
  accent?: "emerald" | "indigo" | "amber" | "slate"
}) {
  const accentClasses: Record<string, string> = {
    emerald: "ring-emerald-500/30 text-emerald-300",
    indigo: "ring-indigo-500/30 text-indigo-300",
    amber: "ring-amber-500/30 text-amber-300",
    slate: "ring-slate-700 text-slate-300",
  }
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
      <div className="flex items-center gap-2 mb-1.5">
        <span className={`p-1.5 rounded-lg bg-slate-800/60 ring-1 ${accentClasses[accent]}`}>
          <Icon className="h-3.5 w-3.5" />
        </span>
        <p className="text-[11px] uppercase tracking-wide text-slate-500">{label}</p>
      </div>
      <p className="text-2xl font-bold text-slate-100">{value}</p>
      {subtitle && (
        <p className="text-[11px] text-slate-500 mt-0.5">{subtitle}</p>
      )}
    </div>
  )
}
