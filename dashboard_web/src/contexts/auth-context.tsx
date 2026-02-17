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
  register: (data: { name: string; email: string; password: string; plan?: string }) => Promise<{ error: any }>
  refreshUser: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const supabase = createClient()
  const isInitialized = useRef(false)

  // Charger les données utilisateur depuis la table users via fetch direct
  const loadUserFromTable = useCallback(async (userId: string, accessToken?: string): Promise<User | null> => {
    console.log('[Auth] Loading user from table for id:', userId)
    try {
      const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/users?id=eq.${userId}&select=*`
      const headers: HeadersInit = {
        'apikey': process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        'Content-Type': 'application/json',
      }

      if (accessToken) {
        headers['Authorization'] = `Bearer ${accessToken}`
      }

      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 8000)

      const response = await fetch(url, { headers, signal: controller.signal })
      clearTimeout(timeoutId)

      if (!response.ok) {
        console.error('[Auth] Fetch error:', response.status, response.statusText)
        return null
      }

      const data = await response.json()
      console.log('[Auth] Fetch result:', data)

      if (!data || data.length === 0) {
        console.warn('[Auth] User not found in users table for id:', userId)
        return null
      }

      const userData = data[0]
      console.log('[Auth] User loaded successfully:', userData.name)
      return userData as User
    } catch (error: unknown) {
      // Ne jamais lancer d'exception - retourner null pour que isLoading s'arrête toujours
      if (error instanceof Error && error.name === 'AbortError') {
        console.warn('[Auth] Request timed out in loadUserFromTable')
      } else {
        console.error('[Auth] Error in loadUserFromTable:', error)
      }
      return null
    }
  }, [])

  // Gérer le changement de session
  const handleSessionChange = useCallback(async (session: Session | null) => {
    console.log('[Auth] handleSessionChange:', session ? 'has session' : 'no session')

    try {
      if (session?.user) {
        const userData = await loadUserFromTable(session.user.id, session.access_token)
        
        // Si session existe mais utilisateur pas dans notre table => déconnecter
        if (!userData) {
          console.log('[Auth] Session exists but user not in table, signing out')
          await supabase.auth.signOut()
          setUser(null)
        } else {
          setUser(userData)
        }
      } else {
        setUser(null)
      }
    } catch (error) {
      console.error('[Auth] Error in handleSessionChange:', error)
      setUser(null)
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
      const { data: { session } } = await supabase.auth.getSession()

      if (session?.user) {
        const userData = await loadUserFromTable(session.user.id, session.access_token)
        setUser(userData)
      } else {
        setUser(null)
      }
    } catch (error) {
      console.error('[Auth] Error in refreshUser:', error)
      setUser(null)
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
      const userData = await loadUserFromTable(data.user.id, data.session.access_token)
      if (!userData) {
        await supabase.auth.signOut()
        return {
          error: {
            message: "Ce compte n'existe pas ou a été supprimé.",
            code: 'ACCOUNT_NOT_FOUND',
          },
        }
      }

      setUser(userData)
      return { error: null }
    } catch (error: any) {
      console.error('Error in login:', error)
      return { error: { message: error.message || 'Une erreur inattendue est survenue' } }
    }
  }

  const logout = async () => {
    try {
      await supabase.auth.signOut()
    } catch (error) {
      console.error("Error during logout:", error)
    } finally {
      setUser(null)
    }
  }

  const register = async (data: {
    name: string
    email: string
    password: string
    plan?: string
  }) => {
    try {
      // Stocker le plan payant comme pending_plan s'il n'est pas standard
      const pendingPlan = data.plan && data.plan !== 'standard' ? data.plan : null

      const { data: authData, error: authError } = await supabase.auth.signUp({
        email: data.email,
        password: data.password,
        options: {
          data: {
            name: data.name,
            subscription_plan: 'standard', // Toujours créer avec standard
            pending_plan: pendingPlan // Plan payant en attente de paiement
          },
          // Rediriger vers l'origine actuelle (localhost ou prod) après confirmation email
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
