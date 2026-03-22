"use client"

import { useState, useEffect, Suspense } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { useAuth } from "@/contexts/auth-context"
import { useLanguage, LanguageToggle } from "@/contexts/language-context"
import { createClient } from "@/lib/supabase/client"
import { Loader2, Eye, EyeOff, Mail, ArrowRight, BarChart3, Shield, Zap } from "lucide-react"
import Image from "next/image"

function LoginContent() {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [loginSuccess, setLoginSuccess] = useState(false)
  const [infoMessage, setInfoMessage] = useState<string | null>(null)
  const [showResendButton, setShowResendButton] = useState(false)
  const [resendingEmail, setResendingEmail] = useState(false)
  const { login, user, isLoading } = useAuth()
  const { t } = useLanguage()
  const router = useRouter()
  const searchParams = useSearchParams()
  const supabase = createClient()

  useEffect(() => {
    const message = searchParams.get("message")
    if (message === "check_email") setInfoMessage(t("login.checkEmail"))
    else if (message === "check_email_promo") setInfoMessage(t("login.checkEmailPromo"))
    else if (message === "confirm_email_then_pay") setInfoMessage(t("login.confirmEmailPay"))
    else if (message === "confirmed") setInfoMessage(t("login.confirmed"))
    else if (message === "password_reset") setInfoMessage(t("login.passwordReset"))
    else if (message === "auth_error") setError(t("login.authError"))
    else if (message === "missing_code") setError(t("login.missingCode"))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  useEffect(() => { if (loginSuccess) router.push("/dashboard") }, [loginSuccess, router])
  useEffect(() => { if (!isLoading && user) router.replace("/dashboard") }, [user, isLoading, router])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    setLoginSuccess(false)
    setShowResendButton(false)
    try {
      const { error } = await Promise.race([
        login(email, password),
        new Promise<{ error: { message: string; code?: string } }>((_, reject) =>
          setTimeout(() => reject(new Error(t("login.timeout"))), 10000)
        ),
      ])
      if (error) {
        setError(error.message || t("login.genericError"))
        if (error.code === 'EMAIL_NOT_CONFIRMED' || (error.message || '').includes('confirmer votre email')) setShowResendButton(true)
      } else {
        setLoginSuccess(true)
        router.push("/dashboard")
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t("login.unknownError"))
    } finally {
      setLoading(false)
    }
  }

  const handleResendConfirmation = async () => {
    if (!email) { setError(t("login.enterEmail")); return }
    setResendingEmail(true)
    setError(null)
    try {
      const { error } = await supabase.auth.resend({
        type: 'signup', email,
        options: { emailRedirectTo: `${window.location.origin}/auth/callback` }
      })
      if (error) setError(error.message || t("login.resendError"))
      else { setInfoMessage(t("login.resendSuccess")); setShowResendButton(false) }
    } catch { setError(t("login.resendUnknown")) }
    finally { setResendingEmail(false) }
  }

  const inputClass = "w-full h-10 px-3 text-[14px] border border-gray-200 dark:border-white/[0.08] rounded-[8px] bg-white dark:bg-white/[0.03] text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition-all"

  return (
    <div className="min-h-screen flex bg-[#fafbfc] dark:bg-[#09090b]">
      {/* Left — branding */}
      <div className="hidden lg:flex lg:w-[44%] relative overflow-hidden bg-gradient-to-br from-gray-900 via-gray-900 to-blue-950 dark:from-[#08080a] dark:via-[#0a0a0e] dark:to-[#0c0c14]">
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:48px_48px]" />
        <div className="absolute top-16 left-[10%] w-14 h-14 border border-white/[0.06] rounded-[8px] animate-float-slow" />
        <div className="absolute top-[35%] right-[12%] w-20 h-20 border border-blue-400/[0.08] rounded-[10px] animate-float-medium" />
        <div className="absolute bottom-[25%] left-[8%] w-10 h-10 bg-blue-500/[0.06] rounded-[6px] animate-float-fast" />

        <div className="relative z-10 flex flex-col justify-between w-full p-10 xl:p-14">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="relative h-9 w-9 flex-shrink-0 rounded-[8px] bg-white/10 backdrop-blur-sm overflow-hidden">
              <Image src="/Go-Data.svg" alt="GO-DATA" fill sizes="36px" className="object-contain" />
            </div>
            <span className="text-[15px] font-semibold text-white tracking-tight">GO-DATA</span>
          </Link>

          <div className="space-y-8">
            <div>
              <h1 className="text-[28px] xl:text-[32px] font-bold text-white tracking-tight leading-[1.2]">
                {t("login.heroTitle1")}
                <br />
                <span className="bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
                  {t("login.heroTitle2")}
                </span>
              </h1>
              <p className="mt-4 text-[14px] text-gray-400 leading-relaxed max-w-sm">
                {t("login.heroSubtitle")}
              </p>
            </div>
            <div className="space-y-3.5">
              {[
                { icon: BarChart3, textKey: "login.feature1" as const },
                { icon: Zap, textKey: "login.feature2" as const },
                { icon: Shield, textKey: "login.feature3" as const },
              ].map((item) => (
                <div key={item.textKey} className="flex items-center gap-3">
                  <div className="flex items-center justify-center w-8 h-8 rounded-[8px] bg-white/[0.06]">
                    <item.icon className="h-4 w-4 text-blue-400" />
                  </div>
                  <span className="text-[13px] text-gray-300">{t(item.textKey)}</span>
                </div>
              ))}
            </div>
          </div>

          <p className="text-[11px] text-gray-600">&copy; {new Date().getFullYear()} Go-Data</p>
        </div>
      </div>

      {/* Right — form */}
      <div className="flex-1 flex flex-col">
        {/* Language toggle top-right */}
        <div className="flex justify-end px-6 pt-4">
          <LanguageToggle />
        </div>

        <div className="flex-1 flex items-center justify-center px-6 py-12 lg:px-16">
          <div className="w-full max-w-[380px]">
            <div className="flex items-center gap-2.5 mb-10 lg:hidden">
              <Link href="/" className="flex items-center gap-2.5">
                <div className="relative h-8 w-8 rounded-[8px] bg-white dark:bg-[#141419] shadow-sm border border-gray-100 dark:border-white/[0.06] overflow-hidden">
                  <Image src="/Go-Data.svg" alt="GO-DATA" fill sizes="32px" className="object-contain" />
                </div>
                <span className="text-[15px] font-semibold text-gray-900 dark:text-white tracking-tight">GO-DATA</span>
              </Link>
            </div>

            <div className="mb-8">
              <h2 className="text-[22px] font-bold text-gray-900 dark:text-white tracking-tight">{t("login.title")}</h2>
              <p className="mt-1 text-[13px] text-gray-500 dark:text-gray-400">{t("login.subtitle")}</p>
            </div>

            <form className="space-y-5" onSubmit={handleSubmit}>
              {infoMessage && (
                <div className="flex gap-2.5 rounded-[8px] bg-blue-50 dark:bg-blue-950/20 border border-blue-100 dark:border-blue-900/40 p-3">
                  <Mail className="h-4 w-4 text-blue-500 mt-0.5 flex-shrink-0" />
                  <p className="text-[13px] text-blue-700 dark:text-blue-300 leading-relaxed">{infoMessage}</p>
                </div>
              )}
              {error && (
                <div className="rounded-[8px] bg-red-50 dark:bg-red-950/20 border border-red-100 dark:border-red-900/40 p-3">
                  <p className="text-[13px] text-red-700 dark:text-red-300">{error}</p>
                  {showResendButton && (
                    <button type="button" onClick={handleResendConfirmation} disabled={resendingEmail}
                      className="mt-2 flex items-center gap-1.5 text-[13px] font-medium text-blue-600 dark:text-blue-400 hover:text-blue-700 disabled:opacity-50 transition-colors">
                      {resendingEmail ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> {t("login.resending")}</> : <><Mail className="h-3.5 w-3.5" /> {t("login.resend")}</>}
                    </button>
                  )}
                </div>
              )}

              <div className="space-y-4">
                <div>
                  <label htmlFor="email" className="block text-[13px] font-medium text-gray-700 dark:text-gray-300 mb-1.5">{t("email")}</label>
                  <input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} placeholder="votre@email.com" />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label htmlFor="password" className="text-[13px] font-medium text-gray-700 dark:text-gray-300">{t("password")}</label>
                    <Link href="/forgot-password" className="text-[12px] text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors">{t("login.forgot")}</Link>
                  </div>
                  <div className="relative">
                    <input id="password" type={showPassword ? "text" : "password"} required value={password} onChange={(e) => setPassword(e.target.value)} className={`${inputClass} pr-10`} placeholder="••••••••" />
                    <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors">
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
              </div>

              <button type="submit" disabled={loading}
                className="w-full h-10 flex items-center justify-center gap-2 rounded-[8px] text-[14px] font-semibold text-white bg-gray-900 dark:bg-white dark:text-gray-900 hover:bg-gray-800 dark:hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm active:scale-[0.98]">
                {loading || loginSuccess
                  ? <><Loader2 className="h-4 w-4 animate-spin" /> {loginSuccess ? t("login.redirecting") : t("login.signingIn")}</>
                  : <>{t("login.submit")} <ArrowRight className="h-4 w-4" /></>}
              </button>

              <div className="relative py-1">
                <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-gray-100 dark:border-white/[0.06]" /></div>
                <div className="relative flex justify-center"><span className="bg-[#fafbfc] dark:bg-[#09090b] px-3 text-[11px] text-gray-400">{t("or")}</span></div>
              </div>

              <Link href="/create-account" className="w-full h-10 flex items-center justify-center rounded-[8px] text-[13px] font-medium text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-white/[0.08] hover:bg-gray-50 dark:hover:bg-white/[0.04] transition-all">
                {t("login.createAccount")}
              </Link>
            </form>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-[#fafbfc] dark:bg-[#09090b]">
        <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
      </div>
    }>
      <LoginContent />
    </Suspense>
  )
}
