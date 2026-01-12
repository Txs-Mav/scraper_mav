 "use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import Layout from "@/components/kokonutui/layout"
import { useAuth } from "@/contexts/auth-context"
import { Settings, CreditCard, Loader2, User } from "lucide-react"
import Image from "next/image"
import BlocTemplate from "@/components/ui/bloc-template"

export default function ProfilePage() {
  const { user, isLoading, isMainAccount } = useAuth()
  const router = useRouter()
  const [orgName, setOrgName] = useState<string | null>(null)

  useEffect(() => {
    if (!isLoading && !user) {
      router.push("/login")
    }
  }, [user, isLoading, router])

  useEffect(() => {
    const loadOrg = async () => {
      if (!user) return
      try {
        const res = await fetch("/api/organization")
        const data = await res.json()
        if (res.ok && data.org?.name) {
          setOrgName(data.org.name)
        } else {
          setOrgName(null)
        }
      } catch {
        setOrgName(null)
      }
    }
    loadOrg()
  }, [user])

  if (isLoading) {
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

  const subscriptionLabels: Record<string, string> = {
    free: "Gratuit",
    standard: "Standard",
    premium: "Premium",
  }

  const displayAvatar =
    user?.avatar_url ||
    "https://ferf1mheo22r9ira.public.blob.vercel-storage.com/avatar-01-n0x8HFv8EUetf9z6ht0wScJKoTHqf8.png"

  const displayRole =
    user?.role === "owner"
      ? `Owner${orgName ? " • " + orgName : ""}`
      : user?.role === "member"
      ? `Membre${orgName ? " • " + orgName : ""}`
      : "Utilisateur"

  return (
    <Layout>
      <div className="container mx-auto px-4 py-8">
        <h1 className="text-4xl md:text-5xl font-extrabold text-gray-900 dark:text-white leading-tight mb-8">
          Mon Profil
        </h1>

        <BlocTemplate innerClassName="p-6 max-w-2xl">
          <div className="flex items-center gap-6 mb-6">
            <div className="relative">
              <div className="w-24 h-24 rounded-full ring-4 ring-gray-200 dark:ring-[#2B2B30] overflow-hidden bg-gray-100 dark:bg-[#1F1F23] flex items-center justify-center">
                {displayAvatar ? (
                  <Image
                    src={displayAvatar}
                    alt={user.name}
                    width={96}
                    height={96}
                    className="object-cover"
                    unoptimized
                  />
                ) : (
                  <User className="h-10 w-10 text-gray-400" />
                )}
              </div>
              <div className="absolute bottom-0 right-0 w-6 h-6 rounded-full bg-emerald-500 ring-2 ring-white dark:ring-[#0F0F12]" />
            </div>

            <div className="flex-1">
              <h2 className="text-2xl font-semibold text-gray-900 dark:text-white">
                {user.name}
              </h2>
              <p className="text-gray-600 dark:text-gray-400">{user.email}</p>
              <div className="mt-2">
                <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-200">
                  {displayRole}
                </span>
              </div>
            </div>
          </div>

          <div className="border-t border-gray-200 dark:border-[#1F1F23] pt-6 space-y-4">
            <div>
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Rôle
              </label>
              <p className="text-gray-900 dark:text-white mt-1">
                {displayRole}
              </p>
            </div>

            <div>
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Plan d'abonnement
              </label>
              <p className="text-gray-900 dark:text-white mt-1">
                {user.subscription_plan
                  ? subscriptionLabels[user.subscription_plan] || user.subscription_plan
                  : "Aucun"}
              </p>
            </div>

            <div>
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Date d'inscription
              </label>
              <p className="text-gray-900 dark:text-white mt-1">
                {new Date(user.created_at).toLocaleDateString("fr-FR", {
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                })}
              </p>
            </div>
          </div>

          <div className="border-t border-gray-200 dark:border-[#1F1F23] pt-6 mt-6 flex gap-4">
            <Link
              href="/dashboard/settings"
              className="flex items-center gap-2 px-4 py-2 bg-gray-100 dark:bg-[#1F1F23] rounded-lg text-gray-900 dark:text-white hover:bg-gray-200 dark:hover:bg-[#2B2B30] transition-colors"
            >
              <Settings className="h-4 w-4" />
              Paramètres
            </Link>
            {isMainAccount && (
              <Link
                href="/dashboard/subscription"
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                <CreditCard className="h-4 w-4" />
                Abonnement
              </Link>
            )}
          </div>
        </BlocTemplate>
      </div>
    </Layout>
  )
}


