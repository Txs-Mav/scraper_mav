"use client"

import { useEffect, useState, useCallback } from "react"
import { Bell, Mail, MessageSquare, Slack, Loader2, Check, AlertTriangle, Send, X } from "lucide-react"

interface ChannelsConfig {
  email_enabled: boolean
  email_address: string | null
  sms_enabled: boolean
  sms_phone: string | null
  sms_verified: boolean
  slack_enabled: boolean
  slack_webhook_url: string | null
  slack_channel: string | null
}

type ChannelKey = "email" | "sms" | "slack"

interface FeedbackState {
  kind: "success" | "error"
  message: string
}

const DEFAULT_CONFIG: ChannelsConfig = {
  email_enabled: true,
  email_address: "",
  sms_enabled: false,
  sms_phone: "",
  sms_verified: false,
  slack_enabled: false,
  slack_webhook_url: "",
  slack_channel: "",
}

export default function NotificationChannelsSection({ userEmail }: { userEmail: string }) {
  const [config, setConfig] = useState<ChannelsConfig>({ ...DEFAULT_CONFIG, email_address: userEmail })
  const [initialConfig, setInitialConfig] = useState<ChannelsConfig | null>(null)
  const [twilioAvailable, setTwilioAvailable] = useState<boolean>(true)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState<ChannelKey | null>(null)
  const [feedback, setFeedback] = useState<Record<ChannelKey | "save", FeedbackState | null>>({
    email: null,
    sms: null,
    slack: null,
    save: null,
  })
  const [schemaMissing, setSchemaMissing] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/users/notification-channels")
      const data = await res.json()
      if (!res.ok) {
        if (data?.code === "CHANNELS_SCHEMA_MISSING") {
          setSchemaMissing(true)
        }
        return
      }
      setTwilioAvailable(!!data.twilio_available)
      const fresh: ChannelsConfig = {
        email_enabled: data.channels.email_enabled ?? true,
        email_address: data.channels.email_address ?? userEmail ?? "",
        sms_enabled: !!data.channels.sms_enabled,
        sms_phone: data.channels.sms_phone ?? "",
        sms_verified: !!data.channels.sms_verified,
        slack_enabled: !!data.channels.slack_enabled,
        slack_webhook_url: data.channels.slack_webhook_url ?? "",
        slack_channel: data.channels.slack_channel ?? "",
      }
      setConfig(fresh)
      setInitialConfig(fresh)
    } catch {
      // silent
    } finally {
      setLoading(false)
    }
  }, [userEmail])

  useEffect(() => { void load() }, [load])

  const hasChanges = initialConfig ? JSON.stringify(initialConfig) !== JSON.stringify(config) : false

  const showFeedback = (key: ChannelKey | "save", state: FeedbackState | null, ttl = 4000) => {
    setFeedback(prev => ({ ...prev, [key]: state }))
    if (state) setTimeout(() => setFeedback(prev => ({ ...prev, [key]: null })), ttl)
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const res = await fetch("/api/users/notification-channels", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email_enabled: config.email_enabled,
          email_address: config.email_address,
          sms_enabled: config.sms_enabled,
          sms_phone: config.sms_phone,
          slack_enabled: config.slack_enabled,
          slack_webhook_url: config.slack_webhook_url,
          slack_channel: config.slack_channel,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        showFeedback("save", { kind: "error", message: data?.error || "Erreur de sauvegarde" })
        return
      }
      const fresh: ChannelsConfig = {
        email_enabled: data.channels.email_enabled ?? true,
        email_address: data.channels.email_address ?? "",
        sms_enabled: !!data.channels.sms_enabled,
        sms_phone: data.channels.sms_phone ?? "",
        sms_verified: !!data.channels.sms_verified,
        slack_enabled: !!data.channels.slack_enabled,
        slack_webhook_url: data.channels.slack_webhook_url ?? "",
        slack_channel: data.channels.slack_channel ?? "",
      }
      setConfig(fresh)
      setInitialConfig(fresh)
      showFeedback("save", { kind: "success", message: "Préférences enregistrées" })
    } catch (err: any) {
      showFeedback("save", { kind: "error", message: err?.message || "Erreur" })
    } finally {
      setSaving(false)
    }
  }

  const handleTest = async (channel: ChannelKey) => {
    if (hasChanges) {
      showFeedback(channel, { kind: "error", message: "Enregistrez vos modifications avant de tester" })
      return
    }
    setTesting(channel)
    try {
      const res = await fetch("/api/users/notification-channels/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel }),
      })
      const data = await res.json()
      if (!res.ok) {
        showFeedback(channel, { kind: "error", message: data?.error || "Échec du test" })
        return
      }
      showFeedback(channel, { kind: "success", message: "Test envoyé ✓" })
    } catch (err: any) {
      showFeedback(channel, { kind: "error", message: err?.message || "Erreur" })
    } finally {
      setTesting(null)
    }
  }

  if (schemaMissing) {
    return (
      <section className="rounded-2xl border border-amber-200 dark:border-amber-900/40 bg-amber-50 dark:bg-amber-950/20 p-6 mb-6">
        <div className="flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400 mt-0.5" />
          <div>
            <h3 className="text-sm font-semibold text-amber-900 dark:text-amber-200">Configuration requise</h3>
            <p className="text-sm text-amber-800 dark:text-amber-300 mt-1">
              La table <code>user_notification_channels</code> est introuvable. Exécutez{" "}
              <code>supabase/migration_notification_channels.sql</code> dans l&apos;éditeur SQL Supabase.
            </p>
          </div>
        </div>
      </section>
    )
  }

  return (
    <section className="rounded-2xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] p-6 sm:p-8 mb-6">
      <div className="flex items-center gap-3 mb-6">
        <div className="p-2.5 rounded-xl bg-gradient-to-br from-emerald-50 to-teal-50 dark:from-emerald-950/40 dark:to-teal-950/30">
          <Bell className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">Canaux d&apos;alertes</h2>
          <p className="text-sm text-[var(--color-text-secondary)] mt-0.5">
            Choisissez où recevoir vos alertes Go-Data : email, SMS ou Slack.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
        </div>
      ) : (
        <>
          {/* EMAIL */}
          <ChannelCard
            icon={<Mail className="h-4 w-4 text-blue-600 dark:text-blue-400" />}
            title="Email"
            description="Rapport HTML détaillé envoyé à chaque détection de changement."
            enabled={config.email_enabled}
            onToggle={(v) => setConfig(c => ({ ...c, email_enabled: v }))}
            feedback={feedback.email}
            actionButton={
              <TestButton
                onClick={() => handleTest("email")}
                testing={testing === "email"}
                disabled={!config.email_enabled || !config.email_address}
              />
            }
          >
            <Field
              label="Adresse email"
              value={config.email_address || ""}
              placeholder={userEmail}
              type="email"
              onChange={(v) => setConfig(c => ({ ...c, email_address: v }))}
              hint="Laissez vide pour utiliser l'adresse de votre compte."
            />
          </ChannelCard>

          {/* SMS */}
          <ChannelCard
            icon={<MessageSquare className="h-4 w-4 text-violet-600 dark:text-violet-400" />}
            title="SMS"
            description="Résumé concis directement sur votre téléphone."
            enabled={config.sms_enabled}
            onToggle={(v) => setConfig(c => ({ ...c, sms_enabled: v }))}
            feedback={feedback.sms}
            disabledReason={!twilioAvailable ? "Twilio n'est pas configuré côté serveur" : undefined}
            actionButton={
              <TestButton
                onClick={() => handleTest("sms")}
                testing={testing === "sms"}
                disabled={!config.sms_enabled || !config.sms_phone || !twilioAvailable}
              />
            }
          >
            <Field
              label="Numéro de téléphone"
              value={config.sms_phone || ""}
              placeholder="+15145551234"
              type="tel"
              onChange={(v) => setConfig(c => ({ ...c, sms_phone: v }))}
              hint="Format international (E.164). Les numéros nord-américains sans indicatif recevront automatiquement +1."
            />
            {!twilioAvailable && (
              <div className="mt-3 text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/40 rounded-lg px-3 py-2 flex items-start gap-2">
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <span>
                  Twilio n&apos;est pas configuré côté serveur. Définissez <code>TWILIO_ACCOUNT_SID</code>,{" "}
                  <code>TWILIO_AUTH_TOKEN</code> et <code>TWILIO_FROM_NUMBER</code> pour activer les SMS.
                </span>
              </div>
            )}
          </ChannelCard>

          {/* SLACK */}
          <ChannelCard
            icon={<Slack className="h-4 w-4 text-fuchsia-600 dark:text-fuchsia-400" />}
            title="Slack"
            description="Message enrichi posté via un Incoming Webhook sur votre workspace."
            enabled={config.slack_enabled}
            onToggle={(v) => setConfig(c => ({ ...c, slack_enabled: v }))}
            feedback={feedback.slack}
            actionButton={
              <TestButton
                onClick={() => handleTest("slack")}
                testing={testing === "slack"}
                disabled={!config.slack_enabled || !config.slack_webhook_url}
              />
            }
          >
            <Field
              label="URL du webhook Slack"
              value={config.slack_webhook_url || ""}
              placeholder="https://hooks.slack.com/services/T.../B.../..."
              type="url"
              onChange={(v) => setConfig(c => ({ ...c, slack_webhook_url: v }))}
              hint={
                <>
                  Créez un{" "}
                  <a
                    href="https://api.slack.com/messaging/webhooks"
                    target="_blank"
                    rel="noreferrer"
                    className="text-emerald-600 dark:text-emerald-400 underline hover:no-underline"
                  >
                    Incoming Webhook Slack
                  </a>{" "}
                  pour le canal de votre choix.
                </>
              }
            />
            <div className="mt-4">
              <Field
                label="Canal (optionnel)"
                value={config.slack_channel || ""}
                placeholder="#alertes"
                type="text"
                onChange={(v) => setConfig(c => ({ ...c, slack_channel: v }))}
                hint="Forcer un canal spécifique (écrase la valeur par défaut du webhook)."
              />
            </div>
          </ChannelCard>

          {/* Save bar */}
          <div className="flex items-center justify-between pt-4 border-t border-[var(--color-border-tertiary)] mt-2">
            <div className="min-h-[24px]">
              {feedback.save && (
                <FeedbackBadge feedback={feedback.save} />
              )}
            </div>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || !hasChanges}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-semibold shadow-lg shadow-emerald-600/25 hover:bg-emerald-700 hover:shadow-xl hover:-translate-y-0.5 disabled:opacity-30 disabled:shadow-none disabled:translate-y-0 disabled:cursor-not-allowed transition-all"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Enregistrer
            </button>
          </div>
        </>
      )}
    </section>
  )
}

