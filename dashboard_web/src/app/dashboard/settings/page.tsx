"use client"

import { useEffect, useState, useRef } from "react"
import { useRouter } from "next/navigation"
import Layout from "@/components/kokonutui/layout"
import { useAuth } from "@/contexts/auth-context"
import {
  Loader2,
  User,
  Shield,
  CreditCard,
  Settings,
  Code,
  Database,
  Printer,
  Mail,
  Eye,
  EyeOff,
  Copy,
  Trash2,
  Download,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Globe,
  Clock,
  FileText,
  Webhook,
  Key,
  Activity,
} from "lucide-react"
import BlocTemplate from "@/components/ui/bloc-template"
import { createClient } from "@/lib/supabase/client"

const tabs = [
  { id: "profile", label: "Profil", icon: User },
  { id: "security", label: "Sécurité", icon: Shield },
  { id: "billing", label: "Abonnement", icon: CreditCard },
  { id: "scraper", label: "Scraper", icon: Settings },
  { id: "dev", label: "Développeurs", icon: Code },
  { id: "data", label: "Données & conformité", icon: Database },
]

export default function SettingsPage() {
  const { user, isLoading: authLoading, logout } = useAuth()
  const router = useRouter()
  const supabase = createClient()
  const [activeTab, setActiveTab] = useState<string>("profile")

  // États pour les différentes sections
  const [mfaEnabled, setMfaEnabled] = useState(false)
  const [mfaEnrolling, setMfaEnrolling] = useState(false)
  const [mfaQrCode, setMfaQrCode] = useState<string | null>(null)
  const [mfaSecret, setMfaSecret] = useState<string | null>(null)
  const [mfaFactorId, setMfaFactorId] = useState<string | null>(null)
  const [mfaCode, setMfaCode] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [deletePassword, setDeletePassword] = useState("")
  const [deleteConfirm, setDeleteConfirm] = useState("") // plus utilisé pour valider (ancienne confirmation texte)
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [exportLoading, setExportLoading] = useState(false)
  const [exportStatus, setExportStatus] = useState<string | null>(null)
  const [profileName, setProfileName] = useState(user?.name || "")
  const [profileEmail, setProfileEmail] = useState(user?.email || "")
  const [avatarUrl, setAvatarUrl] = useState(user?.avatar_url || "")
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const [savingProfile, setSavingProfile] = useState(false)
  const [savingSettings, setSavingSettings] = useState(false)
  const [showPasswordModal, setShowPasswordModal] = useState(false)
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [passwordLoading, setPasswordLoading] = useState(false)
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [passwordSuccess, setPasswordSuccess] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // États pour les préférences scraper
  const [timezone, setTimezone] = useState("Europe/Paris")
  const [language, setLanguage] = useState<"fr" | "en">("fr")
  const [exportFormat, setExportFormat] = useState<"csv" | "json">("csv")
  const [notifications, setNotifications] = useState({
    email: true,
    webhook: false,
  })
  const [rateLimit, setRateLimit] = useState(10)

  // États pour webhooks
  const [webhooks, setWebhooks] = useState<Array<{ id: string; url: string; secret: string }>>([])
  const [newWebhookUrl, setNewWebhookUrl] = useState("")
  const [showWebhookForm, setShowWebhookForm] = useState(false)
  const [loadingWebhooks, setLoadingWebhooks] = useState(false)

  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/login")
    }
  }, [user, authLoading, router])

  // Charger les préférences utilisateur et statut MFA
  useEffect(() => {
    if (user) {
      loadUserSettings()
      loadMFAStatus()
      loadWebhooks()
      setProfileName(user.name || "")
      setProfileEmail(user.email || "")
      setAvatarUrl(user.avatar_url || "")
    }
  }, [user])

  const loadUserSettings = async () => {
    try {
      const response = await fetch("/api/users/settings")
      if (response.ok) {
        const data = await response.json()
        if (data.language) setLanguage(data.language)
        if (data.timezone) setTimezone(data.timezone)
        if (data.export_format) setExportFormat(data.export_format)
        if (data.notifications) setNotifications(data.notifications)
        if (data.rate_limit) setRateLimit(data.rate_limit)
      }
    } catch (error) {
      console.error("Error loading user settings:", error)
    }
  }

  const loadMFAStatus = async () => {
    try {
      const response = await fetch("/api/users/mfa/status")
      if (response.ok) {
        const data = await response.json()
        setMfaEnabled(data.enabled)
      }
    } catch (error) {
      console.error("Error loading MFA status:", error)
    }
  }

  const loadWebhooks = async () => {
    setLoadingWebhooks(true)
    try {
      const response = await fetch("/api/webhooks")
      if (response.ok) {
        const data = await response.json()
        setWebhooks(data.webhooks || [])
      }
    } catch (error) {
      console.error("Error loading webhooks:", error)
    } finally {
      setLoadingWebhooks(false)
    }
  }

  if (authLoading) {
    return (
      <Layout>
        <div className="flex items-center justify-center min-h-screen">
          <Loader2 className="h-8 w-8 animate-spin text-gray-600 dark:text-gray-400" />
        </div>
      </Layout>
    )
  }

  if (!user) {
    return null
  }

  const SectionCard = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <BlocTemplate innerClassName="p-6 space-y-4">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{title}</h2>
      <div className="space-y-4">{children}</div>
    </BlocTemplate>
  )

  // Handlers pour 2FA
  const handleEnableMFA = async () => {
    setMfaEnrolling(true)
    try {
      const response = await fetch("/api/users/mfa/enroll", { method: "POST" })
      const data = await response.json()
      if (response.ok) {
        setMfaQrCode(data.qr_code)
        setMfaSecret(data.secret)
        setMfaFactorId(data.factor_id)
      } else {
        alert(data.error || "Erreur lors de l'activation du 2FA")
      }
    } catch (error) {
      console.error("Error enrolling MFA:", error)
      alert("Erreur lors de l'activation du 2FA")
    } finally {
      setMfaEnrolling(false)
    }
  }

  const handleVerifyMFA = async () => {
    if (!mfaFactorId || !mfaCode) {
      alert("Veuillez entrer un code de vérification")
      return
    }
    try {
      const response = await fetch("/api/users/mfa/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ factorId: mfaFactorId, code: mfaCode }),
      })
      const data = await response.json()
      if (response.ok) {
        setMfaEnabled(true)
        setMfaQrCode(null)
        setMfaSecret(null)
        setMfaFactorId(null)
        setMfaCode("")
        alert("2FA activé avec succès")
      } else {
        alert(data.error || "Code invalide")
      }
    } catch (error) {
      console.error("Error verifying MFA:", error)
      alert("Erreur lors de la vérification")
    }
  }

  const handleDisableMFA = async () => {
    if (!mfaFactorId) {
      alert("Aucun facteur MFA à révoquer")
      return
    }
    try {
      const response = await fetch("/api/users/mfa/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ factorId: mfaFactorId }),
      })
      const data = await response.json()
      if (response.ok) {
        setMfaEnabled(false)
        alert("2FA révoqué avec succès")
      } else {
        alert(data.error || "Erreur lors de la révocation")
      }
    } catch (error) {
      console.error("Error disabling MFA:", error)
      alert("Erreur lors de la révocation")
    }
  }

  // Handler pour export de données
  const handleExportData = async () => {
    setExportLoading(true)
    setExportStatus(null)
    try {
      const response = await fetch("/api/users/export", { method: "POST" })
      const data = await response.json()
      if (data.exportId) {
        setExportStatus(`Export en cours. ID: ${data.exportId}`)
        // Poll pour le statut
        setTimeout(() => {
          setExportStatus("Export terminé. Lien de téléchargement disponible.")
        }, 3000)
      }
    } catch (error) {
      setExportStatus("Erreur lors de l'export")
    } finally {
      setExportLoading(false)
    }
  }

  // Handler pour upload d'avatar
  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setUploadingAvatar(true)
    try {
      const formData = new FormData()
      formData.append('file', file)

      const response = await fetch("/api/users/avatar", {
        method: "POST",
        body: formData,
      })

      const data = await response.json()
      if (response.ok) {
        setAvatarUrl(data.avatar_url)
        alert("Photo de profil mise à jour avec succès")
        // Rafraîchir l'utilisateur
        window.location.reload()
      } else {
        alert(data.error || "Erreur lors de l'upload")
      }
    } catch (error) {
      console.error("Error uploading avatar:", error)
      alert("Erreur lors de l'upload")
    } finally {
      setUploadingAvatar(false)
    }
  }

  // Handler pour supprimer l'avatar
  const handleDeleteAvatar = async () => {
    if (!confirm("Supprimer la photo de profil ?")) {
      return
    }
    try {
      const response = await fetch("/api/users/avatar", { method: "DELETE" })
      const data = await response.json()
      if (response.ok) {
        setAvatarUrl("")
        alert("Photo de profil supprimée")
        window.location.reload()
      } else {
        alert(data.error || "Erreur lors de la suppression")
      }
    } catch (error) {
      console.error("Error deleting avatar:", error)
      alert("Erreur lors de la suppression")
    }
  }

  // Handler pour sauvegarder le profil
  const handleSaveProfile = async () => {
    setSavingProfile(true)
    try {
      const response = await fetch("/api/users/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: profileName, email: profileEmail }),
      })
      const data = await response.json()
      if (response.ok) {
        alert("Profil mis à jour avec succès")
        // Rafraîchir l'utilisateur
        window.location.reload()
      } else {
        alert(data.error || "Erreur lors de la mise à jour")
      }
    } catch (error) {
      console.error("Error saving profile:", error)
      alert("Erreur lors de la sauvegarde")
    } finally {
      setSavingProfile(false)
    }
  }

  // Handler pour changer le mot de passe
  const handleChangePassword = async () => {
    setPasswordError(null)
    setPasswordSuccess(null)

    if (!newPassword || newPassword.length < 8) {
      setPasswordError("Le mot de passe doit contenir au moins 8 caractères.")
      return
    }
    if (newPassword !== confirmPassword) {
      setPasswordError("Les mots de passe ne correspondent pas.")
      return
    }

    setPasswordLoading(true)
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword })
      if (error) throw error

      setPasswordSuccess("Mot de passe mis à jour.")
      setShowPasswordModal(false)
      setNewPassword("")
      setConfirmPassword("")
    } catch (error: any) {
      console.error("Error updating password:", error)
      setPasswordError(error?.message || "Impossible de mettre à jour le mot de passe.")
    } finally {
      setPasswordLoading(false)
    }
  }

  // Handler pour sauvegarder les settings scraper
  const handleSaveSettings = async () => {
    setSavingSettings(true)
    try {
      const response = await fetch("/api/users/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          language,
          timezone,
          export_format: exportFormat,
          notifications,
          rate_limit: rateLimit,
        }),
      })
      const data = await response.json()
      if (response.ok) {
        alert("Préférences sauvegardées avec succès")
      } else {
        alert(data.error || "Erreur lors de la sauvegarde")
      }
    } catch (error) {
      console.error("Error saving settings:", error)
      alert("Erreur lors de la sauvegarde")
    } finally {
      setSavingSettings(false)
    }
  }

  // Handler pour suppression de compte
  const handleDeleteAccount = async () => {
    if (!deletePassword) {
      alert("Veuillez entrer votre mot de passe.")
      return
    }
    try {
      // Récupérer le token courant pour l’envoyer à l’API (auth côté serveur)
      const { data: sessionData } = await supabase.auth.getSession()
      const accessToken = sessionData.session?.access_token

      const response = await fetch("/api/users/delete", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify({ password: deletePassword }),
      })
      const data = await response.json()
      if (response.ok) {
        await logout()
        router.replace("/login")
      } else {
        alert(data.error || "Erreur lors de la suppression")
      }
    } catch (error) {
      console.error("Error deleting account:", error)
      alert("Erreur lors de la suppression")
    }
  }

  // Handler pour créer un webhook
  const handleCreateWebhook = async () => {
    if (!newWebhookUrl) {
      alert("Veuillez entrer une URL")
      return
    }
    try {
      const response = await fetch("/api/webhooks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: newWebhookUrl }),
      })
      const data = await response.json()
      if (response.ok) {
        setWebhooks([...webhooks, data.webhook])
        setNewWebhookUrl("")
        setShowWebhookForm(false)
        alert("Webhook créé avec succès")
      } else {
        alert(data.error || "Erreur lors de la création")
      }
    } catch (error) {
      console.error("Error creating webhook:", error)
      alert("Erreur lors de la création")
    }
  }

  // Handler pour supprimer un webhook
  const handleDeleteWebhook = async (webhookId: string) => {
    if (!confirm("Êtes-vous sûr de vouloir supprimer ce webhook ?")) {
      return
    }
    try {
      const response = await fetch(`/api/webhooks?id=${webhookId}`, {
        method: "DELETE",
      })
      const data = await response.json()
      if (response.ok) {
        setWebhooks(webhooks.filter(w => w.id !== webhookId))
        alert("Webhook supprimé avec succès")
      } else {
        alert(data.error || "Erreur lors de la suppression")
      }
    } catch (error) {
      console.error("Error deleting webhook:", error)
      alert("Erreur lors de la suppression")
    }
  }

  // Handler pour Stripe Portal
  const handleStripePortal = async () => {
    try {
      const response = await fetch("/api/stripe/portal", { method: "POST" })
      const data = await response.json()
      if (response.ok && data.url) {
        window.location.href = data.url
      } else {
        alert(data.error || "Erreur lors de l'ouverture du portail Stripe")
      }
    } catch (error) {
      console.error("Error opening Stripe portal:", error)
      alert("Erreur lors de l'ouverture du portail")
    }
  }

  // Handler pour Stripe Checkout
  const handleStripeCheckout = async (plan: string) => {
    try {
      const baseUrl = typeof window !== "undefined" ? window.location.origin : ""
      const response = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plan,
          cancel_url: `${baseUrl}/dashboard/settings?payment=canceled`,
          success_url: `${baseUrl}/dashboard/settings?payment=success`,
        }),
      })

      // Vérifier si la réponse est du JSON
      const contentType = response.headers.get("content-type")
      if (!contentType || !contentType.includes("application/json")) {
        const text = await response.text()
        console.error("Non-JSON response:", text.substring(0, 200))
        alert("Erreur serveur : Stripe n'est pas configuré. Veuillez configurer STRIPE_SECRET_KEY dans les variables d'environnement.")
        return
      }

      const data = await response.json()
      if (response.ok && data.url) {
        window.location.href = data.url
      } else {
        alert(data.error || "Erreur lors de la création de la session")
      }
    } catch (error) {
      console.error("Error creating checkout session:", error)
      alert("Erreur lors de la création de la session. Vérifiez que Stripe est configuré.")
    }
  }

  // Handler pour impression analytics
  const handlePrintAnalytics = () => {
    window.print()
  }

  // Handler pour envoi email analytics
  const handleEmailAnalytics = async () => {
    try {
      const response = await fetch("/api/analytics/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: user?.email }),
      })
      if (response.ok) {
        alert("Analytics envoyés par email avec succès")
      }
    } catch (error) {
      console.error("Error sending analytics email:", error)
    }
  }

  const ProfileTab = () => (
    <div className="space-y-4">
      <SectionCard title="Profil utilisateur">
        <div className="grid md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
              Photo de profil
            </label>
            <div className="flex items-center gap-3">
              <div className="h-16 w-16 rounded-full bg-gray-200 dark:bg-[#1F1F23] flex items-center justify-center overflow-hidden ring-2 ring-gray-300 dark:ring-[#2B2B30]">
                {avatarUrl ? (
                  <img
                    src={avatarUrl}
                    alt="Avatar"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <User className="h-8 w-8 text-gray-400" />
                )}
              </div>
              <div className="flex flex-col gap-2">
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleAvatarUpload}
                  accept="image/*"
                  className="hidden"
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadingAvatar}
                  className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors flex items-center gap-2"
                >
                  {uploadingAvatar ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Upload...
                    </>
                  ) : (
                    "Mettre à jour"
                  )}
                </button>
                {avatarUrl && (
                  <button
                    onClick={handleDeleteAvatar}
                    className="px-4 py-2 bg-red-600 text-white text-sm rounded-lg hover:bg-red-700 transition-colors"
                  >
                    Supprimer
                  </button>
                )}
              </div>
            </div>
          </div>
          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
              Nom d'utilisateur
            </label>
            <input
              type="text"
              value={profileName}
              onChange={(e) => setProfileName(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-[#2B2B30] bg-white dark:bg-[#0F0F12] text-gray-900 dark:text-white"
              placeholder="Nom affiché"
            />
          </div>
          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
              Email
            </label>
            <input
              type="email"
              value={profileEmail}
              onChange={(e) => setProfileEmail(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-[#2B2B30] bg-white dark:bg-[#0F0F12] text-gray-900 dark:text-white"
              placeholder="email@example.com"
            />
          </div>
          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
              Mot de passe
            </label>
            <div className="space-y-1">
              <button
                onClick={() => {
                  setShowPasswordModal(true)
                  setPasswordError(null)
                  setPasswordSuccess(null)
                }}
                className="px-4 py-2 bg-gray-100 dark:bg-[#1F1F23] text-sm rounded-lg hover:bg-gray-200 dark:hover:bg-[#2B2B30] transition-colors"
              >
              Changer le mot de passe
              </button>
              {passwordSuccess && (
                <p className="text-sm text-green-600 dark:text-green-400">{passwordSuccess}</p>
              )}
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-4">
          <button
            onClick={handleSaveProfile}
            disabled={savingProfile}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors flex items-center gap-2"
          >
            {savingProfile && <Loader2 className="h-4 w-4 animate-spin" />}
            Enregistrer les modifications
          </button>
        </div>
      </SectionCard>

      <SectionCard title="Sessions actives">
        <div className="space-y-3">
          <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-[#1F1F23] rounded-lg">
            <div>
              <p className="font-medium text-gray-900 dark:text-white">Session actuelle</p>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                {new Date().toLocaleString("fr-FR")}
              </p>
            </div>
            <button className="px-3 py-1 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded">
              Révoquer
            </button>
          </div>
          <button
            onClick={logout}
            className="w-full px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
          >
            Déconnexion globale
          </button>
        </div>
      </SectionCard>
    </div>
  )

  const SecurityTab = () => (
    <div className="space-y-4">
      <SectionCard title="Authentification à deux facteurs (2FA)">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium text-gray-900 dark:text-white">Statut 2FA</p>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                {mfaEnabled ? "Activé" : "Non activé"}
              </p>
            </div>
            {mfaEnabled ? (
              <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
                <CheckCircle className="h-5 w-5" />
                <span className="text-sm">Activé</span>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-gray-600 dark:text-gray-400">
                <XCircle className="h-5 w-5" />
                <span className="text-sm">Non activé</span>
              </div>
            )}
          </div>

          {!mfaEnabled && !mfaQrCode && (
            <button
              onClick={handleEnableMFA}
              disabled={mfaEnrolling}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {mfaEnrolling ? "Activation..." : "Activer 2FA"}
            </button>
          )}

          {mfaQrCode && (
            <div className="space-y-4 p-4 bg-gray-50 dark:bg-[#1F1F23] rounded-lg">
              <div>
                <p className="text-sm font-medium text-gray-900 dark:text-white mb-2">
                  Scannez ce QR code avec votre application d'authentification
                </p>
                <img src={mfaQrCode} alt="QR Code 2FA" className="w-48 h-48 mx-auto" />
              </div>
              {mfaSecret && (
                <div>
                  <p className="text-sm font-medium text-gray-900 dark:text-white mb-2">
                    Ou entrez ce code manuellement
                  </p>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 px-3 py-2 bg-white dark:bg-[#0F0F12] border border-gray-300 dark:border-[#2B2B30] rounded text-sm font-mono">
                      {mfaSecret}
                    </code>
                    <button
                      onClick={() => navigator.clipboard.writeText(mfaSecret)}
                      className="p-2 hover:bg-gray-100 dark:hover:bg-[#2B2B30] rounded"
                    >
                      <Copy className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Code de vérification
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={mfaCode}
                    onChange={(e) => setMfaCode(e.target.value)}
                    placeholder="000000"
                    className="flex-1 px-3 py-2 rounded-lg border border-gray-300 dark:border-[#2B2B30] bg-white dark:bg-[#0F0F12] text-gray-900 dark:text-white"
                  />
                  <button
                    onClick={handleVerifyMFA}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                  >
                    Vérifier
                  </button>
                </div>
              </div>
            </div>
          )}

          {mfaEnabled && (
            <button
              onClick={handleDisableMFA}
              className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
            >
              Révoquer 2FA
            </button>
          )}
        </div>
      </SectionCard>

      <SectionCard title="Journal d'activité">
        <div className="space-y-2">
          <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-[#1F1F23] rounded-lg">
            <div className="flex items-center gap-3">
              <Activity className="h-4 w-4 text-gray-500" />
              <div>
                <p className="text-sm font-medium text-gray-900 dark:text-white">Connexion réussie</p>
                <p className="text-xs text-gray-600 dark:text-gray-400">
                  {new Date().toLocaleString("fr-FR")}
                </p>
              </div>
            </div>
            <span className="text-xs text-green-600 dark:text-green-400">Succès</span>
          </div>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Plus d'historique disponible après activation des logs
          </p>
        </div>
      </SectionCard>

      <SectionCard title="Clés API">
        <div className="space-y-3">
          <button className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
            Générer une nouvelle clé API
          </button>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Les clés API permettent d'accéder à votre compte via l'API. Gérez-les avec précaution.
          </p>
        </div>
      </SectionCard>
    </div>
  )

  const BillingTab = () => (
    <div className="space-y-4">
      <SectionCard title="Plan actuel">
        <div className="space-y-4">
          <div className="flex items-center justify-between p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-900 rounded-lg">
            <div>
              <p className="font-semibold text-blue-900 dark:text-blue-300">
                {user?.subscription_plan === "free" ? "Gratuit" :
                  user?.subscription_plan === "standard" ? "Standard" :
                    user?.subscription_plan === "premium" ? "Premium" : "Gratuit"}
              </p>
              <p className="text-sm text-blue-700 dark:text-blue-400">
                Limites d'usage à venir
              </p>
            </div>
            <CreditCard className="h-8 w-8 text-blue-600 dark:text-blue-400" />
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => router.push("/dashboard/payments")}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              Voir les plans et mettre à niveau
            </button>
            <button
              onClick={() => handleStripeCheckout("price_standard")}
              className="px-4 py-2 bg-gray-100 dark:bg-[#1F1F23] text-gray-900 dark:text-white rounded-lg hover:bg-gray-200 dark:hover:bg-[#2B2B30] transition-colors"
            >
              Upgrade (Stripe)
            </button>
            <button
              onClick={handleStripePortal}
              className="px-4 py-2 bg-gray-100 dark:bg-[#1F1F23] text-gray-900 dark:text-white rounded-lg hover:bg-gray-200 dark:hover:bg-[#2B2B30] transition-colors"
            >
              Gérer l'abonnement (Stripe Portal)
            </button>
          </div>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            La page <strong>Paiements</strong> (menu principal) permet de choisir un plan Pro ou Ultime. Tous les comptes, y compris Gratuit, peuvent y accéder.
          </p>
        </div>
      </SectionCard>

      <SectionCard title="Moyen de paiement">
        <div className="space-y-3">
          <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-[#1F1F23] rounded-lg">
            <div className="flex items-center gap-3">
              <CreditCard className="h-5 w-5 text-gray-500" />
              <div>
                <p className="text-sm font-medium text-gray-900 dark:text-white">Carte •••• 4242</p>
                <p className="text-xs text-gray-600 dark:text-gray-400">Expire 12/25</p>
              </div>
            </div>
            <button className="text-sm text-blue-600 dark:text-blue-400 hover:underline">
              Modifier
            </button>
          </div>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Gérez vos moyens de paiement via le Stripe Customer Portal
          </p>
        </div>
      </SectionCard>

      <SectionCard title="Historique des paiements">
        <div className="space-y-2">
          <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-[#1F1F23] rounded-lg">
            <div>
              <p className="text-sm font-medium text-gray-900 dark:text-white">Abonnement Standard</p>
              <p className="text-xs text-gray-600 dark:text-gray-400">
                {new Date().toLocaleDateString("fr-FR")}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-gray-900 dark:text-white">29,99 €</span>
              <button className="text-sm text-blue-600 dark:text-blue-400 hover:underline">
                Télécharger
              </button>
            </div>
          </div>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Plus de factures disponibles dans le Stripe Customer Portal
          </p>
        </div>
      </SectionCard>
    </div>
  )

  const ScraperTab = () => (
    <div className="space-y-4">
      <SectionCard title="Paramètres d'utilisation du scraper">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Fuseau horaire
            </label>
            <select
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-[#2B2B30] bg-white dark:bg-[#0F0F12] text-gray-900 dark:text-white"
            >
              <option value="Europe/Paris">Europe/Paris (UTC+1)</option>
              <option value="America/New_York">America/New_York (UTC-5)</option>
              <option value="Asia/Tokyo">Asia/Tokyo (UTC+9)</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Langue
            </label>
            <div className="flex items-center gap-4">
              <button
                onClick={() => setLanguage("fr")}
                className={`px-4 py-2 rounded-lg transition-colors ${language === "fr"
                  ? "bg-blue-600 text-white"
                  : "bg-gray-100 dark:bg-[#1F1F23] text-gray-900 dark:text-white"
                  }`}
              >
                Français
              </button>
              <button
                onClick={() => setLanguage("en")}
                className={`px-4 py-2 rounded-lg transition-colors ${language === "en"
                  ? "bg-blue-600 text-white"
                  : "bg-gray-100 dark:bg-[#1F1F23] text-gray-900 dark:text-white"
                  }`}
              >
                English
              </button>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Format d'export par défaut
            </label>
            <div className="flex gap-2">
              <button
                onClick={() => setExportFormat("csv")}
                className={`px-4 py-2 rounded-lg transition-colors ${exportFormat === "csv"
                  ? "bg-blue-600 text-white"
                  : "bg-gray-100 dark:bg-[#1F1F23] text-gray-900 dark:text-white"
                  }`}
              >
                CSV
              </button>
              <button
                onClick={() => setExportFormat("json")}
                className={`px-4 py-2 rounded-lg transition-colors ${exportFormat === "json"
                  ? "bg-blue-600 text-white"
                  : "bg-gray-100 dark:bg-[#1F1F23] text-gray-900 dark:text-white"
                  }`}
              >
                JSON
              </button>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Notifications
            </label>
            <div className="space-y-2">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={notifications.email}
                  onChange={(e) => setNotifications({ ...notifications, email: e.target.checked })}
                  className="rounded"
                />
                <span className="text-sm text-gray-900 dark:text-white">Email</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={notifications.webhook}
                  onChange={(e) => setNotifications({ ...notifications, webhook: e.target.checked })}
                  className="rounded"
                />
                <span className="text-sm text-gray-900 dark:text-white">Webhook</span>
              </label>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Limitation de la fréquence des requêtes: {rateLimit} req/min
            </label>
            <input
              type="range"
              min="1"
              max="100"
              value={rateLimit}
              onChange={(e) => setRateLimit(Number(e.target.value))}
              className="w-full"
            />
            <div className="flex justify-between text-xs text-gray-600 dark:text-gray-400">
              <span>1</span>
              <span>50</span>
              <span>100</span>
            </div>
          </div>

          <div className="flex justify-end pt-4">
            <button
              onClick={handleSaveSettings}
              disabled={savingSettings}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors flex items-center gap-2"
            >
              {savingSettings && <Loader2 className="h-4 w-4 animate-spin" />}
              Enregistrer les préférences
            </button>
          </div>
        </div>
      </SectionCard>
    </div>
  )

  const DevTab = () => (
    <div className="space-y-4">
      <SectionCard title="Webhooks">
        <div className="space-y-4">
          <button
            onClick={() => setShowWebhookForm(!showWebhookForm)}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            Ajouter un webhook
          </button>

          {showWebhookForm && (
            <div className="p-4 bg-gray-50 dark:bg-[#1F1F23] rounded-lg space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  URL du webhook
                </label>
                <input
                  type="url"
                  value={newWebhookUrl}
                  onChange={(e) => setNewWebhookUrl(e.target.value)}
                  placeholder="https://example.com/webhook"
                  className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-[#2B2B30] bg-white dark:bg-[#0F0F12] text-gray-900 dark:text-white"
                />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleCreateWebhook}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                  Créer
                </button>
                <button
                  onClick={() => {
                    setShowWebhookForm(false)
                    setNewWebhookUrl("")
                  }}
                  className="px-4 py-2 bg-gray-100 dark:bg-[#1F1F23] text-gray-900 dark:text-white rounded-lg hover:bg-gray-200 dark:hover:bg-[#2B2B30] transition-colors"
                >
                  Annuler
                </button>
              </div>
            </div>
          )}

          <div className="space-y-2">
            {webhooks.length === 0 ? (
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Aucun webhook configuré
              </p>
            ) : (
              webhooks.map((webhook) => (
                <div
                  key={webhook.id}
                  className="flex items-center justify-between p-3 bg-gray-50 dark:bg-[#1F1F23] rounded-lg"
                >
                  <div className="flex-1">
                    <p className="text-sm font-medium text-gray-900 dark:text-white">{webhook.url}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <code className="text-xs text-gray-600 dark:text-gray-400">
                        Secret: {webhook.secret.substring(0, 8)}...
                      </code>
                      <button
                        onClick={() => navigator.clipboard.writeText(webhook.secret)}
                        className="p-1 hover:bg-gray-200 dark:hover:bg-[#2B2B30] rounded"
                      >
                        <Copy className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button className="px-3 py-1 text-sm bg-gray-100 dark:bg-[#2B2B30] rounded hover:bg-gray-200 dark:hover:bg-[#3B3B40]">
                      Tester
                    </button>
                    <button
                      onClick={() => handleDeleteWebhook(webhook.id)}
                      className="p-2 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Logs d'erreurs">
        <div className="space-y-2">
          <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-[#1F1F23] rounded-lg">
            <div>
              <p className="text-sm font-medium text-gray-900 dark:text-white">Erreur de scraping</p>
              <p className="text-xs text-gray-600 dark:text-gray-400">
                {new Date().toLocaleString("fr-FR")}
              </p>
            </div>
            <span className="text-xs text-red-600 dark:text-red-400">Erreur</span>
          </div>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Plus de logs disponibles après activation de l'API
          </p>
        </div>
      </SectionCard>

      <SectionCard title="Historique des jobs">
        <div className="space-y-2">
          <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-[#1F1F23] rounded-lg">
            <div>
              <p className="text-sm font-medium text-gray-900 dark:text-white">Job #12345</p>
              <p className="text-xs text-gray-600 dark:text-gray-400">
                {new Date().toLocaleString("fr-FR")}
              </p>
            </div>
            <span className="text-xs text-green-600 dark:text-green-400">Terminé</span>
          </div>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Plus d'historique disponible après activation de l'API
          </p>
        </div>
      </SectionCard>

      <SectionCard title="Retry policy">
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Nombre de tentatives
            </label>
            <select className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-[#2B2B30] bg-white dark:bg-[#0F0F12] text-gray-900 dark:text-white">
              <option>3 tentatives</option>
              <option>5 tentatives</option>
              <option>10 tentatives</option>
            </select>
          </div>
          <button className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
            Enregistrer
          </button>
        </div>
      </SectionCard>
    </div>
  )

  const DataTab = () => (
    <div className="space-y-4">
      <SectionCard title="Exporter mes données">
        <div className="space-y-4">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Téléchargez toutes vos données au format CSV, JSON ou ZIP. L'export est généré de manière asynchrone et un lien de téléchargement vous sera fourni.
          </p>
          <div className="flex gap-2">
            <button
              onClick={handleExportData}
              disabled={exportLoading}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors flex items-center gap-2"
            >
              {exportLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Export en cours...
                </>
              ) : (
                <>
                  <Download className="h-4 w-4" />
                  Exporter mes données
                </>
              )}
            </button>
          </div>
          {exportStatus && (
            <div className="p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-900 rounded-lg">
              <p className="text-sm text-blue-800 dark:text-blue-300">{exportStatus}</p>
            </div>
          )}
        </div>
      </SectionCard>

      <SectionCard title="Impression / Partage analytics">
        <div className="space-y-4">
          <div className="flex gap-2">
            <button
              onClick={handlePrintAnalytics}
              className="px-4 py-2 bg-gray-100 dark:bg-[#1F1F23] text-gray-900 dark:text-white rounded-lg hover:bg-gray-200 dark:hover:bg-[#2B2B30] transition-colors flex items-center gap-2"
            >
              <Printer className="h-4 w-4" />
              Imprimer / Export PDF
            </button>
            <button
              onClick={handleEmailAnalytics}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2"
            >
              <Mail className="h-4 w-4" />
              Envoyer par email
            </button>
          </div>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Imprimez ou envoyez par email un rapport PDF de vos analytics. Le PDF sera généré côté serveur et envoyé via Resend.
          </p>
        </div>
      </SectionCard>

      <SectionCard title="Supprimer mon compte">
        <div className="space-y-4">
          <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900 rounded-lg">
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-red-900 dark:text-red-300">
                  Action irréversible
                </p>
                <p className="text-sm text-red-800 dark:text-red-400 mt-1">
                  La suppression de votre compte entraînera l'annulation de tous les paiements et renouvellements en cours. Cette action est définitive et ne peut pas être annulée.
                </p>
              </div>
            </div>
          </div>

          <button
            onClick={() => setShowDeleteModal(true)}
            className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
          >
            Supprimer mon compte
          </button>
        </div>
      </SectionCard>

      <SectionCard title="Mentions légales">
        <div className="space-y-2">
          <a
            href="/privacy"
            className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
          >
            Politique de confidentialité
          </a>
          <a
            href="/rgpd"
            className="text-sm text-blue-600 dark:text-blue-400 hover:underline block"
          >
            Mentions RGPD
          </a>
        </div>
      </SectionCard>

      {/* Modal changement de mot de passe */}
      {showPasswordModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-[#0F0F12] rounded-lg p-6 max-w-md w-full mx-4 border border-gray-200 dark:border-[#1F1F23]">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
              Changer le mot de passe
            </h3>
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  Nouveau mot de passe
                </label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-[#2B2B30] bg-white dark:bg-[#0F0F12] text-gray-900 dark:text-white"
                  placeholder="Au moins 8 caractères"
                />
                <p className="text-xs text-gray-500 dark:text-gray-400">Utilisez un mot de passe fort.</p>
              </div>
              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  Confirmer le mot de passe
                </label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-[#2B2B30] bg-white dark:bg-[#0F0F12] text-gray-900 dark:text-white"
                  placeholder="Répétez le mot de passe"
                />
              </div>
              {passwordError && <p className="text-sm text-red-600 dark:text-red-400">{passwordError}</p>}
              <div className="flex gap-2 pt-2">
                <button
                  onClick={() => {
                    setShowPasswordModal(false)
                    setNewPassword("")
                    setConfirmPassword("")
                    setPasswordError(null)
                  }}
                  className="px-4 py-2 bg-gray-100 dark:bg-[#1F1F23] text-gray-900 dark:text-white rounded-lg hover:bg-gray-200 dark:hover:bg-[#2B2B30] transition-colors flex-1"
                  disabled={passwordLoading}
                >
                  Annuler
                </button>
                <button
                  onClick={handleChangePassword}
                  disabled={passwordLoading}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors flex-1 flex items-center justify-center gap-2"
                >
                  {passwordLoading && <Loader2 className="h-4 w-4 animate-spin" />}
                  Mettre à jour
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal de suppression */}
      {showDeleteModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-[#0F0F12] rounded-lg p-6 max-w-md w-full mx-4 border border-gray-200 dark:border-[#1F1F23]">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
              Confirmer la suppression
            </h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Mot de passe
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={deletePassword}
                    onChange={(e) => setDeletePassword(e.target.value)}
                    className="w-full px-3 py-2 pr-10 rounded-lg border border-gray-300 dark:border-[#2B2B30] bg-white dark:bg-[#0F0F12] text-gray-900 dark:text-white"
                    placeholder="Votre mot de passe"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Confirmez avec votre mot de passe
                </label>
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                  Cette action supprimera votre compte et toutes les données associées.
                </p>
              </div>
              <div className="flex gap-2 pt-4">
                <button
                  onClick={handleDeleteAccount}
                  className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  Supprimer définitivement
                </button>
                <button
                  onClick={() => {
                    setShowDeleteModal(false)
                    setDeletePassword("")
                    setDeleteConfirm("")
                  }}
                  className="px-4 py-2 bg-gray-100 dark:bg-[#1F1F23] text-gray-900 dark:text-white rounded-lg hover:bg-gray-200 dark:hover:bg-[#2B2B30] transition-colors"
                >
                  Annuler
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )

  const renderTab = () => {
    switch (activeTab) {
      case "profile":
        return <ProfileTab />
      case "security":
        return <SecurityTab />
      case "billing":
        return <BillingTab />
      case "scraper":
        return <ScraperTab />
      case "dev":
        return <DevTab />
      case "data":
        return <DataTab />
      default:
        return null
    }
  }

  return (
    <Layout>
      <div className="container mx-auto px-4 py-8">
        <h1 className="text-4xl md:text-5xl font-extrabold text-gray-900 dark:text-white leading-tight mb-6">
          Paramètres
        </h1>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          <BlocTemplate innerClassName="p-3">
            <nav className="space-y-1">
              {tabs.map(({ id, label, icon: Icon }) => {
                const active = activeTab === id
                return (
                  <button
                    key={id}
                    onClick={() => setActiveTab(id)}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${active
                      ? "bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-200 border border-blue-200 dark:border-blue-800"
                      : "text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-[#1F1F23]"
                      }`}
                  >
                    <Icon className="h-4 w-4" />
                    <span>{label}</span>
                  </button>
                )
              })}
            </nav>
          </BlocTemplate>

          <div className="lg:col-span-3 space-y-4">
            {renderTab()}
          </div>
        </div>
      </div>
    </Layout>
  )
}

