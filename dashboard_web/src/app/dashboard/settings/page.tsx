"use client"

import { useEffect, useState, useRef } from "react"
import { useRouter } from "next/navigation"
import Layout from "@/components/kokonutui/layout"
import { useAuth } from "@/contexts/auth-context"
import { useLanguage } from "@/contexts/language-context"
import {
  Loader2,
  User,
  Camera,
  Eye,
  EyeOff,
  Download,
  AlertTriangle,
  ExternalLink,
  Trash2,
  ChevronRight,
  Check,
  X,
  CreditCard,
  Lock,
  Sparkles,
  Shield,
  FileDown,
  Globe,
} from "lucide-react"
import { createClient } from "@/lib/supabase/client"

export default function SettingsPage() {
  const { user, isLoading: authLoading, logout, refreshUser } = useAuth()
  const { t, locale, setLocale } = useLanguage()
  const router = useRouter()
  const supabase = createClient()

  const [profileName, setProfileName] = useState("")
  const [profileEmail, setProfileEmail] = useState("")
  const [avatarUrl, setAvatarUrl] = useState("")
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const [savingProfile, setSavingProfile] = useState(false)
  const [profileSaved, setProfileSaved] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [showPasswordModal, setShowPasswordModal] = useState(false)
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [passwordLoading, setPasswordLoading] = useState(false)
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [passwordSuccess, setPasswordSuccess] = useState(false)

  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [deletePassword, setDeletePassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)

  const [exportLoading, setExportLoading] = useState(false)
  const [exportDone, setExportDone] = useState(false)

  useEffect(() => {
    if (!authLoading && !user) router.push("/login")
  }, [user, authLoading, router])

  useEffect(() => {
    if (user) {
      setProfileName(user.name || "")
      setProfileEmail(user.email || "")
      setAvatarUrl(user.avatar_url || "")
    }
  }, [user])

  if (authLoading) {
    return (
      <Layout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
        </div>
      </Layout>
    )
  }

  if (!user) return null

  const planLabel = user.subscription_plan === "pro" ? "Pro" : user.subscription_plan === "ultime" ? (locale === "en" ? "Ultimate" : "Ultime") : t("profile.free")
  const isPaid = planLabel !== t("profile.free")

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadingAvatar(true)
    try {
      const formData = new FormData()
      formData.append("file", file)
      const response = await fetch("/api/users/avatar", { method: "POST", body: formData })
      const data = await response.json()
      if (response.ok) {
        setAvatarUrl(data.avatar_url)
        refreshUser()
      }
    } catch (error) {
      console.error("Error uploading avatar:", error)
    } finally {
      setUploadingAvatar(false)
    }
  }

  const handleDeleteAvatar = async () => {
    try {
      const response = await fetch("/api/users/avatar", { method: "DELETE" })
      if (response.ok) {
        setAvatarUrl("")
        refreshUser()
      }
    } catch (error) {
      console.error("Error deleting avatar:", error)
    }
  }

  const handleSaveProfile = async () => {
    setSavingProfile(true)
    setProfileSaved(false)
    try {
      const response = await fetch("/api/users/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: profileName, email: profileEmail }),
      })
      if (response.ok) {
        setProfileSaved(true)
        refreshUser()
        setTimeout(() => setProfileSaved(false), 3000)
      }
    } catch (error) {
      console.error("Error saving profile:", error)
    } finally {
      setSavingProfile(false)
    }
  }

  const handleChangePassword = async () => {
    setPasswordError(null)
    if (!newPassword || newPassword.length < 8) {
      setPasswordError(t("settings.passwordMinError"))
      return
    }
    if (newPassword !== confirmPassword) {
      setPasswordError(t("settings.passwordMismatch"))
      return
    }
    setPasswordLoading(true)
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword })
      if (error) throw error
      setPasswordSuccess(true)
      setTimeout(() => {
        setShowPasswordModal(false)
        setNewPassword("")
        setConfirmPassword("")
        setPasswordSuccess(false)
      }, 1500)
    } catch (error: any) {
      setPasswordError(error?.message || t("settings.passwordUpdateError"))
    } finally {
      setPasswordLoading(false)
    }
  }

  const handleStripePortal = async () => {
    try {
      const response = await fetch("/api/stripe/portal", { method: "POST" })
      const data = await response.json()
      if (response.ok && data.url) window.location.href = data.url
    } catch (error) {
      console.error("Error opening Stripe portal:", error)
    }
  }

  const handleExportData = async () => {
    setExportLoading(true)
    setExportDone(false)
    try {
      await fetch("/api/users/export", { method: "POST" })
      setExportDone(true)
      setTimeout(() => setExportDone(false), 4000)
    } catch {
      // silently handle
    } finally {
      setExportLoading(false)
    }
  }

  const handleDeleteAccount = async () => {
    if (!deletePassword) return
    try {
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
      if (response.ok) {
        await logout()
        router.replace("/login")
      }
    } catch (error) {
      console.error("Error deleting account:", error)
    }
  }

  const profileChanged = profileName !== (user.name || "") || profileEmail !== (user.email || "")

  return (
    <Layout>
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10 sm:py-14">

        {/* ── Header ── */}
        <div className="mb-12">
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-gray-900 dark:text-white">
            {t("settings.title")}
          </h1>
          <p className="mt-2 text-lg text-gray-500 dark:text-gray-400">
            {t("settings.subtitle")}
          </p>
        </div>

        {/* ── Profil ── */}
        <section data-onboarding="profile" className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#111113] p-6 sm:p-8 mb-6">
          <div className="flex items-center gap-3 mb-8">
            <div className="p-2.5 rounded-xl bg-gradient-to-br from-blue-50 to-purple-50 dark:from-blue-950/40 dark:to-purple-950/30">
              <User className="h-5 w-5 text-blue-600 dark:text-blue-400" />
            </div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{t("settings.profile")}</h2>
          </div>

          {/* Avatar */}
          <div className="flex items-center gap-6 mb-8 pb-8 border-b border-gray-100 dark:border-gray-800">
            <div className="relative group">
              <div className="w-24 h-24 rounded-2xl bg-gradient-to-br from-blue-50 to-purple-50 dark:from-blue-950/30 dark:to-purple-950/20 flex items-center justify-center overflow-hidden ring-2 ring-gray-200/60 dark:ring-white/10 shadow-lg shadow-gray-900/5 dark:shadow-black/20">
                {avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={avatarUrl} alt="Avatar" className="w-full h-full object-cover" />
                ) : (
                  <User className="h-10 w-10 text-blue-300 dark:text-blue-800" />
                )}
              </div>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadingAvatar}
                className="absolute inset-0 rounded-2xl bg-black/0 group-hover:bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all cursor-pointer"
              >
                {uploadingAvatar ? (
                  <Loader2 className="h-5 w-5 text-white animate-spin" />
                ) : (
                  <Camera className="h-5 w-5 text-white drop-shadow" />
                )}
              </button>
              <input ref={fileInputRef} type="file" onChange={handleAvatarUpload} accept="image/*" className="hidden" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xl font-semibold text-gray-900 dark:text-white truncate">{user.name}</p>
              <p className="text-sm text-gray-500 dark:text-gray-400 truncate mt-0.5">{user.email}</p>
              <div className="flex items-center gap-3 mt-3">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="text-sm font-medium text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors"
                >
                  {t("settings.changePhoto")}
                </button>
                {avatarUrl && (
                  <>
                    <span className="text-gray-300 dark:text-gray-700">·</span>
                    <button
                      type="button"
                      onClick={handleDeleteAvatar}
                      className="text-sm text-gray-400 hover:text-red-500 dark:hover:text-red-400 transition-colors"
                    >
                      {t("settings.deletePhoto")}
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Fields */}
          <div className="grid sm:grid-cols-2 gap-5 mb-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">{t("name")}</label>
              <input
                type="text"
                value={profileName}
                onChange={(e) => setProfileName(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-white/[0.03] text-gray-900 dark:text-white text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500/50 transition"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">{t("email")}</label>
              <input
                type="email"
                value={profileEmail}
                onChange={(e) => setProfileEmail(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-white/[0.03] text-gray-900 dark:text-white text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500/50 transition"
              />
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-between pt-4 border-t border-gray-100 dark:border-gray-800">
            <button
              type="button"
              onClick={() => {
                setShowPasswordModal(true)
                setPasswordError(null)
                setPasswordSuccess(false)
              }}
              className="inline-flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors"
            >
              <Lock className="h-3.5 w-3.5" />
              {t("settings.changePassword")}
            </button>
            <button
              type="button"
              onClick={handleSaveProfile}
              disabled={savingProfile || !profileChanged}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-semibold shadow-lg shadow-blue-600/25 hover:bg-blue-700 hover:shadow-xl hover:-translate-y-0.5 disabled:opacity-30 disabled:shadow-none disabled:translate-y-0 disabled:cursor-not-allowed transition-all"
            >
              {savingProfile ? <Loader2 className="h-4 w-4 animate-spin" /> : profileSaved ? <Check className="h-4 w-4" /> : null}
              {profileSaved ? t("saved") : t("save")}
            </button>
          </div>
        </section>

        {/* ── Préférences (Langue) ── */}
        <section className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#111113] p-6 sm:p-8 mb-6">
          <div className="flex items-center gap-3 mb-6">
            <div className="p-2.5 rounded-xl bg-gradient-to-br from-indigo-50 to-blue-50 dark:from-indigo-950/40 dark:to-blue-950/30">
              <Globe className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
            </div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{t("settings.preferences")}</h2>
          </div>

          <div className="flex items-center justify-between py-4">
            <div className="flex items-center gap-4">
              <div className="p-2 rounded-lg bg-gray-50 dark:bg-white/[0.04]">
                <Globe className="h-4 w-4 text-gray-500 dark:text-gray-400" />
              </div>
              <div>
                <p className="text-sm font-medium text-gray-900 dark:text-white">{t("settings.language")}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{t("settings.languageDesc")}</p>
              </div>
            </div>
            <div className="inline-flex items-center rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-white/[0.03] p-1 gap-1">
              <button
                type="button"
                onClick={() => setLocale("fr")}
                className={`px-3.5 py-2 rounded-lg text-sm font-semibold transition-all ${
                  locale === "fr"
                    ? "bg-white dark:bg-white/[0.12] text-gray-900 dark:text-white shadow-sm"
                    : "text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300"
                }`}
              >
                {t("settings.french")}
              </button>
              <button
                type="button"
                onClick={() => setLocale("en")}
                className={`px-3.5 py-2 rounded-lg text-sm font-semibold transition-all ${
                  locale === "en"
                    ? "bg-white dark:bg-white/[0.12] text-gray-900 dark:text-white shadow-sm"
                    : "text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300"
                }`}
              >
                {t("settings.english")}
              </button>
            </div>
          </div>
        </section>

        {/* ── Abonnement ── */}
        <section className={`rounded-2xl border p-6 sm:p-8 mb-6 transition-all ${
          isPaid
            ? "border-blue-200 dark:border-blue-900/50 bg-gradient-to-br from-blue-50 to-purple-50 dark:from-blue-950/20 dark:to-purple-950/10"
            : "border-gray-200 dark:border-gray-800 bg-white dark:bg-[#111113]"
        }`}>
          <div className="flex items-center gap-3 mb-6">
            <div className={`p-2.5 rounded-xl ${
              isPaid
                ? "bg-white/80 dark:bg-white/10 shadow-sm"
                : "bg-gradient-to-br from-emerald-50 to-blue-50 dark:from-emerald-950/40 dark:to-blue-950/30"
            }`}>
              {isPaid ? (
                <Sparkles className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              ) : (
                <CreditCard className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
              )}
            </div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{t("settings.subscription")}</h2>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
            <div>
              <div className="flex items-center gap-3">
                <p className="text-2xl font-bold text-gray-900 dark:text-white">
                  {planLabel}
                </p>
                {isPaid && (
                  <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-600 text-white shadow-sm">
                    {t("active")}
                  </span>
                )}
              </div>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                {isPaid ? t("settings.thankYou") : t("settings.upgradePrompt")}
              </p>
            </div>
            <button
              type="button"
              onClick={() => router.push("/dashboard/payments")}
              className={`inline-flex items-center gap-2 px-5 py-3 rounded-xl text-sm font-semibold transition-all hover:-translate-y-0.5 ${
                isPaid
                  ? "bg-white dark:bg-[#111113] text-gray-900 dark:text-white border border-gray-200 dark:border-gray-800 hover:shadow-lg shadow-sm"
                  : "bg-blue-600 text-white shadow-lg shadow-blue-600/25 hover:bg-blue-700 hover:shadow-xl"
              }`}
            >
              {isPaid ? t("settings.changePlan") : t("settings.upgradePro")}
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          <button
            type="button"
            onClick={handleStripePortal}
            className="inline-flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            {t("settings.stripePortal")}
          </button>
        </section>

        {/* ── Sécurité & Données ── */}
        <section className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#111113] p-6 sm:p-8 mb-6">
          <div className="flex items-center gap-3 mb-6">
            <div className="p-2.5 rounded-xl bg-gradient-to-br from-emerald-50 to-teal-50 dark:from-emerald-950/40 dark:to-teal-950/30">
              <Shield className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
            </div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{t("settings.security")}</h2>
          </div>

          <div className="space-y-1">
            {/* Export */}
            <div className="flex items-center justify-between py-4 border-b border-gray-100 dark:border-gray-800">
              <div className="flex items-center gap-4">
                <div className="p-2 rounded-lg bg-gray-50 dark:bg-white/[0.04]">
                  <FileDown className="h-4 w-4 text-gray-500 dark:text-gray-400" />
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-900 dark:text-white">{t("settings.exportData")}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{t("settings.exportDataDesc")}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleExportData}
                disabled={exportLoading}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-gray-200 dark:border-gray-800 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/[0.04] hover:border-gray-300 dark:hover:border-gray-700 transition-all disabled:opacity-50"
              >
                {exportLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : exportDone ? <Check className="h-4 w-4 text-emerald-500" /> : <Download className="h-4 w-4" />}
                {exportDone ? t("exported") : t("export")}
              </button>
            </div>

            {/* Supprimer */}
            <div className="flex items-center justify-between py-4">
              <div className="flex items-center gap-4">
                <div className="p-2 rounded-lg bg-red-50 dark:bg-red-950/20">
                  <Trash2 className="h-4 w-4 text-red-500 dark:text-red-400" />
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-900 dark:text-white">{t("settings.deleteAccount")}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{t("settings.deleteAccountDesc")}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowDeleteModal(true)}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium text-red-600 dark:text-red-400 border border-red-200 dark:border-red-900/40 hover:bg-red-50 dark:hover:bg-red-950/20 transition-all"
              >
                {t("delete")}
              </button>
            </div>
          </div>
        </section>

        {/* ── Footer ── */}
        <div className="flex items-center justify-center gap-4 pt-6 pb-10 text-sm">
          <a href="/privacy" className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors">
            {t("settings.privacy")}
          </a>
          <span className="text-gray-200 dark:text-gray-800">·</span>
          <a href="/rgpd" className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors">
            {t("settings.gdpr")}
          </a>
        </div>

      </div>

      {/* ── Modal : Mot de passe ── */}
      {showPasswordModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center px-4" onClick={(e) => { if (e.target === e.currentTarget) setShowPasswordModal(false) }}>
          <div className="bg-white dark:bg-[#111114] rounded-2xl max-w-md w-full p-6 sm:p-8 shadow-2xl shadow-gray-900/10 dark:shadow-black/40 border border-gray-100 dark:border-gray-800">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-blue-50 dark:bg-blue-950/30">
                  <Lock className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                </div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">{t("settings.changePassword")}</h3>
              </div>
              <button type="button" onClick={() => setShowPasswordModal(false)} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-white/[0.06] transition">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">{t("settings.newPassword")}</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder={t("settings.minChars")}
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-white/[0.03] text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500/50 transition"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">{t("settings.confirmPassword")}</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder={t("settings.repeatPassword")}
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-white/[0.03] text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500/50 transition"
                />
              </div>
              {passwordError && <p className="text-sm text-red-500">{passwordError}</p>}
              {passwordSuccess && <p className="text-sm text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5"><Check className="h-4 w-4" /> {t("settings.passwordUpdated")}</p>}
              <div className="flex gap-3 pt-3">
                <button
                  type="button"
                  onClick={() => { setShowPasswordModal(false); setNewPassword(""); setConfirmPassword(""); setPasswordError(null) }}
                  disabled={passwordLoading}
                  className="flex-1 px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-800 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/[0.04] transition"
                >
                  {t("cancel")}
                </button>
                <button
                  type="button"
                  onClick={handleChangePassword}
                  disabled={passwordLoading || !newPassword}
                  className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-semibold shadow-lg shadow-blue-600/25 hover:bg-blue-700 disabled:opacity-40 disabled:shadow-none transition-all"
                >
                  {passwordLoading && <Loader2 className="h-4 w-4 animate-spin" />}
                  {t("update")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal : Suppression ── */}
      {showDeleteModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center px-4" onClick={(e) => { if (e.target === e.currentTarget) setShowDeleteModal(false) }}>
          <div className="bg-white dark:bg-[#111114] rounded-2xl max-w-md w-full p-6 sm:p-8 shadow-2xl shadow-gray-900/10 dark:shadow-black/40 border border-gray-100 dark:border-gray-800">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-2.5 rounded-xl bg-red-50 dark:bg-red-950/30">
                <AlertTriangle className="h-5 w-5 text-red-500" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">{t("settings.deleteAccountTitle")}</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400">{t("settings.deleteAccountWarning")}</p>
              </div>
            </div>
            <div className="space-y-4">
              <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">
                {t("settings.deleteAccountConfirm")}
              </p>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  value={deletePassword}
                  onChange={(e) => setDeletePassword(e.target.value)}
                  placeholder={t("settings.yourPassword")}
                  className="w-full px-4 py-3 pr-11 rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-white/[0.03] text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500/50 transition"
                />
                <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <div className="flex gap-3 pt-3">
                <button
                  type="button"
                  onClick={() => { setShowDeleteModal(false); setDeletePassword("") }}
                  className="flex-1 px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-800 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/[0.04] transition"
                >
                  {t("cancel")}
                </button>
                <button
                  type="button"
                  onClick={handleDeleteAccount}
                  disabled={!deletePassword}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-red-600 text-white text-sm font-semibold hover:bg-red-700 disabled:opacity-40 transition-all"
                >
                  {t("settings.deletePermanently")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </Layout>
  )
}
