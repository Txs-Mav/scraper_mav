"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  Loader2, RefreshCw, Save, PlayCircle, CheckCircle2, XCircle,
  AlertTriangle, Globe, Lock, KeyRound, Info,
} from "lucide-react"

/**
 * /admin/search-sources
 *
 * Console développeur : configure les cookies (Facebook) et les proxies
 * résidentiels (Walmart, Best Buy, AutoTrader, Kijiji, LesPAC) utilisés
 * par les adapters Python de recherche fédérée.
 *
 * Les valeurs sont stockées dans `system_config` (Supabase) et injectées
 * comme variables d'environnement dans le subprocess Python par
 * /api/product-search.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ConfigItem {
  key: string
  value: string | null
  has_value: boolean
  is_secret: boolean
  last_test_at: string | null
  last_test_status: "success" | "error" | "never"
  last_test_error: string | null
  last_test_duration_seconds: number | null
  updated_at: string | null
}

interface SourceDef {
  id: string
  label: string
  icon: string
  description: string
  hint: string
  fields: Array<{
    key: string
    label: string
    type: "text" | "textarea" | "password"
    placeholder?: string
  }>
}

const SOURCES: SourceDef[] = [
  {
    id: "facebook",
    label: "Facebook Marketplace",
    icon: "facebook.com",
    description:
      "Auth requise — colle ici l'export JSON de l'extension Cookie-Editor. " +
      "Les cookies expirent ~30 jours et doivent être renouvelés.",
    hint:
      "Procédure : connecte-toi à facebook.com → extension Cookie-Editor → " +
      "Export → JSON → colle le contenu intégral ci-dessous.",
    fields: [
      { key: "FB_COOKIES_JSON", label: "Cookies (JSON Cookie-Editor)", type: "textarea", placeholder: '[{"name":"c_user","value":"..."}, ...]' },
      { key: "FB_PROXY_URL", label: "Proxy résidentiel URL", type: "text", placeholder: "http://gate.provider.com:7000" },
      { key: "FB_PROXY_USERNAME", label: "Proxy username", type: "text" },
      { key: "FB_PROXY_PASSWORD", label: "Proxy password", type: "password" },
    ],
  },
  {
    id: "walmart",
    label: "Walmart.ca",
    icon: "walmart.ca",
    description:
      "Walmart utilise PerimeterX (anciennement Akamai). Sans proxy résidentiel, " +
      "tu te fais bloquer après quelques requêtes.",
    hint: "Providers recommandés : Bright Data, Oxylabs, Smartproxy, IPRoyal.",
    fields: [
      { key: "WALMART_PROXY_URL", label: "Proxy URL", type: "text", placeholder: "http://gate.provider.com:7777" },
      { key: "WALMART_PROXY_USERNAME", label: "Username", type: "text" },
      { key: "WALMART_PROXY_PASSWORD", label: "Password", type: "password" },
    ],
  },
  {
    id: "bestbuy",
    label: "Best Buy.ca",
    icon: "bestbuy.ca",
    description:
      "Best Buy est protégé par Akamai Bot Manager. Un proxy résidentiel est " +
      "fortement recommandé pour des recherches répétées.",
    hint: "Proxy optionnel — fonctionne en best-effort sans, mais avec un risque de blocage.",
    fields: [
      { key: "BESTBUY_PROXY_URL", label: "Proxy URL", type: "text", placeholder: "http://gate.provider.com:7777" },
      { key: "BESTBUY_PROXY_USERNAME", label: "Username", type: "text" },
      { key: "BESTBUY_PROXY_PASSWORD", label: "Password", type: "password" },
    ],
  },
  {
    id: "autotrader",
    label: "AutoTrader.ca",
    icon: "autotrader.ca",
    description:
      "AutoTrader utilise Incapsula (Imperva). Un proxy résidentiel évite les " +
      "challenges JS répétés.",
    hint: "Sans proxy : fonctionne quelques requêtes/heure avant rate-limit.",
    fields: [
      { key: "AUTOTRADER_PROXY_URL", label: "Proxy URL", type: "text", placeholder: "http://gate.provider.com:7777" },
      { key: "AUTOTRADER_PROXY_USERNAME", label: "Username", type: "text" },
      { key: "AUTOTRADER_PROXY_PASSWORD", label: "Password", type: "password" },
    ],
  },
  {
    id: "kijiji",
    label: "Kijiji.ca",
    icon: "kijiji.ca",
    description:
      "Kijiji utilise DataDome. C'est l'anti-bot le plus agressif de la liste — " +
      "le proxy résidentiel est quasi obligatoire en prod.",
    hint: "DataDome détecte les datacenters AWS/GCP en <1s, prévois un proxy résidentiel sérieux.",
    fields: [
      { key: "KIJIJI_PROXY_URL", label: "Proxy URL", type: "text", placeholder: "http://gate.provider.com:7777" },
      { key: "KIJIJI_PROXY_USERNAME", label: "Username", type: "text" },
      { key: "KIJIJI_PROXY_PASSWORD", label: "Password", type: "password" },
    ],
  },
  {
    id: "lespac",
    label: "LesPAC.com",
    icon: "lespac.com",
    description:
      "LesPAC n'a pas d'anti-bot agressif. Le proxy est optionnel mais peut " +
      "aider en cas de rate-limiting.",
    hint: "Souvent fonctionnel sans proxy. À configurer uniquement si tu vois des timeouts.",
    fields: [
      { key: "LESPAC_PROXY_URL", label: "Proxy URL", type: "text", placeholder: "http://gate.provider.com:7777" },
      { key: "LESPAC_PROXY_USERNAME", label: "Username", type: "text" },
      { key: "LESPAC_PROXY_PASSWORD", label: "Password", type: "password" },
    ],
  },
]

// L'API renvoie "****" pour les secrets non vides (sentinel d'affichage)
const SECRET_MASK = "****"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timeAgo(iso: string | null): string {
  if (!iso) return "—"
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`
  if (ms < 3600_000) return `${Math.round(ms / 60_000)} min`
  if (ms < 86400_000) return `${Math.round(ms / 3600_000)} h`
  return `${Math.round(ms / 86400_000)} j`
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function AdminSearchSourcesPage() {
  const [items, setItems] = useState<ConfigItem[]>([])
  // Buffer local des modifications (key → new value). Vide pour les champs intouchés.
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [savingSource, setSavingSource] = useState<string | null>(null)
  const [testingSource, setTestingSource] = useState<string | null>(null)
  const [testMessages, setTestMessages] = useState<Record<string, string>>({})

  const itemsByKey = useMemo<Record<string, ConfigItem>>(() => {
    const out: Record<string, ConfigItem> = {}
    for (const it of items) out[it.key] = it
    return out
  }, [items])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/admin/search-sources", { cache: "no-store" })
      const payload = await res.json()
      if (!res.ok) {
        setError(payload?.error || "Erreur de chargement")
        return
      }
      setItems(payload.items as ConfigItem[])
      setDrafts({})
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg || "Erreur réseau")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // ----------------------------------------------------------------------
  // Modifications locales (drafts)
  // ----------------------------------------------------------------------

  const fieldValue = useCallback(
    (key: string): string => {
      if (Object.prototype.hasOwnProperty.call(drafts, key)) return drafts[key]
      const it = itemsByKey[key]
      if (!it) return ""
      if (it.is_secret && it.has_value) return SECRET_MASK
      return it.value || ""
    },
    [drafts, itemsByKey],
  )

  const setField = useCallback((key: string, value: string) => {
    setDrafts((d) => ({ ...d, [key]: value }))
  }, [])

  const clearField = useCallback((key: string) => {
    setDrafts((d) => ({ ...d, [key]: "" }))
  }, [])

  // ----------------------------------------------------------------------
  // Save
  // ----------------------------------------------------------------------

  const saveSource = useCallback(
    async (source: SourceDef) => {
      setSavingSource(source.id)
      setTestMessages((m) => ({ ...m, [source.id]: "" }))
      try {
        const payloadItems = source.fields
          .filter((f) => Object.prototype.hasOwnProperty.call(drafts, f.key))
          .map((f) => ({
            key: f.key,
            // Si le user a explicitement vidé un secret on envoie une string vide
            // (le serveur convertit en NULL = suppression logique).
            value: drafts[f.key],
          }))

        if (payloadItems.length === 0) {
          setTestMessages((m) => ({ ...m, [source.id]: "Aucun changement à sauvegarder." }))
          return
        }

        const res = await fetch("/api/admin/search-sources", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items: payloadItems }),
        })
        const payload = await res.json()
        if (!res.ok) {
          setTestMessages((m) => ({ ...m, [source.id]: `Erreur : ${payload?.error || "save failed"}` }))
          return
        }
        setTestMessages((m) => ({
          ...m,
          [source.id]: `Sauvegardé (${payload.updated} champ${payload.updated > 1 ? "s" : ""}).`,
        }))
        // Reload pour refléter les masks à jour.
        await load()
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e)
        setTestMessages((m) => ({ ...m, [source.id]: `Erreur réseau : ${msg}` }))
      } finally {
        setSavingSource(null)
      }
    },
    [drafts, load],
  )

  // ----------------------------------------------------------------------
  // Test
  // ----------------------------------------------------------------------

  const testSource = useCallback(
    async (source: SourceDef) => {
      setTestingSource(source.id)
      setTestMessages((m) => ({ ...m, [source.id]: "Test en cours…" }))
      try {
        const res = await fetch("/api/admin/search-sources/test", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ source: source.id }),
        })
        const payload = await res.json()
        if (!res.ok) {
          setTestMessages((m) => ({
            ...m,
            [source.id]: `Échec test : ${payload?.error || "erreur inconnue"}`,
          }))
          return
        }
        const msg = payload.success
          ? `✓ OK (${payload.hits_returned} hit${payload.hits_returned > 1 ? "s" : ""}, ${payload.duration_seconds.toFixed(1)}s)`
          : `✗ Erreur : ${payload.error || "échec inconnu"}`
        setTestMessages((m) => ({ ...m, [source.id]: msg }))
        // Reload pour rafraîchir les badges last_test_*.
        await load()
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e)
        setTestMessages((m) => ({ ...m, [source.id]: `Erreur réseau : ${msg}` }))
      } finally {
        setTestingSource(null)
      }
    },
    [load],
  )

  // ----------------------------------------------------------------------
  // Render
  // ----------------------------------------------------------------------

  return (
    <div>
      <header className="flex items-start justify-between mb-6 gap-4">
        <div>
          <h1 className="text-[22px] font-semibold text-gray-900 tracking-tight">
            Sources de recherche
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Cookies et proxies utilisés par les adapters Python de la recherche fédérée
            (Facebook Marketplace, Walmart, Best Buy, AutoTrader, Kijiji, LesPAC).
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-gray-200 bg-white text-xs font-medium text-gray-700 hover:bg-gray-50 hover:border-gray-300 transition disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          Actualiser
        </button>
      </header>

      <div className="mb-6 rounded-lg border border-blue-200 bg-blue-50/60 px-4 py-3 flex items-start gap-2 text-xs text-blue-900">
        <Info className="h-3.5 w-3.5 mt-0.5 shrink-0 text-blue-700" />
        <div>
          Les valeurs sont stockées dans <code className="px-1 rounded bg-blue-100">system_config</code> et
          injectées comme variables d&apos;environnement dans le subprocess Python lors de chaque
          recherche. Les secrets ne sont jamais renvoyés en clair par l&apos;API : un champ marqué
          <code className="mx-1 px-1 rounded bg-blue-100">{SECRET_MASK}</code>
          signifie « valeur déjà stockée, non affichée ». Le ré-éditer écrasera la valeur.
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 text-red-600 mt-0.5" />
          <p className="text-sm text-red-800">{error}</p>
        </div>
      )}

      <div className="space-y-4">
        {SOURCES.map((source) => (
          <SourceCard
            key={source.id}
            source={source}
            itemsByKey={itemsByKey}
            fieldValue={fieldValue}
            setField={setField}
            clearField={clearField}
            onSave={() => void saveSource(source)}
            onTest={() => void testSource(source)}
            saving={savingSource === source.id}
            testing={testingSource === source.id}
            message={testMessages[source.id]}
          />
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Carte par source
// ---------------------------------------------------------------------------

interface SourceCardProps {
  source: SourceDef
  itemsByKey: Record<string, ConfigItem>
  fieldValue: (key: string) => string
  setField: (key: string, value: string) => void
  clearField: (key: string) => void
  onSave: () => void
  onTest: () => void
  saving: boolean
  testing: boolean
  message?: string
}

function SourceCard({
  source, itemsByKey, fieldValue, setField, clearField,
  onSave, onTest, saving, testing, message,
}: SourceCardProps) {
  // Statut basé sur la 1re clé de la source (toutes partagent le même statut).
  const firstKey = source.fields[0]?.key
  const item = firstKey ? itemsByKey[firstKey] : undefined
  const lastTestStatus = item?.last_test_status ?? "never"
  const lastTestAt = item?.last_test_at ?? null

  return (
    <section className="rounded-xl border border-gray-200 bg-white overflow-hidden">
      {/* Header */}
      <header className="px-5 py-3.5 border-b border-gray-100 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-9 w-9 rounded-md bg-gray-100 flex items-center justify-center shrink-0">
            <Globe className="h-4 w-4 text-gray-600" />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-gray-900">{source.label}</h2>
            <p className="text-xs text-gray-500 truncate">{source.icon}</p>
          </div>
        </div>
        <StatusBadge status={lastTestStatus} lastTestAt={lastTestAt} />
      </header>

      {/* Description */}
      <div className="px-5 pt-3 pb-2">
        <p className="text-xs text-gray-600">{source.description}</p>
      </div>

      {/* Fields */}
      <div className="px-5 pb-4 space-y-3">
        {source.fields.map((field) => {
          const value = fieldValue(field.key)
          const item = itemsByKey[field.key]
          const isMasked = value === SECRET_MASK

          return (
            <div key={field.key}>
              <div className="flex items-center justify-between mb-1">
                <label className="text-[11px] font-medium text-gray-700 uppercase tracking-wide flex items-center gap-1.5">
                  {field.type === "password" || (item?.is_secret && field.type !== "textarea") ? (
                    <Lock className="h-3 w-3 text-gray-400" />
                  ) : (
                    <KeyRound className="h-3 w-3 text-gray-400" />
                  )}
                  {field.label}
                </label>
                {item?.has_value && (
                  <button
                    type="button"
                    onClick={() => clearField(field.key)}
                    className="text-[11px] text-gray-400 hover:text-red-600"
                  >
                    Effacer
                  </button>
                )}
              </div>
              {field.type === "textarea" ? (
                <textarea
                  value={value}
                  onChange={(e) => setField(field.key, e.target.value)}
                  placeholder={field.placeholder}
                  rows={5}
                  className="w-full px-3 py-2 rounded-md border border-gray-200 bg-white text-xs font-mono text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
                />
              ) : (
                <input
                  type={field.type === "password" && !isMasked ? "password" : "text"}
                  value={value}
                  onChange={(e) => setField(field.key, e.target.value)}
                  placeholder={field.placeholder}
                  className="w-full px-3 py-1.5 rounded-md border border-gray-200 bg-white text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
                />
              )}
            </div>
          )
        })}
      </div>

      {/* Hint */}
      <div className="px-5 py-2.5 bg-gray-50 border-t border-gray-100 text-[11px] text-gray-500 flex items-start gap-1.5">
        <Info className="h-3 w-3 mt-0.5 shrink-0" />
        <p>{source.hint}</p>
      </div>

      {/* Footer actions */}
      <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-between gap-3 flex-wrap">
        <div className="text-xs text-gray-500 min-w-0 truncate">
          {message ? (
            <span className={message.startsWith("✗") || message.toLowerCase().includes("erreur") ? "text-red-700" : "text-gray-700"}>
              {message}
            </span>
          ) : (
            <span className="text-gray-400">
              {item?.last_test_error ? `Dernière erreur : ${item.last_test_error.slice(0, 100)}` : "—"}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onTest}
            disabled={testing || saving}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-gray-200 bg-white text-xs font-medium text-gray-700 hover:bg-gray-50 hover:border-gray-300 transition disabled:opacity-50"
          >
            {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PlayCircle className="h-3.5 w-3.5" />}
            Tester
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={saving || testing}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-gray-900 text-white text-xs font-medium hover:bg-gray-800 disabled:opacity-40 transition"
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            Sauvegarder
          </button>
        </div>
      </div>
    </section>
  )
}

function StatusBadge({
  status, lastTestAt,
}: {
  status: "success" | "error" | "never"
  lastTestAt: string | null
}) {
  if (status === "success") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold bg-orange-50 text-orange-700 border border-orange-200">
        <CheckCircle2 className="h-3 w-3" />
        OK · {timeAgo(lastTestAt)}
      </span>
    )
  }
  if (status === "error") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold bg-red-50 text-red-700 border border-red-200">
        <XCircle className="h-3 w-3" />
        Erreur · {timeAgo(lastTestAt)}
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold bg-gray-50 text-gray-500 border border-gray-200">
      Non testé
    </span>
  )
}
