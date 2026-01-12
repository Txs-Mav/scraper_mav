"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import {
  Building2,
  Users,
  Share2,
  ShieldCheck,
  Loader2,
  RefreshCw,
  User,
  Database,
  Boxes,
  ArrowUpRight,
  Sparkles,
  Layers,
} from "lucide-react"
import Layout from "@/components/kokonutui/layout"
import { useAuth } from "@/contexts/auth-context"
import BlocTemplate from "@/components/ui/bloc-template"
import LimitWarning from "@/components/limit-warning"

type UserNode = {
  id: string
  name: string | null
  email: string
  role: string
  avatar_url: string | null
  scraper_count: number
  cache_count: number
  quota_used: number | null
  quota_limit: number | null
  children: UserNode[]
}

type Org = {
  id: string
  name: string
  owner_id: string
}

type Share = {
  id: string
  scraper_cache_id: string
  owner_user_id: string
  target_user_id: string
  permission: string
  created_at: string
}

type Member = {
  id: string
  name: string | null
  email: string
  role: string
  main_account_id: string | null
  avatar_url: string | null
}

type Scraper = {
  id: string
  site_url: string
  cache_key: string
  updated_at: string
}

export default function OrganizationPage() {
  const { user, isLoading: authLoading, refreshUser } = useAuth()
  const router = useRouter()
  const [org, setOrg] = useState<Org | null>(null)
  const [tree, setTree] = useState<UserNode[]>([])
  const [shares, setShares] = useState<Share[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [members, setMembers] = useState<Member[]>([])
  const [scrapers, setScrapers] = useState<Scraper[]>([])
  const [shareForm, setShareForm] = useState({
    scraper_cache_id: "",
    target_user_id: "",
    permission: "read",
  })
  const [shareLoading, setShareLoading] = useState(false)
  const [addMemberId, setAddMemberId] = useState("")
  const [addingMember, setAddingMember] = useState(false)
  const [creatingOrg, setCreatingOrg] = useState(false)
  const [orgName, setOrgName] = useState("")
  const [inviteEmail, setInviteEmail] = useState("")
  const [inviteMessage, setInviteMessage] = useState("")
  const [inviting, setInviting] = useState(false)
  const [searchTerm, setSearchTerm] = useState("")
  const hasAccess = user && user.subscription_plan && user.subscription_plan !== "free"
  const [searchResults, setSearchResults] = useState<Member[]>([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [deletingOrg, setDeletingOrg] = useState(false)
  const [success, setSuccess] = useState<string | null>(null)

  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/login")
    }
  }, [authLoading, user, router])

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true)
        const [orgRes, shareRes, resourcesRes] = await Promise.all([
          fetch("/api/organization"),
          fetch("/api/organization/shares"),
          fetch("/api/organization/resources"),
        ])

        const orgData = await orgRes.json()
        const shareData = await shareRes.json()
        const resourcesData = await resourcesRes.json()

        if (!orgRes.ok) throw new Error(orgData.error || "Erreur chargement organisation")
        if (!shareRes.ok) throw new Error(shareData.error || "Erreur chargement partages")
        if (!resourcesRes.ok) throw new Error(resourcesData.error || "Erreur chargement ressources")

        setOrg(orgData.org || null)
        setTree(orgData.tree || [])
        setShares(shareData.shares || [])
        setMembers(resourcesData.members || [])
        setScrapers(resourcesData.scrapers || [])
      } catch (err: any) {
        setError(err.message || "Erreur lors du chargement")
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  // Préremplir un message par défaut modifiable
  useEffect(() => {
    const fallback =
      org?.name
        ? `Rejoins mon organisation ${org.name} en cliquant sur le lien reçu par email.`
        : "Rejoins mon organisation en cliquant sur le lien reçu par email."
    if (!inviteMessage) {
      setInviteMessage(fallback)
    }
  }, [org, inviteMessage])

  const flattenTree = useMemo(() => {
    const out: UserNode[] = []
    const walk = (node: UserNode, depth: number) => {
      out.push({ ...node, children: [] })
      node.children?.forEach(child => walk(child, depth + 1))
    }
    tree.forEach(n => walk(n, 0))
    return out
  }, [tree])

  const handleRefresh = async () => {
    setRefreshing(true)
    try {
      const res = await fetch("/api/organization")
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Erreur rafraîchissement")
      setOrg(data.org || null)
      setTree(data.tree || [])
    } catch (err: any) {
      setError(err.message || "Erreur lors du rafraîchissement")
    } finally {
      setRefreshing(false)
    }
  }

  const handleAddMember = async () => {
    if (!addMemberId) {
      setError("Choisissez un membre à ajouter")
      return
    }
    setAddingMember(true)
    setError(null)
    try {
      const res = await fetch("/api/organization/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employee_id: addMemberId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Erreur lors de l'ajout du membre")
      setAddMemberId("")
      await handleRefresh()
    } catch (err: any) {
      setError(err.message || "Erreur lors de l'ajout du membre")
    } finally {
      setAddingMember(false)
    }
  }

  const handleCreateOrg = async () => {
    if (!orgName.trim()) {
      setError("Nom d'organisation requis")
      return
    }
    setCreatingOrg(true)
    setError(null)
    try {
      const res = await fetch("/api/organization/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: orgName }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Erreur création organisation")
      setOrg(data.org)
      await refreshUser()
      await handleRefresh()
    } catch (err: any) {
      setError(err.message || "Erreur création organisation")
    } finally {
      setCreatingOrg(false)
    }
  }

  const handleInvite = async () => {
    if (!inviteEmail.trim()) {
      setError("Email requis")
      return
    }
    setInviting(true)
    setError(null)
    setSuccess(null)
    try {
      const fallback =
        org?.name
          ? `Rejoins mon organisation ${org.name} en cliquant sur le lien reçu par email.`
          : "Rejoins mon organisation en cliquant sur le lien reçu par email."
      const res = await fetch("/api/organization/invitations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: inviteEmail.trim(),
          message: inviteMessage?.trim() || fallback,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Erreur envoi invitation")
      setInviteEmail("")
      setInviteMessage(fallback)
      if (data.email_sent === false) {
        setError(
          data.email_error
            ? `Invitation créée mais email non envoyé: ${data.email_error}`
            : "Invitation créée mais email non envoyé"
        )
      } else {
        setSuccess("Invitation envoyée par email.")
      }
    } catch (err: any) {
      setError(err.message || "Erreur envoi invitation")
    } finally {
      setInviting(false)
    }
  }

  const handleSearchUsers = async () => {
    if (!searchTerm.trim()) {
      setSearchResults([])
      return
    }
    setSearchLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/organization/users-search?q=${encodeURIComponent(searchTerm)}&limit=10`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Erreur recherche")
      setSearchResults(data.users || [])
    } catch (err: any) {
      setError(err.message || "Erreur recherche")
    } finally {
      setSearchLoading(false)
    }
  }

  const handleCreateShare = async () => {
    if (!shareForm.scraper_cache_id || !shareForm.target_user_id) {
      setError("Choisissez un scraper et un membre")
      return
    }
    setShareLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/organization/shares", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(shareForm),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Erreur lors du partage")
      setShares(prev => [data.share, ...prev])
      setShareForm({ scraper_cache_id: "", target_user_id: "", permission: "read" })
    } catch (err: any) {
      setError(err.message || "Erreur lors du partage")
    } finally {
      setShareLoading(false)
    }
  }

  const handleDeleteShare = async (id: string) => {
    try {
      const res = await fetch(`/api/organization/shares?id=${id}`, { method: "DELETE" })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Erreur suppression partage")
      setShares(prev => prev.filter(s => s.id !== id))
    } catch (err: any) {
      setError(err.message || "Erreur suppression partage")
    }
  }

  const handleLeaveOrg = async () => {
    setLeaving(true)
    setError(null)
    try {
      const res = await fetch("/api/organization/leave", {
        method: "POST",
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Erreur en quittant l'organisation")
      setOrg(null)
      setTree([])
      setMembers([])
      setShares([])
      await refreshUser()
    } catch (err: any) {
      setError(err.message || "Erreur en quittant l'organisation")
    } finally {
      setLeaving(false)
    }
  }

  const handleDeleteOrg = async () => {
    if (!confirm("Supprimer l'organisation ? Cette action est irréversible.")) return
    setDeletingOrg(true)
    setError(null)
    try {
      const res = await fetch("/api/organization/delete", {
        method: "POST",
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Erreur suppression organisation")
      setOrg(null)
      setTree([])
      setMembers([])
      setShares([])
      await refreshUser()
    } catch (err: any) {
      setError(err.message || "Erreur suppression organisation")
    } finally {
      setDeletingOrg(false)
    }
  }
  const renderNode = (node: UserNode, isRoot = false) => (
    <div key={node.id} className="space-y-3">
      <div className="relative pl-4">
        {!isRoot && <div className="absolute left-0 top-6 h-[1px] w-4 bg-gray-200 dark:bg-[#1F1F23]" />}
        <div className="rounded-lg border border-gray-200/80 dark:border-[#1F1F23] bg-white/70 dark:bg-[#0F0F12] shadow-sm p-3 hover:border-blue-200 dark:hover:border-blue-900/40 transition-colors">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-blue-50 dark:bg-blue-900/20 overflow-hidden flex items-center justify-center">
              {node.avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={node.avatar_url} alt={node.name || "avatar"} className="w-full h-full object-cover" />
              ) : (
                <User className="h-5 w-5 text-blue-600 dark:text-blue-300" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">{node.name || "Utilisateur"}</p>
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-100 dark:bg-[#1F1F23] text-gray-700 dark:text-gray-300">
                  {node.role === "owner"
                    ? `Owner${org ? " • " + org.name : ""}`
                    : `Membre${org ? " • " + org.name : ""}`}
                </span>
              </div>
              <p className="text-xs text-gray-600 dark:text-gray-400 truncate">{node.email}</p>
              <div className="flex flex-wrap gap-3 mt-2 text-[11px] text-gray-700 dark:text-gray-300">
                <span className="flex items-center gap-1"><Boxes className="h-3 w-3" /> {node.scraper_count} scrapers</span>
                <span className="flex items-center gap-1"><Database className="h-3 w-3" /> cache {node.cache_count}</span>
                <span className="flex items-center gap-1"><ShieldCheck className="h-3 w-3" /> quota: —</span>
              </div>
            </div>
            <ArrowUpRight className="h-4 w-4 text-gray-400 shrink-0" />
          </div>
        </div>
      </div>
      {node.children && node.children.length > 0 && (
        <div className="pl-6 border-l border-gray-200 dark:border-[#1F1F23] space-y-3">
          {node.children.map(child => renderNode(child))}
        </div>
      )}
    </div>
  )

  if (authLoading || loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center min-height-screen py-16">
          <Loader2 className="h-6 w-6 animate-spin text-gray-500" />
        </div>
      </Layout>
    )
  }

  if (!user) return null

  const isOwner = members.find(m => m.id === user.id && m.role === "owner") || (org && org.owner_id === user.id)
  const isPremium = user.subscription_plan === "premium"

  return (
    <Layout>
      <div className="container mx-auto px-4 py-8 space-y-6">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <p className="text-xs uppercase tracking-[0.28em] text-gray-500 dark:text-gray-400">Overview</p>
            <h1 className="text-4xl md:text-5xl font-extrabold text-gray-900 dark:text-white leading-tight flex items-center gap-2 mt-2">
              <Building2 className="h-7 w-7" />
              Organization
            </h1>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
              Hiérarchie owner/employés, partage de scrapers et permissions.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleRefresh}
              className="px-4 py-2 rounded-lg border border-gray-200 dark:border-[#1F1F23] text-sm flex items-center gap-2 hover:bg-gray-50 dark:hover:bg-[#1F1F23]"
            >
              {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Refresh
            </button>
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

        {/* Résumé */}
          <div className={`grid grid-cols-1 sm:grid-cols-3 gap-4 ${hasAccess ? "" : "pointer-events-none opacity-50"}`}>
          {[
            { label: "Membres", value: tree.length || 0, icon: Users },
            { label: "Scrapers", value: flattenTree.reduce((acc, n) => acc + n.scraper_count, 0), icon: Layers },
            { label: "Partages", value: shares.length, icon: Share2 },
          ].map((item) => (
            <BlocTemplate key={item.label} className="hover-elevate" innerClassName="p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center">
                <item.icon className="h-5 w-5 text-blue-600 dark:text-blue-300" />
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">{item.label}</p>
                <p className="text-xl font-semibold text-gray-900 dark:text-white">{item.value}</p>
              </div>
            </BlocTemplate>
          ))}
        </div>

        {!org && (
          <BlocTemplate className={`hover-elevate ${hasAccess ? "" : "pointer-events-none opacity-50"}`} innerClassName="p-5 space-y-3">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
              <Building2 className="h-5 w-5" /> Créer mon organisation
            </h2>
            <p className="text-sm text-gray-600 dark:text-gray-400">Définissez un nom, vous deviendrez l’owner.</p>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                value={orgName}
                onChange={e => setOrgName(e.target.value)}
                placeholder="Nom de l'organisation"
                className="flex-1 px-3 py-2 rounded-lg border border-gray-300 dark:border-[#2B2B30] bg-white dark:bg-[#0F0F12] text-sm"
              />
              <button
                onClick={handleCreateOrg}
                disabled={creatingOrg}
                className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2 justify-center"
              >
                {creatingOrg && <Loader2 className="h-4 w-4 animate-spin" />}
                Créer
              </button>
            </div>
          </BlocTemplate>
        )}

        {org && (
          <BlocTemplate className={`hover-elevate ${hasAccess ? "" : "pointer-events-none opacity-50"}`} innerClassName="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.28em] text-gray-500 dark:text-gray-400">Organisation</p>
              <p className="text-lg font-semibold text-gray-900 dark:text-white">{org.name}</p>
            </div>
            <div className="flex items-center gap-2">
              {!isOwner && (
                <button
                  onClick={handleLeaveOrg}
                  disabled={leaving}
                  className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-[#2B2B30] text-sm hover:bg-gray-50 dark:hover:bg-[#1F1F23] disabled:opacity-50"
                >
                  {leaving ? "..." : "Quitter"}
                </button>
              )}
              {isOwner && (
                <button
                  onClick={handleDeleteOrg}
                  disabled={deletingOrg}
                  className="px-3 py-1.5 rounded-lg border border-red-200 text-red-600 dark:border-red-900/50 dark:text-red-300 text-sm hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50"
                >
                  {deletingOrg ? "..." : "Supprimer l'organisation"}
                </button>
              )}
            </div>
          </BlocTemplate>
        )}

        {error && (
          <div className="p-3 rounded-md bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800">
            {error}
          </div>
        )}
        {success && (
          <div className="p-3 rounded-md bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300 border border-green-200 dark:border-green-800">
            {success}
          </div>
        )}

        <div className={`grid grid-cols-1 lg:grid-cols-3 gap-4 ${hasAccess ? "" : "pointer-events-none opacity-50"}`}>
          <div className="lg:col-span-2 space-y-4">
            <BlocTemplate className="hover-elevate" innerClassName="p-5">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
                <Users className="h-5 w-5" /> Hiérarchie
              </h2>
              <div className="space-y-4">
                {tree.length === 0 ? (
                  <p className="text-sm text-gray-600 dark:text-gray-400">Aucun membre pour le moment.</p>
                ) : (
                  tree.map((node, idx) => renderNode(node, true))
                )}
              </div>
            </BlocTemplate>
          </div>

          <div className="space-y-4">
            {org && isOwner && (
              <BlocTemplate className="hover-elevate" innerClassName="p-5 space-y-4">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                  <Users className="h-5 w-5" /> Inviter / Ajouter des membres
                </h2>
                <div className="grid gap-3">
                  <label className="text-xs font-medium text-gray-600 dark:text-gray-300">Inviter par email</label>
                  <input
                    value={inviteEmail}
                    onChange={e => setInviteEmail(e.target.value)}
                    placeholder="email@exemple.com"
                    className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-[#2B2B30] bg-white dark:bg-[#0F0F12] text-sm"
                  />
                  <textarea
                    value={inviteMessage}
                    onChange={e => setInviteMessage(e.target.value)}
                    placeholder="Message (optionnel)"
                    className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-[#2B2B30] bg-white dark:bg-[#0F0F12] text-sm"
                  />
                  <button
                    onClick={handleInvite}
                    disabled={inviting}
                    className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2 justify-center"
                  >
                    {inviting && <Loader2 className="h-4 w-4 animate-spin" />}
                    Envoyer invitation
                  </button>
                </div>

                <div className="border-t border-gray-200 dark:border-[#1F1F23] pt-3 space-y-2">
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                    <Users className="h-4 w-4" /> Ajouter un membre existant
                  </h3>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <input
                      value={searchTerm}
                      onChange={e => setSearchTerm(e.target.value)}
                      placeholder="Nom ou email"
                      className="flex-1 px-3 py-2 rounded-lg border border-gray-300 dark:border-[#2B2B30] bg-white dark:bg-[#0F0F12] text-sm"
                    />
                    <button
                      onClick={handleSearchUsers}
                      disabled={searchLoading}
                      className="px-4 py-2 rounded-lg border border-gray-200 dark:border-[#2B2B30] text-sm hover:bg-gray-50 dark:hover:bg-[#1F1F23] disabled:opacity-50 flex items-center gap-2 justify-center"
                    >
                      {searchLoading && <Loader2 className="h-4 w-4 animate-spin" />}
                      Rechercher
                    </button>
                  </div>
                  <div className="space-y-2">
                    {searchResults.length === 0 && (
                      <p className="text-xs text-gray-600 dark:text-gray-400">Aucun résultat.</p>
                    )}
                    {searchResults.map(m => (
                      <div key={m.id} className="flex items-center gap-3 p-2 rounded-lg border border-gray-200 dark:border-[#1F1F23] bg-white dark:bg-[#0F0F12]">
                        <div className="w-8 h-8 rounded-full bg-gray-100 dark:bg-[#1F1F23] overflow-hidden flex items-center justify-center">
                          {m.avatar_url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={m.avatar_url} alt={m.name || m.email} className="w-full h-full object-cover" />
                          ) : (
                            <User className="h-4 w-4 text-gray-500" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">{m.name || "Utilisateur"}</p>
                          <p className="text-xs text-gray-600 dark:text-gray-400 truncate">{m.email}</p>
                        </div>
                        <button
                          onClick={() => {
                            setAddMemberId(m.id)
                            handleAddMember()
                          }}
                          disabled={addingMember}
                          className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs hover:bg-blue-700 disabled:opacity-50"
                        >
                          Ajouter
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </BlocTemplate>
            )}
            <BlocTemplate className="hover-elevate" innerClassName="p-5">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
                <Share2 className="h-5 w-5" /> Partages
              </h2>
              <div className="space-y-3 mb-4 rounded-lg border border-dashed border-gray-200 dark:border-[#1F1F23] p-3 bg-gray-50/50 dark:bg-[#0b0b0f]">
                <div className="grid gap-3">
                  <div>
                    <label className="text-xs font-medium text-gray-600 dark:text-gray-300">Scraper</label>
                    <div className="mt-1 rounded-lg border border-gray-300 dark:border-[#2B2B30] bg-white dark:bg-[#0F0F12]">
                      <select
                        value={shareForm.scraper_cache_id}
                        onChange={e => setShareForm(f => ({ ...f, scraper_cache_id: e.target.value }))}
                        className="w-full px-3 py-2 rounded-lg bg-transparent text-sm"
                      >
                        <option value="">Sélectionner un scraper</option>
                        {scrapers.map(s => (
                          <option key={s.id} value={s.id}>
                            {s.site_url || s.cache_key} • {new Date(s.updated_at).toLocaleDateString()}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-600 dark:text-gray-300">Membre cible</label>
                    <div className="mt-1 rounded-lg border border-gray-300 dark:border-[#2B2B30] bg-white dark:bg-[#0F0F12]">
                      <select
                        value={shareForm.target_user_id}
                        onChange={e => setShareForm(f => ({ ...f, target_user_id: e.target.value }))}
                        className="w-full px-3 py-2 rounded-lg bg-transparent text-sm"
                      >
                        <option value="">Sélectionner un membre</option>
                        {members.map(m => (
                          <option key={m.id} value={m.id}>
                            {m.name || m.email} {m.id === org?.owner_id ? "(Owner)" : "(Member)"}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-600 dark:text-gray-300">Permission</label>
                    <select
                      value={shareForm.permission}
                      onChange={e => setShareForm(f => ({ ...f, permission: e.target.value }))}
                      className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-[#2B2B30] bg-white dark:bg-[#0F0F12] text-sm"
                    >
                      <option value="read">read</option>
                      <option value="execute">execute</option>
                      <option value="manage">manage</option>
                    </select>
                  </div>
                  <button
                    onClick={handleCreateShare}
                    disabled={shareLoading}
                    className="mt-1 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2 justify-center"
                  >
                    {shareLoading && <Loader2 className="h-4 w-4 animate-spin" />}
                    Créer un partage
                  </button>
                </div>
              </div>
              <div className="space-y-3">
                {shares.length === 0 && (
                  <p className="text-sm text-gray-600 dark:text-gray-400">Aucun partage.</p>
                )}
                {shares.slice(0, 6).map(share => (
                  <div key={share.id} className="p-3 rounded-lg border border-gray-200 dark:border-[#1F1F23] bg-gray-50 dark:bg-[#111]">
                    <div className="flex items-center justify-between">
                      <p className="text-sm text-gray-900 dark:text-white font-medium">
                        {share.permission.toUpperCase()} — scraper {share.scraper_cache_id.slice(0, 6)}…
                      </p>
                      <span className="text-[11px] text-gray-500">{new Date(share.created_at).toLocaleDateString()}</span>
                    </div>
                    <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">Cible : {share.target_user_id}</p>
                    <div className="flex justify-end pt-2">
                      <button
                        onClick={() => handleDeleteShare(share.id)}
                        className="text-xs text-red-600 hover:underline"
                      >
                        Supprimer
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </BlocTemplate>
            <BlocTemplate className="hover-elevate" innerClassName="p-5">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
                <ShieldCheck className="h-5 w-5" /> Permissions
              </h2>
              <ul className="text-sm text-gray-700 dark:text-gray-300 space-y-2">
                <li><span className="font-semibold">read :</span> accès résultats + cache</li>
                <li><span className="font-semibold">execute :</span> lancer le scraper (quota du lanceur)</li>
                <li><span className="font-semibold">manage :</span> modifier / repartager (owner uniquement)</li>
              </ul>
              <div className="mt-4 p-3 rounded-lg bg-blue-50 dark:bg-blue-900/20 text-xs text-blue-900 dark:text-blue-100 flex items-start gap-2">
                <Sparkles className="h-4 w-4 mt-0.5" />
                <span>Les quotas seront branchés plus tard avec les plans d’abonnement.</span>
              </div>
            </BlocTemplate>
          </div>
        </div>
      </div>
    </Layout>
  )
}

