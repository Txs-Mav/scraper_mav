"use client"

import { useState, useEffect, Suspense, useMemo } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { useAuth } from "@/contexts/auth-context"
import { useLanguage, LanguageToggle } from "@/contexts/language-context"
import {
  Loader2, Eye, EyeOff, ArrowRight, Check, Sparkles, Zap, Crown,
  Tag, Shield, Mail, Lock, Store, Car, Anchor, Bike, Shirt, Cpu, MoreHorizontal,
} from "lucide-react"
import Image from "next/image"
import type { TranslationKey } from "@/lib/translations"

function getPasswordStrength(pw: string, t: (key: TranslationKey) => string) {
  if (!pw) return { score: 0, label: "", color: "" }
  let s = 0
  if (pw.length >= 6) s++
  if (pw.length >= 10) s++
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) s++
  if (/\d/.test(pw)) s++
  if (/[^A-Za-z0-9]/.test(pw)) s++
  if (s <= 1) return { score: 1, label: t("pw.weak"), color: "bg-red-500" }
  if (s <= 2) return { score: 2, label: t("pw.medium"), color: "bg-orange-500" }
  if (s <= 3) return { score: 3, label: t("pw.good"), color: "bg-yellow-500" }
  if (s <= 4) return { score: 4, label: t("pw.strong"), color: "bg-emerald-500" }
  return { score: 5, label: t("pw.excellent"), color: "bg-emerald-600" }
}