// ─── Sous-composants ────────────────────────────────────────────────

function ChannelCard({
  icon,
  title,
  description,
  enabled,
  onToggle,
  children,
  actionButton,
  feedback,
  disabledReason,
}: {
  icon: React.ReactNode
  title: string
  description: string
  enabled: boolean
  onToggle: (v: boolean) => void
  children?: React.ReactNode
  actionButton?: React.ReactNode
  feedback?: FeedbackState | null
  disabledReason?: string
}) {
  return (
    <div className="py-5 border-b border-[var(--color-border-tertiary)] last:border-b-0">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <div className="p-2 rounded-lg bg-[var(--color-background-secondary)]">{icon}</div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold text-[var(--color-text-primary)]">{title}</p>
              {enabled && (
                <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300">
                  Actif
                </span>
              )}
            </div>
            <p className="text-xs text-[var(--color-text-secondary)] mt-0.5">{description}</p>
            {disabledReason && !enabled && (
              <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1">{disabledReason}</p>
            )}
          </div>
        </div>
        <Toggle checked={enabled} onChange={onToggle} />
      </div>

      {enabled && (
        <div className="pl-11">
          {children}
          <div className="flex items-center justify-between gap-3 mt-4">
            <div className="min-h-[20px] flex-1">
              {feedback && <FeedbackBadge feedback={feedback} />}
            </div>
            {actionButton}
          </div>
        </div>
      )}
    </div>
  )
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors ${
        checked ? "bg-emerald-600" : "bg-gray-300 dark:bg-gray-700"
      }`}
    >
      <span
        className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
          checked ? "translate-x-5" : "translate-x-0"
        }`}
      />
    </button>
  )
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  hint,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  type?: string
  hint?: React.ReactNode
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1.5">{label}</label>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3.5 py-2.5 rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] text-[var(--color-text-primary)] text-sm placeholder-[var(--color-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500/50 transition"
      />
      {hint && <p className="mt-1.5 text-[11px] text-[var(--color-text-tertiary)]">{hint}</p>}
    </div>
  )
}

function TestButton({ onClick, testing, disabled }: { onClick: () => void; testing: boolean; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || testing}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--color-border-secondary)] text-xs font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-background-hover)] disabled:opacity-40 disabled:cursor-not-allowed transition"
    >
      {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
      Envoyer un test
    </button>
  )
}

function FeedbackBadge({ feedback }: { feedback: FeedbackState }) {
  const isOk = feedback.kind === "success"
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs font-medium ${
        isOk ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"
      }`}
    >
      {isOk ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
      {feedback.message}
    </span>
  )
}
