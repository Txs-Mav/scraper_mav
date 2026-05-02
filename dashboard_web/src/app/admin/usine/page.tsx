"use client"

import { useEffect, useRef, useState } from "react"
import {
  Loader2, Hammer, PlayCircle, AlertTriangle, Globe, Eye,
  Settings2, Terminal, CheckCircle2, XCircle, Upload, FileText,
  ListPlus, Trash2,
} from "lucide-react"

interface JobStatus {
  jobId: string
  pid?: number
  isComplete?: boolean
  hasError?: boolean
  logLines?: string[]
}

type Mode = "single" | "batch"

export default function AdminUsinePage() {
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

  const submitSingle = async () => {
    setError(null)
    if (!url.trim()) { setError("URL requise"); return }
    setSubmitting(true); setLogs([]); setJob(null)
    try {
      const res = await fetch("/api/admin/usine/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: url.trim(), dryRun, forcePlaywright, publishThreshold: threshold,
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
            Génère un nouveau scraper dédié. URL unique ou batch (1 fichier de plusieurs URLs).
            Les scrapers validés apparaissent en pending dans <span className="text-indigo-300">/admin/scrapers</span>.
          </p>
        </div>
      </header>

      {/* Tabs */}
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

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
            onClick={mode === "single" ? submitSingle : submitBatch}
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
