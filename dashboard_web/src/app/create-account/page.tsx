"use client"

import { useState, useEffect, Suspense, useMemo } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Bricolage_Grotesque } from "next/font/google"
import { useAuth } from "@/contexts/auth-context"
import { useLanguage, LanguageToggle } from "@/contexts/language-context"
import {
  Loader2, Eye, EyeOff, ArrowRight, Check, ChevronDown, Sparkles, Zap, Crown,
  Shield, Mail, Lock, Store, Car, Anchor, Bike, Shirt, Cpu, MoreHorizontal,
} from "lucide-react"
import Image from "next/image"
import type { TranslationKey } from "@/lib/translations"

const display = Bricolage_Grotesque({ subsets: ["latin"], weight: ["600", "700"] })

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
  const [businessType, setBusinessType] = useState<string>("recreational_vehicles")
  const [businessTypeOpen, setBusinessTypeOpen] = useState(false)
  const [plansOpen, setPlansOpen] = useState(false)
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

  // Seul le plan gratuit peut être créé en ligne. Un code magique valide
  // active le plan Ultime; les autres plans passent par un contact humain.
  const effectivePlan = promoCodeValid === true ? "ultime" : "standard"

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
      contactOnly: false,
      highlighted: false,
    },
    {
      id: "pro",
      name: t("plan.pro"),
      price: "200",
      period: t("plan.perMonth"),
      icon: Zap,
      highlighted: true,
      contactOnly: true,
      description: t("plan.proDesc"),
      features: [t("plan.proF1"), t("plan.proF2"), t("plan.proF3"), t("plan.proF4"), t("plan.proF5")],
      cta: t("plan.proCta"),
    },
    {
      id: "ultime",
      name: t("plan.ultimate"),
      price: "275",
      period: t("plan.perMonth"),
      icon: Crown,
      contactOnly: true,
      highlighted: false,
      description: t("plan.ultimateDesc"),
      features: [t("plan.ultimateF1"), t("plan.ultimateF2"), t("plan.ultimateF3"), t("plan.ultimateF4"), t("plan.ultimateF5"), t("plan.ultimateF6")],
      cta: t("plan.ultimateCta"),
    },
  ], [t])

  useEffect(() => {
    if (registrationSuccess) {
      if (promoCodeValid) router.push("/login?message=check_email_promo")
      else router.push("/login?message=check_email")
    }
  }, [registrationSuccess, router, promoCodeValid])

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
    if (hasValidPromo) { sessionStorage.setItem("pending_promo_code", promoCode.trim()); sessionStorage.setItem("pending_promo_plan", "ultime") }

    try {
      const planForRegister = hasValidPromo ? "ultime" : "standard"
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
      else setSuccessMessage(t("register.successFree"))
      setRegistrationSuccess(true); setLoading(false)
    } catch (err: any) { setError(err.message || t("register.unknownError")); setLoading(false) }
  }

  const inputClass = "w-full h-10 px-3 text-[14px] border border-gray-200 dark:border-white/[0.08] rounded-lg bg-white dark:bg-white/[0.03] text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-orange-500/30 focus:border-orange-500 transition-all"
  const labelClass = "block text-[13px] font-medium text-gray-700 dark:text-gray-300 mb-1.5"

  const activePlan = PLANS.find((p) => p.id === effectivePlan) ?? PLANS[0]
  const ActivePlanIcon = activePlan.icon

  return (
    <div className="min-h-screen bg-[#fafafa] dark:bg-[#0b0c0d]">
      {/* ── Header ── */}
      <header className="sticky top-0 z-20 border-b border-gray-200 bg-white/80 backdrop-blur-md dark:border-white/10 dark:bg-[#0b0c0d]/80">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-6">
          <Link href="/" className="flex items-center gap-2.5">
            <span className="relative h-7 w-7 overflow-hidden rounded-md ring-1 ring-gray-200 dark:ring-white/10">
              <Image src="/Go-Data.svg" alt="Go-Data" fill sizes="28px" className="object-contain" />
            </span>
            <span className="text-[15px] font-semibold tracking-tight text-gray-900 dark:text-white">Go-Data</span>
          </Link>
          <div className="flex items-center gap-4">
            <LanguageToggle />
            <span className="hidden text-[13px] text-gray-400 sm:block">{t("register.alreadyAccount")}</span>
            <Link
              href="/login"
              className="flex h-9 items-center rounded-lg border border-gray-200 px-3.5 text-[13px] font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-white/10 dark:text-gray-300 dark:hover:bg-white/[0.04]"
            >
              {t("register.signIn")}
            </Link>
          </div>
        </div>
      </header>

      <main className="px-6 py-10 md:py-14">
        <div className="mx-auto max-w-lg">
          {/* ── Titre ── */}
          <div className="text-center">
            <h1 className={`${display.className} text-3xl font-bold tracking-tight text-gray-900 md:text-4xl dark:text-white`}>
              {t("register.title")}
            </h1>
            <p className="mt-2.5 text-[15px] text-gray-500 dark:text-gray-400">
              {t("register.subtitle")}
            </p>
          </div>

          {/* ── Carte plan (accordéon) ── */}
          <section className="mt-8 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-white/10 dark:bg-[#131517]">
            <button
              type="button"
              onClick={() => setPlansOpen((v) => !v)}
              aria-expanded={plansOpen}
              className="flex w-full items-center gap-4 p-5 text-left transition-colors hover:bg-gray-50/60 dark:hover:bg-white/[0.02]"
            >
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-orange-600 text-white dark:bg-orange-500 dark:text-black">
                <ActivePlanIcon className="h-5 w-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[11px] font-medium uppercase tracking-[0.12em] text-gray-400 dark:text-gray-500">
                  {t("register.yourPlan")}
                </span>
                <span className={`${display.className} block text-lg font-bold text-gray-900 dark:text-white`}>
                  {activePlan.name}
                </span>
                <span className="block truncate text-xs text-gray-500 dark:text-gray-400">
                  {effectivePlan === "ultime" ? t("register.activatedByCode") : t("register.freeSummary")}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-1.5 text-[13px] font-semibold text-orange-600 dark:text-orange-400">
                <span className="hidden sm:inline">{t("register.comparePlans")}</span>
                <ChevronDown className={`h-4 w-4 transition-transform duration-300 ${plansOpen ? "rotate-180" : ""}`} />
              </span>
            </button>

            {/* Déroulement animé des 3 plans */}
            <div
              className={`grid transition-all duration-500 ease-in-out ${
                plansOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
              }`}
            >
              <div className="overflow-hidden">
                <div className="space-y-3 px-5 pb-5">
                  {PLANS.map((plan) => {
                    const Icon = plan.icon
                    const isActive = plan.id === effectivePlan
                    return (
                      <div
                        key={plan.id}
                        className={`rounded-xl border p-4 transition-colors ${
                          isActive
                            ? "border-orange-600/50 bg-orange-50/50 dark:border-orange-400/40 dark:bg-orange-400/[0.06]"
                            : "border-gray-200 dark:border-white/10"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-center gap-3">
                            <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                              isActive
                                ? "bg-orange-600 text-white dark:bg-orange-500 dark:text-black"
                                : "bg-gray-100 text-gray-500 dark:bg-white/[0.06] dark:text-gray-400"
                            }`}>
                              <Icon className="h-4 w-4" />
                            </span>
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="text-[15px] font-semibold text-gray-900 dark:text-white">{plan.name}</span>
                                {plan.highlighted && (
                                  <span className="rounded-full bg-orange-600 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white dark:bg-orange-500 dark:text-black">
                                    {t("register.mostPopular")}
                                  </span>
                                )}
                              </div>
                              <div className="text-xs text-gray-500 dark:text-gray-400">{plan.description}</div>
                            </div>
                          </div>
                          <div className="shrink-0 text-right">
                            <span className="text-xl font-bold tabular-nums text-gray-900 dark:text-white">{plan.price}$</span>
                            <span className="text-xs text-gray-400 dark:text-gray-500"> {plan.period}</span>
                          </div>
                        </div>

                        <ul className="mt-3 grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
                          {plan.features.map((f) => (
                            <li key={f} className="flex items-start gap-1.5 text-xs text-gray-600 dark:text-gray-400">
                              <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-orange-600 dark:text-orange-400" />
                              {f}
                            </li>
                          ))}
                        </ul>

                        {plan.contactOnly && (
                          isActive ? (
                            <div className="mt-3 flex h-9 items-center justify-center gap-1.5 rounded-lg bg-orange-600 text-[13px] font-semibold text-white dark:bg-orange-500 dark:text-black">
                              <Sparkles className="h-4 w-4" />
                              {t("register.activatedByCode")}
                            </div>
                          ) : (
                            <div className="mt-3 flex items-center justify-between gap-3">
                              <p className="flex items-center gap-1 text-[11px] text-gray-400 dark:text-gray-500">
                                <Sparkles className="h-3 w-3" />
                                {t("register.paidPlanHint")}
                              </p>
                              <Link
                                href="/contact?topic=sales"
                                className="group inline-flex shrink-0 items-center gap-1.5 text-[13px] font-semibold text-orange-600 hover:text-orange-700 dark:text-orange-400 dark:hover:text-orange-300"
                              >
                                {plan.cta}
                                <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                              </Link>
                            </div>
                          )
                        )}
                        {!plan.contactOnly && isActive && (
                          <div className="mt-3 flex h-9 items-center justify-center gap-1.5 rounded-lg bg-orange-600 text-[13px] font-semibold text-white dark:bg-orange-500 dark:text-black">
                            <Check className="h-4 w-4" />
                            {t("register.selected")}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>

            {/* Code magique */}
            <div className="border-t border-gray-100 bg-orange-50/50 px-5 py-4 dark:border-white/[0.06] dark:bg-orange-400/[0.04]">
              <label className="flex items-center gap-1.5 text-[13px] font-semibold text-gray-800 dark:text-gray-200">
                <Sparkles className="h-3.5 w-3.5 text-orange-600 dark:text-orange-400" />
                {t("register.magicCodeQuestion")}
              </label>
              <p className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">{t("register.magicCodeHint")}</p>
              <div className="mt-2.5 flex items-center gap-2">
                <input
                  type="text"
                  value={promoCode}
                  onChange={(e) => { setPromoCode(e.target.value.toUpperCase()); setPromoCodeValid(null) }}
                  onBlur={validatePromoCode}
                  className={inputClass}
                  placeholder={t("register.promoPlaceholder")}
                />
                {validatingPromo && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-gray-400" />}
                {promoCodeValid === true && <Check className="h-4 w-4 shrink-0 text-emerald-500" />}
              </div>
              {promoCodeValid === true && (
                <p className="mt-1.5 text-[12px] font-medium text-emerald-600 dark:text-emerald-400">
                  {t("register.promoActivated")}
                </p>
              )}
            </div>
          </section>

          {/* ── Carte informations ── */}
          <section className="mt-6 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm sm:p-7 dark:border-white/10 dark:bg-[#131517]">
            <h2 className={`${display.className} text-lg font-bold text-gray-900 dark:text-white`}>
              {t("register.yourInfo")}
            </h2>

            <form className="mt-5 space-y-4" onSubmit={handleSubmit}>
              {successMessage && (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-900/40 dark:bg-emerald-950/20">
                  <p className="text-[13px] font-medium text-emerald-700 dark:text-emerald-300">{successMessage}</p>
                  <p className="mt-1 text-[12px] text-emerald-600/70">{t("register.openEmail")}</p>
                </div>
              )}
              {error && (
                <div className={`rounded-lg p-3 ${
                  accountExists
                    ? "border border-emerald-200 bg-emerald-50 dark:border-emerald-900/40 dark:bg-emerald-950/20"
                    : "border border-red-200 bg-red-50 dark:border-red-900/40 dark:bg-red-950/20"
                }`}>
                  <p className={`text-[13px] ${accountExists ? "text-emerald-700 dark:text-emerald-300" : "text-red-700 dark:text-red-300"}`}>{error}</p>
                </div>
              )}

              <div>
                <label className={labelClass}>{t("register.businessType")}</label>
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setBusinessTypeOpen((v) => !v)}
                    aria-haspopup="listbox"
                    aria-expanded={businessTypeOpen}
                    className={`${inputClass} flex items-center justify-between text-left`}
                  >
                    <span className="flex items-center gap-2">
                      <SelectedBusinessIcon className="h-4 w-4 text-orange-600 dark:text-orange-400" />
                      <span className="truncate text-[14px] text-gray-900 dark:text-white">
                        {t(selectedBusiness.labelKey)}
                      </span>
                    </span>
                    <ChevronDown className={`h-4 w-4 text-gray-400 transition-transform duration-200 ${businessTypeOpen ? "rotate-180" : ""}`} />
                  </button>
                  {businessTypeOpen && (
                    <div
                      role="listbox"
                      className="absolute z-30 mt-1 w-full overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg dark:border-white/10 dark:bg-[#1a1c1e]"
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
                            className={`flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-[13px] transition-colors ${
                              bt.locked
                                ? "cursor-not-allowed bg-gray-50/60 opacity-60 dark:bg-white/[0.02]"
                                : isSelected
                                  ? "bg-orange-50 text-orange-700 dark:bg-orange-400/[0.08] dark:text-orange-300"
                                  : "text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-white/[0.04]"
                            }`}
                          >
                            <span className="flex min-w-0 items-center gap-2">
                              <Icon className={`h-4 w-4 shrink-0 ${bt.locked ? "text-gray-400 dark:text-gray-500" : "text-orange-600 dark:text-orange-400"}`} />
                              <span className="truncate">{t(bt.labelKey)}</span>
                            </span>
                            {bt.locked ? (
                              <span className="flex shrink-0 items-center gap-1 text-[11px] font-medium text-amber-600 dark:text-amber-400">
                                <Lock className="h-3 w-3" />
                                {t("register.businessTypeComingSoon")}
                              </span>
                            ) : isSelected ? (
                              <Check className="h-4 w-4 shrink-0 text-orange-600 dark:text-orange-400" />
                            ) : null}
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
                <p className="mt-1.5 flex items-center gap-1 text-[11px] text-gray-400 dark:text-gray-500">
                  <Lock className="h-3 w-3" />
                  {t("register.businessTypeHint")}
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="name" className={labelClass}>{t("register.fullName")}</label>
                  <input id="name" type="text" required value={name} onChange={(e) => setName(e.target.value)} className={inputClass} placeholder="Jean Dupont" />
                </div>
                <div>
                  <label htmlFor="email" className={labelClass}>{t("email")}</label>
                  <input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} placeholder="vous@entreprise.com" />
                </div>
              </div>

              <div>
                <label htmlFor="password" className={labelClass}>{t("password")}</label>
                <div className="relative">
                  <input id="password" type={showPassword ? "text" : "password"} required value={password} onChange={(e) => setPassword(e.target.value)} className={`${inputClass} pr-10`} placeholder={t("register.minChars")} />
                  <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 transition-colors hover:text-gray-600 dark:hover:text-gray-300">
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
                <label htmlFor="confirmPassword" className={labelClass}>{t("register.confirmPassword")}</label>
                <div className="relative">
                  <input id="confirmPassword" type={showConfirmPassword ? "text" : "password"} required value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)}
                    className={`${inputClass} pr-10 ${
                      confirmPassword && !passwordsMatch ? "!border-red-300 dark:!border-red-500/30" : passwordsMatch ? "!border-emerald-300 dark:!border-emerald-500/30" : ""
                    }`}
                    placeholder="••••••••" />
                  <button type="button" onClick={() => setShowConfirmPassword(!showConfirmPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 transition-colors hover:text-gray-600 dark:hover:text-gray-300">
                    {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                {confirmPassword && !passwordsMatch && <p className="mt-1 text-[12px] text-red-500">{t("register.passwordMismatch")}</p>}
              </div>

              <label className="flex cursor-pointer items-start gap-2.5 pt-1">
                <div className="relative mt-0.5">
                  <input type="checkbox" checked={acceptTerms} onChange={(e) => setAcceptTerms(e.target.checked)} className="peer sr-only" />
                  <div className="flex h-4 w-4 items-center justify-center rounded border border-gray-300 bg-white transition-all peer-checked:border-orange-600 peer-checked:bg-orange-600 dark:border-gray-600 dark:bg-white/[0.04] dark:peer-checked:border-orange-500 dark:peer-checked:bg-orange-500">
                    {acceptTerms && <Check className="h-3 w-3 text-white dark:text-black" strokeWidth={3} />}
                  </div>
                </div>
                <span className="text-[12px] leading-relaxed text-gray-500 dark:text-gray-400">
                  {t("register.acceptTerms")}{" "}
                  <Link href="/legal/terms" className="font-medium text-orange-600 hover:underline dark:text-orange-400">{t("register.terms")}</Link>{" "}
                  {t("register.and")}{" "}
                  <Link href="/legal/privacy" className="font-medium text-orange-600 hover:underline dark:text-orange-400">{t("register.privacyPolicy")}</Link>.
                </span>
              </label>

              <button
                type="submit"
                disabled={loading || !acceptTerms}
                className="group flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-orange-600 text-[14px] font-semibold text-white transition-all hover:bg-orange-700 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40 dark:bg-orange-500 dark:text-black dark:hover:bg-orange-400"
              >
                {loading
                  ? <><Loader2 className="h-4 w-4 animate-spin" /> {t("register.creating")}</>
                  : <>{t("register.submit")} <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" /></>}
              </button>
            </form>
          </section>

          {/* ── Réassurance ── */}
          <div className="mt-7 flex items-center justify-center gap-6">
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
      <div className="flex min-h-screen items-center justify-center bg-[#fafafa] dark:bg-[#0b0c0d]">
        <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
      </div>
    }>
      <CreateAccountContent />
    </Suspense>
  )
}