function CreateAccountContent() {
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [selectedPlan, setSelectedPlan] = useState("standard")
  const [businessType, setBusinessType] = useState<string>("recreational_vehicles")
  const [businessTypeOpen, setBusinessTypeOpen] = useState(false)
  const [promoCode, setPromoCode] = useState("")
  const [promoCodeValid, setPromoCodeValid] = useState<boolean | null>(null)
  const [validatingPromo, setValidatingPromo] = useState(false)
  const [acceptTerms, setAcceptTerms] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [accountExists, setAccountExists] = useState(false)
  const [registrationSuccess, setRegistrationSuccess] = useState(false)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const { register } = useAuth()
  const { t } = useLanguage()
  const router = useRouter()
  const searchParams = useSearchParams()

  const pwStrength = useMemo(() => getPasswordStrength(password, t), [password, t])
  const passwordsMatch = confirmPassword.length > 0 && password === confirmPassword

  const BUSINESS_TYPES = useMemo(() => [
    { id: "recreational_vehicles", labelKey: "register.bt.recreationalVehicles" as const, icon: Bike, locked: false },
    { id: "automotive", labelKey: "register.bt.automotive" as const, icon: Car, locked: true },
    { id: "marine", labelKey: "register.bt.marine" as const, icon: Anchor, locked: true },
    { id: "sports_outdoor", labelKey: "register.bt.sportsOutdoor" as const, icon: Store, locked: true },
    { id: "fashion", labelKey: "register.bt.fashion" as const, icon: Shirt, locked: true },
    { id: "electronics", labelKey: "register.bt.electronics" as const, icon: Cpu, locked: true },
    { id: "other", labelKey: "register.bt.other" as const, icon: MoreHorizontal, locked: true },
  ], [])

  const selectedBusiness = BUSINESS_TYPES.find((b) => b.id === businessType) ?? BUSINESS_TYPES[0]
  const SelectedBusinessIcon = selectedBusiness.icon

  const PLANS = useMemo(() => [
    {
      id: "standard",
      name: t("plan.free"),
      price: "0",
      period: t("plan.perMonth"),
      icon: Sparkles,
      description: t("plan.freeDesc"),
      features: [t("plan.freeF1"), t("plan.freeF2"), t("plan.freeF3"), t("plan.freeF4")],
      cta: t("plan.freeCta"),
    },
    {
      id: "pro",
      name: t("plan.pro"),
      price: "199,99",
      period: t("plan.perMonth"),
      icon: Zap,
      highlighted: true,
      description: t("plan.proDesc"),
      features: [t("plan.proF1"), t("plan.proF2"), t("plan.proF3"), t("plan.proF4"), t("plan.proF5")],
      cta: t("plan.proCta"),
    },
    {
      id: "ultime",
      name: t("plan.ultimate"),
      price: "274,99",
      period: t("plan.perMonth"),
      icon: Crown,
      description: t("plan.ultimateDesc"),
      features: [t("plan.ultimateF1"), t("plan.ultimateF2"), t("plan.ultimateF3"), t("plan.ultimateF4"), t("plan.ultimateF5"), t("plan.ultimateF6")],
      cta: t("plan.ultimateCta"),
    },
  ], [t])

  useEffect(() => {
    const plan = searchParams.get("plan")
    if (plan && ["standard", "pro", "ultime"].includes(plan)) setSelectedPlan(plan)
  }, [searchParams])

  useEffect(() => { if (promoCodeValid === true) setSelectedPlan("ultime") }, [promoCodeValid])

  useEffect(() => {
    if (registrationSuccess) {
      if (promoCodeValid) router.push("/login?message=check_email_promo")
      else if (selectedPlan !== "standard") router.push("/login?message=confirm_email_then_pay")
      else router.push("/login?message=check_email")
    }
  }, [registrationSuccess, router, selectedPlan, promoCodeValid])

  useEffect(() => {
    if (accountExists) { const tm = setTimeout(() => router.push("/login"), 3000); return () => clearTimeout(tm) }
  }, [accountExists, router])

  const validatePromoCode = async () => {
    if (!promoCode.trim()) return
    setValidatingPromo(true)
    try {
      const res = await fetch("/api/promo-codes/validate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: promoCode.trim() }) })
      const data = await res.json()
      setPromoCodeValid(data.valid)
      if (!data.valid) setError(data.error || t("register.promoInvalid")); else setError(null)
    } catch { setPromoCodeValid(false); setError(t("register.promoError")) }
    finally { setValidatingPromo(false) }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setError(null); setAccountExists(false)
    if (!acceptTerms) { setError(t("register.termsError")); return }
    if (password !== confirmPassword) { setError(t("register.passwordMismatch")); return }
    if (password.length < 6) { setError(t("register.passwordShort")); return }

    setLoading(true); setSuccessMessage(null)
    const hasValidPromo = !!(promoCode.trim() && promoCodeValid)
    if (hasValidPromo) { sessionStorage.setItem("pending_promo_code", promoCode.trim()); sessionStorage.setItem("pending_promo_plan", selectedPlan) }

    try {
      const planForRegister = hasValidPromo ? "ultime" : selectedPlan
      const { error } = await register({ name, email, password, plan: planForRegister, promoCode: hasValidPromo ? promoCode.trim() : undefined, businessType })

      if (error) {
        let msg = t("register.genericError")
        if (typeof error === "string") msg = error
        else if (error?.message) msg = error.message
        else if (error?.error?.message) msg = error.error.message
        if (error?.code === "ACCOUNT_EXISTS" || msg.includes("existe déjà") || msg.includes("already exists")) { setAccountExists(true); msg = t("register.accountExists") }
        if (error?.code === "EMAIL_CONFIRMATION_REQUIRED") { setRegistrationSuccess(true); setLoading(false); return }
        if (error?.code === "EMAIL_CONFIRMATION_RESENT") { setSuccessMessage(t("register.resent")); setRegistrationSuccess(true); setLoading(false); return }
        setError(msg); setLoading(false); return
      }

      if (hasValidPromo) setSuccessMessage(t("register.successPromo"))
      else if (selectedPlan !== "standard") setSuccessMessage(t("register.successPaid"))
      else setSuccessMessage(t("register.successFree"))
      setRegistrationSuccess(true); setLoading(false)
    } catch (err: any) { setError(err.message || t("register.unknownError")); setLoading(false) }
  }

  const inputClass = "w-full h-10 px-3 text-[14px] border border-gray-200 dark:border-white/[0.08] rounded-[8px] bg-white dark:bg-white/[0.03] text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 transition-all"

  return (
    <div className="min-h-screen bg-[#fafbfc] dark:bg-[#111314]">
      {/* ── Header ── */}
      <header className="px-6 py-4 border-b border-gray-100 dark:border-[#2a2c2e] bg-white/80 dark:bg-[#111314]/80 backdrop-blur-sm sticky top-0 z-20">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5 group">
            <div className="relative h-8 w-8 flex-shrink-0 rounded-[8px] bg-white dark:bg-[#1c1e20] shadow-sm border border-gray-100 dark:border-[#2a2c2e] overflow-hidden">
              <Image src="/Go-Data.svg" alt="GO-DATA" fill sizes="32px" className="object-contain" />
            </div>
            <span className="text-[15px] font-semibold text-gray-900 dark:text-white tracking-tight">GO-DATA</span>
          </Link>
          <div className="flex items-center gap-4">
            <LanguageToggle />
            <span className="text-[13px] text-gray-400 hidden sm:block">{t("register.alreadyAccount")}</span>
            <Link href="/login"
              className="h-8 px-3.5 flex items-center text-[13px] font-medium text-gray-700 dark:text-gray-300 rounded-[8px] border border-gray-200 dark:border-white/[0.08] hover:bg-gray-50 dark:hover:bg-white/[0.04] transition-all">
              {t("register.signIn")}
            </Link>
          </div>
        </div>
      </header>

      <main className="px-6 py-12 md:py-16">
        {/* ── Hero ── */}
        <div className="text-center max-w-2xl mx-auto mb-12">
          <h1 className="text-[28px] md:text-[36px] font-bold text-gray-900 dark:text-white tracking-tight leading-[1.15]">
            {t("register.title")}
          </h1>
          <p className="mt-3 text-[15px] text-gray-500 dark:text-gray-400">
            {t("register.subtitle")}
          </p>
        </div>

        {/* ── Plan cards ── */}
        <div className="max-w-4xl mx-auto grid md:grid-cols-3 gap-4 mb-16">
          {PLANS.map((plan) => {
            const Icon = plan.icon
            const isSelected = selectedPlan === plan.id
            const isPro = plan.highlighted

            return (
              <div key={plan.id} className="relative flex flex-col">
                {isPro && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 z-10 px-3 py-1 text-[11px] font-semibold tracking-wide uppercase rounded-full bg-emerald-600 text-white whitespace-nowrap">
                    {t("register.mostPopular")}
                  </span>
                )}

                <button
                  type="button"
                  onClick={() => setSelectedPlan(plan.id)}
                  className={`flex-1 text-left p-6 rounded-[12px] border transition-all duration-200 group ${
                    isSelected
                      ? "border-emerald-500 bg-white dark:bg-[#1c1e20] shadow-lg shadow-emerald-500/[0.08] ring-1 ring-emerald-500/20"
                      : isPro
                        ? "border-emerald-200 dark:border-emerald-500/20 bg-white dark:bg-[#1c1e20] shadow-md hover:shadow-lg hover:border-emerald-300 dark:hover:border-emerald-500/30"
                        : "border-gray-200 dark:border-[#2a2c2e] bg-white dark:bg-[#1c1e20] shadow-sm hover:shadow-md hover:border-gray-300 dark:hover:border-white/[0.1]"
                  }`}
                >
                  <div className="flex items-center gap-3 mb-4">
                    <div className={`flex items-center justify-center w-10 h-10 rounded-[10px] ${
                      isSelected || isPro ? "bg-emerald-50 dark:bg-emerald-900/20" : "bg-gray-50 dark:bg-[#1c1e20]"
                    }`}>
                      <Icon className={`h-5 w-5 ${
                        isSelected || isPro ? "text-emerald-600 dark:text-emerald-400" : "text-gray-400 dark:text-gray-500"
                      }`} />
                    </div>
                    <div>
                      <h3 className="font-semibold text-[15px] text-gray-900 dark:text-white">{plan.name}</h3>
                      <p className="text-[12px] text-gray-400 dark:text-gray-500">{plan.description}</p>
                    </div>
                  </div>

                  <div className="flex items-baseline gap-1 mb-6">
                    <span className="text-[32px] leading-none font-bold tabular-nums text-gray-900 dark:text-white">
                      {plan.price}$
                    </span>
                    <span className="text-[13px] text-gray-400 dark:text-gray-500">{plan.period}</span>
                  </div>

                  <ul className="space-y-2.5 mb-6">
                    {plan.features.map((f) => (
                      <li key={f} className="flex items-start gap-2.5">
                        <Check className={`h-4 w-4 mt-0.5 flex-shrink-0 ${
                          isSelected || isPro ? "text-emerald-500 dark:text-emerald-400" : "text-gray-300 dark:text-gray-600"
                        }`} />
                        <span className="text-[13px] text-gray-600 dark:text-gray-400 leading-snug">{f}</span>
                      </li>
                    ))}
                  </ul>

                  <div className={`w-full h-10 flex items-center justify-center rounded-[8px] text-[13px] font-semibold transition-all ${
                    isSelected
                      ? "bg-emerald-600 text-white shadow-sm shadow-emerald-600/20"
                      : isPro
                        ? "bg-gray-900 dark:bg-white text-white dark:text-gray-900 group-hover:bg-gray-800 dark:group-hover:bg-gray-100"
                        : "bg-gray-100 dark:bg-white/[0.06] text-gray-700 dark:text-gray-300 group-hover:bg-gray-200 dark:group-hover:bg-white/[0.08]"
                  }`}>
                    {isSelected
                      ? <span className="flex items-center gap-1.5"><Check className="h-4 w-4" /> {t("register.selected")}</span>
                      : plan.cta}
                  </div>
                </button>
              </div>
            )
          })}
        </div>

        {/* ── Form ── */}
        <div className="max-w-md mx-auto">
          <div className="text-center mb-8">
            <h2 className="text-[20px] font-semibold text-gray-900 dark:text-white">{t("register.yourInfo")}</h2>
            <p className="mt-1 text-[13px] text-gray-400 dark:text-gray-500">
              {t("register.startWith")}{" "}
              <span className="font-medium text-gray-600 dark:text-gray-300">{PLANS.find((p) => p.id === selectedPlan)?.name}</span>
            </p>
          </div>

          <div className="rounded-[12px] border border-gray-200 dark:border-[#2a2c2e] bg-white dark:bg-[#1c1e20] shadow-sm p-6 sm:p-8">
            <form className="space-y-4" onSubmit={handleSubmit}>
              {successMessage && (
                <div className="rounded-[8px] p-3 bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900/40">
                  <p className="text-[13px] font-medium text-emerald-700 dark:text-emerald-300">{successMessage}</p>
                  <p className="text-[12px] mt-1 text-emerald-600/70">{t("register.openEmail")}</p>
                </div>
              )}
              {error && (
                <div className={`rounded-[8px] p-3 ${
                  accountExists
                    ? "bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900/40"
                    : "bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/40"
                }`}>
                  <p className={`text-[13px] ${accountExists ? "text-emerald-700 dark:text-emerald-300" : "text-red-700 dark:text-red-300"}`}>{error}</p>
                </div>
              )}

              <div>
                <label className="block text-[13px] font-medium text-gray-700 dark:text-gray-300 mb-1.5">{t("register.businessType")}</label>
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setBusinessTypeOpen((v) => !v)}
                    aria-haspopup="listbox"
                    aria-expanded={businessTypeOpen}
                    className={`${inputClass} flex items-center justify-between text-left`}
                  >
                    <span className="flex items-center gap-2">
                      <SelectedBusinessIcon className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                      <span className="text-[14px] text-gray-900 dark:text-white truncate">
                        {t(selectedBusiness.labelKey)}
                      </span>
                    </span>
                    <ArrowRight className={`h-3.5 w-3.5 text-gray-400 transition-transform ${businessTypeOpen ? "rotate-90" : ""}`} />
                  </button>
                  {businessTypeOpen && (
                    <div
                      role="listbox"
                      className="absolute z-30 mt-1 w-full rounded-[8px] border border-gray-200 dark:border-white/[0.08] bg-white dark:bg-[#1c1e20] shadow-lg overflow-hidden"
                    >
                      {BUSINESS_TYPES.map((bt) => {
                        const Icon = bt.icon
                        const isSelected = bt.id === businessType
                        return (
                          <button
                            key={bt.id}
                            type="button"
                            role="option"
                            aria-selected={isSelected}
                            disabled={bt.locked}
                            onClick={() => {
                              if (bt.locked) return
                              setBusinessType(bt.id)
                              setBusinessTypeOpen(false)
                            }}
                            className={`w-full flex items-center justify-between gap-2 px-3 py-2.5 text-left text-[13px] transition-colors ${
                              bt.locked
                                ? "opacity-60 cursor-not-allowed bg-gray-50/60 dark:bg-white/[0.02]"
                                : isSelected
                                  ? "bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300"
                                  : "hover:bg-gray-50 dark:hover:bg-white/[0.04] text-gray-700 dark:text-gray-200"
                            }`}
                          >
                            <span className="flex items-center gap-2 min-w-0">
                              <Icon className={`h-4 w-4 flex-shrink-0 ${bt.locked ? "text-gray-400 dark:text-gray-500" : "text-emerald-600 dark:text-emerald-400"}`} />
                              <span className="truncate">{t(bt.labelKey)}</span>
                            </span>
                            {bt.locked ? (
                              <span className="flex items-center gap-1 flex-shrink-0 text-[11px] font-medium text-amber-600 dark:text-amber-400">
                                <Lock className="h-3 w-3" />
                                {t("register.businessTypeComingSoon")}
                              </span>
                            ) : isSelected ? (
                              <Check className="h-4 w-4 flex-shrink-0 text-emerald-500" />
                            ) : null}
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
                <p className="mt-1.5 text-[11px] text-gray-400 dark:text-gray-500 flex items-center gap-1">
                  <Lock className="h-3 w-3" />
                  {t("register.businessTypeHint")}
                </p>
              </div>

              <div>
                <label htmlFor="name" className="block text-[13px] font-medium text-gray-700 dark:text-gray-300 mb-1.5">{t("register.fullName")}</label>
                <input id="name" type="text" required value={name} onChange={(e) => setName(e.target.value)} className={inputClass} placeholder="Jean Dupont" />
              </div>

              <div>
                <label htmlFor="email" className="block text-[13px] font-medium text-gray-700 dark:text-gray-300 mb-1.5">{t("email")}</label>
                <input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} placeholder="vous@entreprise.com" />
              </div>

              <div>
                <label htmlFor="password" className="block text-[13px] font-medium text-gray-700 dark:text-gray-300 mb-1.5">{t("password")}</label>
                <div className="relative">
                  <input id="password" type={showPassword ? "text" : "password"} required value={password} onChange={(e) => setPassword(e.target.value)} className={`${inputClass} pr-10`} placeholder={t("register.minChars")} />
                  <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors">
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                {password.length > 0 && (
                  <div className="mt-2 space-y-1">
                    <div className="flex gap-1">
                      {[1, 2, 3, 4, 5].map((i) => (
                        <div key={i} className={`h-1 flex-1 rounded-full transition-all duration-300 ${i <= pwStrength.score ? pwStrength.color : "bg-gray-100 dark:bg-white/[0.06]"}`} />
                      ))}
                    </div>
                    <p className={`text-[11px] font-medium ${
                      pwStrength.score <= 1 ? "text-red-500" : pwStrength.score <= 2 ? "text-orange-500" : pwStrength.score <= 3 ? "text-yellow-600 dark:text-yellow-500" : "text-emerald-600 dark:text-emerald-400"
                    }`}>{pwStrength.label}</p>
                  </div>
                )}
              </div>

              <div>
                <label htmlFor="confirmPassword" className="block text-[13px] font-medium text-gray-700 dark:text-gray-300 mb-1.5">{t("register.confirmPassword")}</label>
                <div className="relative">
                  <input id="confirmPassword" type={showConfirmPassword ? "text" : "password"} required value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)}
                    className={`${inputClass} pr-10 ${
                      confirmPassword && !passwordsMatch ? "!border-red-300 dark:!border-red-500/30" : passwordsMatch ? "!border-emerald-300 dark:!border-emerald-500/30" : ""
                    }`}
                    placeholder="••••••••" />
                  <button type="button" onClick={() => setShowConfirmPassword(!showConfirmPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors">
                    {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                {confirmPassword && !passwordsMatch && <p className="mt-1 text-[12px] text-red-500">{t("register.passwordMismatch")}</p>}
              </div>

              <div>
                <div className="flex items-center gap-2">
                  <Tag className="h-3.5 w-3.5 text-gray-300 dark:text-gray-600" />
                  <input type="text" value={promoCode}
                    onChange={(e) => { setPromoCode(e.target.value.toUpperCase()); setPromoCodeValid(null) }}
                    onBlur={validatePromoCode}
                    className="flex-1 h-8 px-2.5 text-[13px] border border-gray-200 dark:border-white/[0.08] rounded-[6px] bg-gray-50/50 dark:bg-white/[0.02] text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 focus:bg-white dark:focus:bg-white/[0.04] transition-all"
                    placeholder={t("register.promoPlaceholder")} />
                  {validatingPromo && <Loader2 className="h-3.5 w-3.5 animate-spin text-gray-400" />}
                  {promoCodeValid === true && <Check className="h-4 w-4 text-emerald-500" />}
                </div>
                {promoCodeValid === true && <p className="mt-1.5 ml-6 text-[12px] font-medium text-emerald-600 dark:text-emerald-400">{t("register.promoActivated")}</p>}
              </div>

              <label className="flex items-start gap-2.5 cursor-pointer">
                <div className="relative mt-0.5">
                  <input type="checkbox" checked={acceptTerms} onChange={(e) => setAcceptTerms(e.target.checked)} className="sr-only peer" />
                  <div className="w-4 h-4 rounded-[4px] border border-gray-300 dark:border-gray-600 bg-white dark:bg-[#1c1e20] peer-checked:bg-emerald-600 peer-checked:border-emerald-600 transition-all flex items-center justify-center">
                    {acceptTerms && <Check className="h-3 w-3 text-white" strokeWidth={3} />}
                  </div>
                </div>
                <span className="text-[12px] text-gray-500 dark:text-gray-400 leading-relaxed">
                  {t("register.acceptTerms")} <Link href="#" className="text-emerald-600 dark:text-emerald-400 hover:underline">{t("register.terms")}</Link> {t("register.and")} <Link href="#" className="text-emerald-600 dark:text-emerald-400 hover:underline">{t("register.privacyPolicy")}</Link>.
                </span>
              </label>

              <button type="submit" disabled={loading || !acceptTerms}
                className="w-full h-11 flex items-center justify-center gap-2 rounded-[8px] text-[14px] font-semibold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-sm shadow-emerald-600/20 hover:shadow-md active:scale-[0.98]">
                {loading
                  ? <><Loader2 className="h-4 w-4 animate-spin" /> {t("register.creating")}</>
                  : <>{t("register.submit")} <ArrowRight className="h-4 w-4" /></>}
              </button>
            </form>
          </div>

          <div className="flex items-center justify-center gap-6 mt-8">
            {[
              { icon: Shield, textKey: "register.sslEncryption" as const },
              { icon: Mail, textKey: "register.responsiveSupport" as const },
            ].map((item) => (
              <span key={item.textKey} className="flex items-center gap-1.5 text-[11px] text-gray-400 dark:text-gray-500">
                <item.icon className="h-3 w-3" />
                {t(item.textKey)}
              </span>
            ))}
          </div>
        </div>
      </main>
    </div>
  )
}

export default function CreateAccountPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-[#fafbfc] dark:bg-[#111314]">
        <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
      </div>
    }>
      <CreateAccountContent />
    </Suspense>
  )
}
