 "use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import Layout from "@/components/kokonutui/layout"
import { useAuth } from "@/contexts/auth-context"
import { useLanguage } from "@/contexts/language-context"
import { Settings, CreditCard, Globe, Loader2, User } from "lucide-react"
import BlocTemplate from "@/components/ui/bloc-template"
import { LanguageToggle } from "@/contexts/language-context"

export default function ProfilePage() {
  const { user, isLoading, isMainAccount } = useAuth()
  const { t, locale } = useLanguage()
  const router = useRouter()

  useEffect(() => {
    if (!isLoading && !user) {
      router.push("/login")
    }
  }, [user, isLoading, router])

  if (isLoading) {
    return (
      <Layout>
        <div className="flex items-center justify-center min-h-screen">
          <Loader2 className="h-8 w-8 animate-spin text-[var(--color-text-secondary)]" />
        </div>
      </Layout>
    )
  }

  if (!user) {
    return null
  }

  const subscriptionLabels: Record<string, string> = {
    free: t("plan.free"),
    standard: "Standard",
    premium: "Premium",
  }

  const displayAvatar = user?.avatar_url || ""

  const displayRole =
    user?.role === "owner"
      ? t("profile.owner")
      : user?.role === "member"
      ? t("profile.member")
      : t("profile.user")

  return (
    <Layout>
      <div className="container mx-auto px-4 py-8">
        <h1 className="text-4xl md:text-5xl font-extrabold text-[var(--color-text-primary)] leading-tight mb-8">
          {t("profilePage.title")}
        </h1>

        <BlocTemplate innerClassName="p-6 max-w-2xl">
          <div className="flex items-center gap-6 mb-6">
            <div className="relative">
              <div className="w-24 h-24 rounded-full ring-4 ring-[var(--color-border-secondary)] overflow-hidden bg-[var(--color-background-secondary)] flex items-center justify-center">
                {displayAvatar ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={displayAvatar} alt={user.name} className="w-full h-full object-cover" />
                ) : (
                  <User className="h-10 w-10 text-gray-400" />
                )}
              </div>
              <div className="absolute bottom-0 right-0 w-6 h-6 rounded-full bg-emerald-500 ring-2 ring-[var(--color-background-primary)]" />
            </div>

            <div className="flex-1">
              <h2 className="text-2xl font-semibold text-[var(--color-text-primary)]">
                {user.name}
              </h2>
              <p className="text-[var(--color-text-secondary)]">{user.email}</p>
              <div className="mt-2">
                <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-200">
                  {displayRole}
                </span>
              </div>
            </div>
          </div>

          <div className="border-t border-[var(--color-border-secondary)] pt-6 space-y-4">
            <div>
              <label className="text-sm font-medium text-[var(--color-text-primary)]">
                {t("profilePage.role")}
              </label>
              <p className="text-[var(--color-text-primary)] mt-1">
                {displayRole}
              </p>
            </div>

            <div>
              <label className="text-sm font-medium text-[var(--color-text-primary)]">
                {t("profilePage.plan")}
              </label>
              <p className="text-[var(--color-text-primary)] mt-1">
                {user.subscription_plan
                  ? subscriptionLabels[user.subscription_plan] || user.subscription_plan
                  : t("profilePage.none")}
              </p>
            </div>

            <div>
              <label className="text-sm font-medium text-[var(--color-text-primary)]">
                {t("profilePage.registeredAt")}
              </label>
              <p className="text-[var(--color-text-primary)] mt-1">
                {new Date(user.created_at).toLocaleDateString(locale === 'en' ? 'en-CA' : 'fr-FR', {
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                })}
              </p>
            </div>
          </div>

          <div className="border-t border-[var(--color-border-secondary)] pt-6 mt-6">
            <div className="flex flex-col gap-4 rounded-2xl border border-[var(--color-border-secondary)] bg-gray-50/70 p-4 dark:bg-[#141617] sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <div className="rounded-xl bg-white p-2 text-[var(--color-text-secondary)] shadow-sm dark:bg-[#1c1e20]">
                  <Globe className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-sm font-medium text-[var(--color-text-primary)]">
                    {t("settings.language")}
                  </p>
                  <p className="text-xs text-[var(--color-text-secondary)] mt-0.5">
                    {t("settings.languageDesc")}
                  </p>
                </div>
              </div>

              <LanguageToggle className="self-start sm:self-center" />
            </div>
          </div>

          <div className="border-t border-[var(--color-border-secondary)] pt-6 mt-6 flex flex-wrap gap-4">
            <Link
              href="/dashboard/settings"
              className="flex items-center gap-2 px-4 py-2 bg-[var(--color-background-secondary)] rounded-lg text-[var(--color-text-primary)] hover:bg-[var(--color-background-hover)] transition-colors"
            >
              <Settings className="h-4 w-4" />
              {t("profilePage.settings")}
            </Link>
            {isMainAccount && (
              <Link
                href="/dashboard/subscription"
                className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors"
              >
                <CreditCard className="h-4 w-4" />
                {t("profilePage.subscription")}
              </Link>
            )}
          </div>
        </BlocTemplate>
      </div>
    </Layout>
  )
}


