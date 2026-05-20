"use client"

import { createContext, useContext, useEffect, useState, ReactNode, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { User } from '@/types/user'
import type { Session } from '@supabase/supabase-js'

interface AuthContextType {
  user: User | null
  isLoading: boolean
  isMainAccount: boolean
  login: (email: string, password: string) => Promise<{ error: any }>
  logout: () => Promise<void>
  register: (data: { name: string; email: string; password: string; plan?: string; promoCode?: string; businessType?: string }) => Promise<{ error: any }>
  refreshUser: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const supabase = createClient()
  const isInitialized = useRef(false)

  /**
   * Trois résultats possibles, à NE PAS confondre :
   *   - `found`            : user existe dans la table → on l'utilise.
   *   - `not_found`        : Supabase a répondu 200 + tableau vide. C'est le
   *                          seul cas où on déconnecte (compte supprimé de la
   *                          table `users` mais session encore valide).
   *   - `transient_error`  : timeout réseau, 5xx Supabase, env vars manquantes.
   *                          Ne JAMAIS déconnecter — l'utilisateur ne doit
   *                          pas perdre sa session parce que la DB rame.
   */
  type LoadUserResult =
    | { status: 'found'; user: User }
    | { status: 'not_found' }
    | { status: 'transient_error'; reason: string }

  const loadUserFromTable = useCallback(async (userId: string, accessToken?: string): Promise<LoadUserResult> => {
    console.log('[Auth] Loading user from table for id:', userId)
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (!supabaseUrl || !anonKey) {
      console.error('[Auth] Missing Supabase env vars')
      return { status: 'transient_error', reason: 'missing_env' }
    }

    const url = `${supabaseUrl}/rest/v1/users?id=eq.${userId}&select=*`
    const headers: HeadersInit = {
      'apikey': anonKey,
      'Content-Type': 'application/json',
    }

    if (accessToken) {
      headers['Authorization'] = `Bearer ${accessToken}`
    }

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 8000)

    let response: Response
    try {
      response = await fetch(url, { headers, signal: controller.signal })
    } catch (error: unknown) {
      clearTimeout(timeoutId)
      const isAbort = error instanceof Error && error.name === 'AbortError'
      console.warn('[Auth] loadUserFromTable network failure:', isAbort ? 'timeout' : error)
      return { status: 'transient_error', reason: isAbort ? 'timeout' : 'network' }
    }
    clearTimeout(timeoutId)

    if (!response.ok) {
      // 4xx (sauf 404 sur cette query, qui retournerait juste []) = erreur
      // sérieuse — on log mais on traite comme transitoire pour ne pas kicker.
      // 5xx = Supabase rame, transitoire.
      console.error('[Auth] Fetch error:', response.status, response.statusText)
      return { status: 'transient_error', reason: `http_${response.status}` }
    }

    let data: unknown
    try {
      data = await response.json()
    } catch (error: unknown) {
      console.error('[Auth] Failed to parse user response:', error)
      return { status: 'transient_error', reason: 'parse_error' }
    }

    if (!Array.isArray(data) || data.length === 0) {
      // Réponse HTTP OK + tableau vide = vrai cas "user pas dans la table".
      // C'est ICI (et seulement ici) qu'on peut légitimement déconnecter.
      console.warn('[Auth] User not found in users table for id:', userId)
      return { status: 'not_found' }
    }

    const userRecord = data[0] as User
    console.log('[Auth] User loaded successfully:', userRecord.name)
    return { status: 'found', user: userRecord }
  }, [])

  // Gérer le changement de session
  const handleSessionChange = useCallback(async (session: Session | null) => {
    console.log('[Auth] handleSessionChange:', session ? 'has session' : 'no session')

    try {
      if (session?.user) {
        const result = await loadUserFromTable(session.user.id, session.access_token)

        if (result.status === 'found') {
          setUser(result.user)
        } else if (result.status === 'not_found') {
          // Cas légitime : compte supprimé de la table `users` mais session
          // auth encore valide. On force la déconnexion.
          console.log('[Auth] Session exists but user not in table, signing out')
          await supabase.auth.signOut()
          setUser(null)
        } else {
          // Erreur transitoire (timeout, 5xx, network). On garde la session
          // côté Supabase Auth, on ne touche pas à setUser pour éviter un
          // re-render qui afficherait "non connecté" alors que tout est OK.
          // L'utilisateur sera rechargé au prochain TOKEN_REFRESHED.
          console.warn(
            '[Auth] Transient error loading user, keeping session:',
            result.reason,
          )
        }
      } else {
        setUser(null)
      }
    } catch (error) {
      console.error('[Auth] Error in handleSessionChange:', error)
      // Ne PAS faire setUser(null) ici — on ne sait pas si c'est un vrai
      // problème ou un hiccup réseau. Garder l'état actuel.
    } finally {
      // TOUJOURS arrêter le chargement, même si erreur
      setIsLoading(false)
    }
  }, [loadUserFromTable])

  // Fonction refreshUser pour les appels manuels
  const refreshUser = useCallback(async () => {
    console.log('[Auth] refreshUser() called')
    try {
      // Utiliser getSession au lieu de getUser pour éviter les problèmes de blocage
      const { data: { session }, error } = await supabase.auth.getSession()

      // Refresh token mort (révoqué, expiré, absent) : Supabase a déjà fire
      // un SIGNED_OUT, on aligne juste notre state local. Le middleware
      // serveur s'occupe d'effacer les cookies sb-* au prochain round-trip.
      if (error) {
        const code = (error as { code?: string })?.code
        const isAuthGone =
          code === 'refresh_token_not_found' ||
          code === 'invalid_refresh_token' ||
          code === 'refresh_token_already_used' ||
          /refresh token/i.test(error.message || '')
        if (isAuthGone) {
          setUser(null)
          return
        }
        console.warn('[Auth] refreshUser getSession error (non-fatal):', error.message)
      }

      if (session?.user) {
        const result = await loadUserFromTable(session.user.id, session.access_token)
        if (result.status === 'found') {
          setUser(result.user)
        } else if (result.status === 'not_found') {
          setUser(null)
        }
        // transient_error: on garde l'état précédent (cf. handleSessionChange)
      } else {
        setUser(null)
      }
    } catch (error) {
      console.error('[Auth] Error in refreshUser:', error)
      // Cf. handleSessionChange : on ne kick pas sur erreur transitoire.
    } finally {
      setIsLoading(false)
    }
  }, [supabase, loadUserFromTable])

  useEffect(() => {
    // Éviter la double initialisation en mode Strict
    if (isInitialized.current) return
    isInitialized.current = true

    console.log('[Auth] Setting up auth listener...')

    // Écouter les changements d'authentification
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      console.log('[Auth] Event:', event, 'Session:', session ? 'exists' : 'null')

      if (event === 'INITIAL_SESSION') {
        // Gérer la session initiale
        await handleSessionChange(session)

      } else if (event === 'SIGNED_IN') {
        await handleSessionChange(session)

        // Proposer la migration des scrapings locaux
        try {
          const { getLocalScrapingsCount } = await import('@/lib/local-storage')
          const localCount = getLocalScrapingsCount()
          if (localCount > 0) {
            window.dispatchEvent(new CustomEvent('local-scrapings-available', {
              detail: { count: localCount }
            }))
          }
        } catch (error) {
          console.error('Error checking local scrapings:', error)
        }

      } else if (event === 'TOKEN_REFRESHED') {
        await handleSessionChange(session)

      } else if (event === 'SIGNED_OUT') {
        setUser(null)
        setIsLoading(false)
      }
    })

    return () => {
      subscription.unsubscribe()
    }
  }, [supabase, handleSessionChange])

  const login = async (email: string, password: string) => {
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      })

      if (error) {
        let errorMessage = "Email ou mot de passe incorrect"
        let errorCode = 'INVALID_CREDENTIALS'

        if (error.message?.includes('Invalid login credentials') ||
          error.message?.includes('Invalid email or password')) {
          errorMessage = "L'email ou le mot de passe est incorrect. Veuillez vérifier vos identifiants."
        } else if (error.message?.includes('Email not confirmed')) {
          errorMessage = "Veuillez confirmer votre email avant de vous connecter"
          errorCode = 'EMAIL_NOT_CONFIRMED'
        } else {
          errorMessage = error.message || "Erreur lors de la connexion"
        }

        return { error: { message: errorMessage, code: errorCode, status: error.status } }
      }

      if (!data.session || !data.user) {
        return { error: { message: 'Échec de la connexion. Veuillez réessayer.' } }
      }

      // Vérifier que l'utilisateur existe dans notre table (compte supprimé = absent)
      const result = await loadUserFromTable(data.user.id, data.session.access_token)
      if (result.status === 'not_found') {
        await supabase.auth.signOut()
        return {
          error: {
            message: "Ce compte n'existe pas ou a été supprimé.",
            code: 'ACCOUNT_NOT_FOUND',
          },
        }
      }
      if (result.status === 'transient_error') {
        // Auth réussie côté Supabase mais on ne peut pas charger le profil.
        // On surface l'erreur à l'utilisateur SANS le déconnecter — il pourra
        // rafraîchir la page une fois la DB redevenue disponible.
        return {
          error: {
            message:
              "Connexion réussie mais le chargement de ton profil a échoué " +
              "(réseau ou base de données lente). Rafraîchis la page dans un instant.",
            code: 'PROFILE_LOAD_FAILED',
          },
        }
      }

      setUser(result.user)
      return { error: null }
    } catch (error: any) {
      console.error('Error in login:', error)
      return { error: { message: error.message || 'Une erreur inattendue est survenue' } }
    }
  }

  const logout = async () => {
    // Déconnexion en 2 temps : d'abord invalider la session locale (storage
    // + cookies non-httpOnly), ensuite appeler la route serveur qui efface
    // les cookies httpOnly utilisés par le middleware Next.js. Sans la 2e
    // étape, le middleware voit encore la session et reconnecte l'user au
    // prochain rendu (cas reproductible avec le compte dev, cookies 30j).
    try {
      await supabase.auth.signOut()
    } catch (error) {
      console.error("Error during client signOut:", error)
    }

    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "include",
      })
    } catch (error) {
      console.error("Error during server logout:", error)
    }

    setUser(null)
  }

  const register = async (data: {
    name: string
    email: string
    password: string
    plan?: string
    promoCode?: string
    businessType?: string
  }) => {
    try {
      const hasPromo = !!data.promoCode
      const subscriptionPlan = hasPromo ? 'ultime' : 'standard'
      const pendingPlan = !hasPromo && data.plan && data.plan !== 'standard' ? data.plan : null

      const { data: authData, error: authError } = await supabase.auth.signUp({
        email: data.email,
        password: data.password,
        options: {
          data: {
            name: data.name,
            subscription_plan: subscriptionPlan,
            pending_plan: pendingPlan,
            business_type: data.businessType ?? 'recreational_vehicles',
            ...(hasPromo ? { promo_code: data.promoCode } : {}),
          },
          emailRedirectTo: typeof window !== 'undefined' ? `${window.location.origin}/auth/callback` : undefined
        }
      })

      if (authError) {
        const isAccountExists =
          authError.message?.includes('already registered') ||
          authError.message?.includes('already exists') ||
          authError.message?.includes('User already registered') ||
          authError.message?.includes('email address is already registered')

        if (isAccountExists) {
          // L'email existe dans auth.users - essayer de renvoyer l'email de confirmation
          // Si l'utilisateur n'a pas confirmé son email, ça fonctionnera
          console.log('[Auth] Email already exists, trying to resend confirmation...')
          
          try {
            const { error: resendError } = await supabase.auth.resend({
              type: 'signup',
              email: data.email,
              options: {
                emailRedirectTo: typeof window !== 'undefined' ? `${window.location.origin}/auth/callback` : undefined
              }
            })

            if (!resendError) {
              // Email de confirmation renvoyé avec succès
              console.log('[Auth] Confirmation email resent successfully')
              return {
                error: {
                  message: "Un compte existe avec cet email mais n'a pas été confirmé. Nous avons renvoyé l'email de confirmation.",
                  code: 'EMAIL_CONFIRMATION_RESENT',
                }
              }
            }

            // Le resend a échoué - l'utilisateur est probablement déjà confirmé
            console.log('[Auth] Resend failed, user is likely confirmed:', resendError.message)
          } catch (resendErr) {
            console.error('[Auth] Error trying to resend:', resendErr)
          }

          // Fallback: le compte existe et est confirmé
          return {
            error: {
              message: "Un compte existe déjà avec cet email. Veuillez vous connecter.",
              code: 'ACCOUNT_EXISTS',
              status: authError.status
            }
          }
        }

        let errorMessage = authError.message || "Erreur lors de la création du compte"

        if (authError.message?.includes('Password')) {
          errorMessage = "Le mot de passe doit contenir au moins 6 caractères."
        } else if (authError.message?.includes('Invalid email')) {
          errorMessage = "L'adresse email n'est pas valide."
        }

        return { error: { message: errorMessage, code: authError.status } }
      }

      if (!authData.user) {
        return { error: { message: 'Échec de la création du compte. Veuillez réessayer.' } }
      }

      // Laisser le trigger créer les lignes; petit délai pour la propagation
      await new Promise(resolve => setTimeout(resolve, 800))

      // Vérifier si l'utilisateur a été créé par le trigger
      const { data: existingUser, error: checkError } = await supabase
        .from('users')
        .select('*')
        .eq('id', authData.user.id)
        .single()

      if (checkError && checkError.code !== 'PGRST116') {
        console.error('Error checking user:', checkError)
        return { error: { message: 'Erreur lors de la vérification du profil utilisateur.' } }
      }

      if (!existingUser) {
        return { error: { message: 'Compte créé. Vérifiez votre email et confirmez pour activer votre compte.', code: 'EMAIL_CONFIRMATION_REQUIRED' } }
      }

      setUser(existingUser as User)
      return { error: null }
    } catch (error: any) {
      console.error('Error in register:', error)
      return { error: { message: error.message || 'Une erreur inattendue est survenue. Veuillez réessayer.' } }
    }
  }

  const isMainAccount = user?.role === 'main'

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isMainAccount,
        login,
        logout,
        register,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
