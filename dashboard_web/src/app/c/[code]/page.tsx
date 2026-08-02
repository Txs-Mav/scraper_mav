"use client"

import { useState, useEffect } from "react"
import { useRouter, useParams } from "next/navigation"
import Link from "next/link"
import Image from "next/image"
import { Bricolage_Grotesque } from "next/font/google"
import { useAuth } from "@/contexts/auth-context"
import { useLanguage } from "@/contexts/language-context"
import { Loader2, Eye, EyeOff, Crown, ArrowRight, Check } from "lucide-react"

const display = Bricolage_Grotesque({ subsets: ["latin"], weight: ["600", "700"] })

/**
 * Page d'inscription « campagne » (flyers/QR) : go-data.co/c/cfmoto.
 * Un seul écran, trois champs, accès instantané — le compte est créé déjà
 * confirmé avec le plan Ultime, puis connecté directement au dashboard.
 * Pensée mobile d'abord : le QR est scanné au téléphone.
 */
export default function CampaignSignupPage() {
  const params = useParams<{ code: string }>()
  const code = (params.code || "").toUpperCase()
  const router = useRouter()
  const { login } = useAuth()
  const { t } = useLanguage()

  const [checking, setChecking] = useState(true)
  const [campaignName, setCampaignName] = useState<string | null>(null)
  const [invalid, setInvalid] = useState(false)

  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [accountExists, setAccountExists] = useState(false)
  const [done, setDone] = useState(false)

  useEffect(() => {
    if (!code) { setInvalid(true); setChecking(false); return }
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch("/api/promo-codes/validate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code }),
        })
        const data = await res.json()
        if (cancelled) return
        if (data.valid) setCampaignName(data.description || null)
        else setInvalid(true)
      } catch {
        if (!cancelled) setInvalid(true)
      } finally {
        if (!cancelled) setChecking(false)
      }
    })()
    return () => { cancelled = true }
  }, [code])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setAccountExists(false)
    setSubmitting(true)
    try {
      const res = await fetch("/api/campaigns/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, name, email, password }),
      })
      const data = await res.json()
      if (!res.ok) {
        if (data.code === "ACCOUNT_EXISTS") {
          setAccountExists(true)
          setError(t("campaign.accountExists"))
        } else {
          setError(data.error || t("register.genericError"))
        }
        setSubmitting(false)
        return
      }
      // Compte créé et confirmé : connexion immédiate puis dashboard.
      setDone(true)
      const { error: loginError } = await login(email.trim(), password)
      if (loginError) {
        router.push("/login")
        return
      }
      router.push("/dashboard")
    } catch {
      setError(t("register.unknownError"))
      setSubmitting(false)
    }
  }

  const inputClass = "w-full h-12 px-4 text-[15px] border border-gray-200 dark:border-white/[0.08] rounded-xl bg-white dark:bg-white/[0.03] text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-orange-500/30 focus:border-orange-500 transition-all"
  const labelClass = "block text-[13px] font-medium text-gray-700 dark:text-gray-300 mb-1.5"

  if (checking) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-[#fafafa] dark:bg-[#0b0c0d]">
        <Loader2 className="h-5 w-5 animate-spin text-orange-500" />
        <p className="text-[13px] text-gray-500 dark:text-gray-400">{t("register.campaignChecking")}</p>
      </div>
    )
  }

  if (invalid) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#fafafa] px-6 text-center dark:bg-[#0b0c0d]">
        <p className="text-[15px] font-semibold text-gray-900 dark:text-white">{t("campaign.invalidTitle")}</p>
        <p className="text-[13px] text-gray-500 dark:text-gray-400">{t("campaign.invalidHint")}</p>
        <Link
          href="/create-account"
          className="flex h-11 items-center gap-2 rounded-xl bg-orange-600 px-5 text-[14px] font-semibold text-white transition-all hover:bg-orange-700 dark:bg-orange-500 dark:text-black dark:hover:bg-orange-400"
        >
          {t("campaign.fallback")}
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen flex-col bg-[#fafafa] dark:bg-[#0b0c0d]">
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-6 py-10">
        <Link href="/" className="mx-auto flex items-center gap-2.5">
          <span className="relative h-8 w-8 overflow-hidden rounded-md ring-1 ring-gray-200 dark:ring-white/10">
            <Image src="/Go-Data.svg" alt="Go-Data" fill sizes="32px" className="object-contain" />
          </span>
          <span className="text-[16px] font-semibold tracking-tight text-gray-900 dark:text-white">Go-Data</span>
        </Link>

        <div className="mt-6 flex justify-center">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-orange-600/10 px-3 py-1.5 text-[12px] font-semibold text-orange-700 ring-1 ring-inset ring-orange-600/20 dark:bg-orange-400/10 dark:text-orange-300 dark:ring-orange-400/25">
            <Crown className="h-3.5 w-3.5" />
            {campaignName ? `${campaignName} · ${t("campaign.badge")}` : t("campaign.badge")}
          </span>
        </div>

        <h1 className={`${display.className} mt-4 text-center text-3xl font-bold tracking-tight text-gray-900 dark:text-white`}>
          {t("campaign.title")}
        </h1>
        <p className="mt-2 text-center text-[14px] text-gray-500 dark:text-gray-400">
          {t("campaign.subtitle")}
        </p>

        <form className="mt-8 space-y-4" onSubmit={handleSubmit}>
          {error && (
            <div className={`rounded-xl border p-3.5 ${
              accountExists
                ? "border-amber-200 bg-amber-50 dark:border-amber-900/40 dark:bg-amber-950/20"
                : "border-red-200 bg-red-50 dark:border-red-900/40 dark:bg-red-950/20"
            }`}>
              <p className={`text-[13px] ${accountExists ? "text-amber-800 dark:text-amber-300" : "text-red-700 dark:text-red-300"}`}>
                {error}
              </p>
              {accountExists && (
                <Link href="/login" className="mt-1.5 inline-flex items-center gap-1 text-[13px] font-semibold text-orange-600 hover:underline dark:text-orange-400">
                  {t("register.signIn")}
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              )}
            </div>
          )}

          <div>
            <label htmlFor="name" className={labelClass}>{t("register.fullName")}</label>
            <input
              id="name" type="text" required autoComplete="name"
              value={name} onChange={(e) => setName(e.target.value)}
              className={inputClass} placeholder="Jean Dupont"
            />
          </div>
          <div>
            <label htmlFor="email" className={labelClass}>{t("email")}</label>
            <input
              id="email" type="email" required autoComplete="email" inputMode="email"
              value={email} onChange={(e) => setEmail(e.target.value)}
              className={inputClass} placeholder="vous@entreprise.com"
            />
          </div>
          <div>
            <label htmlFor="password" className={labelClass}>{t("password")}</label>
            <div className="relative">
              <input
                id="password" type={showPassword ? "text" : "password"} required minLength={6} autoComplete="new-password"
                value={password} onChange={(e) => setPassword(e.target.value)}
                className={`${inputClass} pr-11`} placeholder={t("register.minChars")}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 transition-colors hover:text-gray-600 dark:hover:text-gray-300"
                aria-label={showPassword ? "Masquer" : "Afficher"}
              >
                {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={submitting || done}
            className="group flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-orange-600 text-[15px] font-semibold text-white transition-all hover:bg-orange-700 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60 dark:bg-orange-500 dark:text-black dark:hover:bg-orange-400"
          >
            {submitting || done
              ? <><Loader2 className="h-4 w-4 animate-spin" /> {t("campaign.creating")}</>
              : <>{t("campaign.cta")} <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" /></>}
          </button>

          <p className="text-center text-[12px] leading-relaxed text-gray-500 dark:text-gray-400">
            {t("campaign.termsPrefix")}{" "}
            <Link href="/legal/terms" className="font-medium text-orange-600 hover:underline dark:text-orange-400">{t("register.terms")}</Link>{" "}
            {t("register.and")}{" "}
            <Link href="/legal/privacy" className="font-medium text-orange-600 hover:underline dark:text-orange-400">{t("register.privacyPolicy")}</Link>.
          </p>
        </form>

        <div className="mt-8 flex items-center justify-center gap-2 text-[13px] text-gray-500 dark:text-gray-400">
          <span>{t("register.alreadyAccount")}</span>
          <Link href="/login" className="font-semibold text-orange-600 hover:underline dark:text-orange-400">
            {t("register.signIn")}
          </Link>
        </div>

        <ul className="mt-6 space-y-1.5">
          {[t("plan.ultimateF1"), t("plan.ultimateF2"), t("plan.ultimateF3")].map((f) => (
            <li key={f} className="flex items-center justify-center gap-1.5 text-[12px] text-gray-400 dark:text-gray-500">
              <Check className="h-3 w-3 text-orange-500" />
              {f}
            </li>
          ))}
        </ul>
      </main>
    </div>
  )
}
