"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Layout from "@/components/kokonutui/layout"
import { useAuth } from "@/contexts/auth-context"
import { Loader2, Users, Search, ShieldCheck, User } from "lucide-react"
import LimitWarning from "@/components/limit-warning"

type UserLite = {
  id: string
  name: string | null
  email: string
  avatar_url: string | null
  subscription_plan: string | null
  role: string
}

export default function MembersPage() {
  const { user, isLoading: authLoading } = useAuth()
  const router = useRouter()
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<UserLite[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/login")
    }
  }, [authLoading, user, router])

  const handleSearch = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/organization/users-search?q=${encodeURIComponent(query)}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Erreur recherche")
      setResults(data.users || [])
    } catch (err: any) {
      setError(err.message || "Erreur lors de la recherche")
    } finally {
      setLoading(false)
    }
  }

  if (authLoading) {
    return (
      <Layout>
        <div className="flex items-center justify-center min-h-screen">
          <Loader2 className="h-8 w-8 animate-spin text-gray-500" />
        </div>
      </Layout>
    )
  }

  if (!user) return null

  const isOwner = user.role === "owner"
  const isFree = user.subscription_plan === "free"
  const hasAccess = user.subscription_plan !== "free"

  return (
    <Layout>
      <div className="container mx-auto px-4 py-8 space-y-6">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <p className="text-xs uppercase tracking-[0.28em] text-gray-500 dark:text-gray-400">Team</p>
            <h1 className="text-4xl md:text-5xl font-extrabold text-gray-900 dark:text-white leading-tight flex items-center gap-2 mt-2">
              <Users className="h-7 w-7" />
              Members
            </h1>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
              Inviter ou ajouter des comptes employés à votre organisation.
            </p>
          </div>
        </div>

        {!hasAccess && (
          <LimitWarning
            type="analytics"
            current={0}
            limit={0}
            plan={user?.subscription_plan || null}
            isAuthenticated={!!user}
          />
        )}

        {isOwner && hasAccess && (
          <div className="p-4 rounded-xl border border-gray-200 dark:border-[#1F1F23] bg-white dark:bg-[#0F0F12] space-y-3">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
              <Search className="h-5 w-5" /> Rechercher un utilisateur
            </h2>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Nom ou email"
                className="flex-1 px-3 py-2 rounded-lg border border-gray-300 dark:border-[#2B2B30] bg-white dark:bg-[#0F0F12] text-sm"
              />
              <button
                onClick={handleSearch}
                disabled={loading}
                className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2 justify-center"
              >
                {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                Rechercher
              </button>
            </div>
            {error && (
              <div className="text-sm text-red-600 dark:text-red-400">{error}</div>
            )}
            <div className="grid gap-3">
              {results.length === 0 && !loading && (
                <p className="text-sm text-gray-600 dark:text-gray-400">Aucun résultat.</p>
              )}
              {results.map(u => (
                <div
                  key={u.id}
                    className="flex items-center gap-3 p-3 rounded-lg border border-gray-200 dark:border-[#1F1F23] bg-white dark:bg-[#0F0F12]"
                >
                  <div className="w-10 h-10 rounded-full bg-gray-100 dark:bg-[#1F1F23] overflow-hidden flex items-center justify-center">
                    {u.avatar_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={u.avatar_url} alt={u.name || u.email} className="w-full h-full object-cover" />
                    ) : (
                      <User className="h-5 w-5 text-gray-500" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">{u.name || "Utilisateur"}</p>
                    <p className="text-xs text-gray-600 dark:text-gray-400 truncate">{u.email}</p>
                    <div className="flex gap-2 text-[11px] text-gray-600 dark:text-gray-400 mt-1">
                      <span className="px-2 py-0.5 rounded-full bg-gray-100 dark:bg-[#1F1F23]">
                        {u.subscription_plan || "plan ?"}
                      </span>
                      <span className="px-2 py-0.5 rounded-full bg-gray-100 dark:bg-[#1F1F23]">
                        {u.role === "main" ? "Owner" : "Employé"}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Layout>
  )
}

