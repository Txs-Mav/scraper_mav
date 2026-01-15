"use client"

import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { User } from '@/types/user'

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

  const refreshUser = async () => {
    try {
      const {
        data: { user: authUser },
      } = await supabase.auth.getUser()

      if (!authUser) {
        setUser(null)
        setIsLoading(false)
        return
      }

      // Récupérer les données utilisateur depuis la table users
      const { data: userData, error } = await supabase
        .from('users')
        .select('*')
        .eq('id', authUser.id)
        .single()

      if (error) {
        // Log l'erreur pour diagnostic (RLS, etc.)
        console.error('Error fetching user from users table:', error)
        console.error('Error details:', {
          message: error.message,
          code: error.code,
          details: error.details,
          hint: error.hint
        })
        setUser(null)
      } else if (!userData) {
        console.warn('User not found in users table for auth user:', authUser.id)
        setUser(null)
      } else {
        setUser(userData as User)
      }
    } catch (error) {
      console.error('Error refreshing user:', error)
      setUser(null)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    let isMounted = true

    // Vérifier la session immédiatement au chargement
    const initializeAuth = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        
        if (!isMounted) return
        
        if (session) {
          await refreshUser()
        } else {
          setUser(null)
          setIsLoading(false)
        }
      } catch (error) {
        console.error('[Auth] Error initializing:', error)
        if (isMounted) {
          setUser(null)
          setIsLoading(false)
        }
      }
    }

    initializeAuth()

    // Écouter les changements d'authentification
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (!isMounted) return
      
      console.log('[Auth] Event:', event)
      
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        await refreshUser()
        // Proposer la migration des scrapings locaux
        if (event === 'SIGNED_IN') {
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
        }
      } else if (event === 'SIGNED_OUT') {
        setUser(null)
        setIsLoading(false)
      }
    })

    return () => {
      isMounted = false
      subscription.unsubscribe()
    }
  }, [])

  const login = async (email: string, password: string) => {
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      })

      if (error) {
        // Supabase retourne "Invalid login credentials" pour les deux cas :
        // - Email n'existe pas
        // - Mot de passe incorrect
        // Pour des raisons de sécurité, on ne peut pas distinguer les deux
        // Mais on peut améliorer le message
        let errorMessage = "Email ou mot de passe incorrect"
        let errorCode = 'INVALID_CREDENTIALS'
        
        if (error.message?.includes('Invalid login credentials') || 
            error.message?.includes('Invalid email or password')) {
          // Message générique car Supabase ne distingue pas les deux cas
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

      // Rafraîchir l'utilisateur depuis la table users
      await refreshUser()

      // Vérifier que l'utilisateur a bien été chargé
      // Note: On ne peut pas vérifier directement ici car setUser() est asynchrone
      // La vérification se fera dans login/page.tsx avec useEffect

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
      // Créer le compte via Supabase Auth.
      // Le trigger handle_new_user() en base crée users + subscriptions.
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email: data.email,
        password: data.password,
        options: {
          data: {
            name: data.name,
            subscription_plan: data.plan || 'free'
          }
        }
      })

      if (authError) {
        // Vérifier si l'erreur indique que le compte existe déjà
        const isAccountExists = 
          authError.message?.includes('already registered') || 
          authError.message?.includes('already exists') ||
          authError.message?.includes('User already registered') ||
          authError.message?.includes('email address is already registered') ||
          authError.message?.includes('User already registered')

        if (isAccountExists) {
          // Compte existe déjà : retourner erreur spécifique avec code
          return { 
            error: { 
              message: "Un compte existe déjà avec cet email. Veuillez vous connecter.", 
              code: 'ACCOUNT_EXISTS',
              status: authError.status 
            } 
          }
        }

        // Autres erreurs
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
        // Le trigger n'a pas encore écrit la ligne (email non confirmé ou délai de propagation).
        // On informe l'utilisateur de vérifier/valider son email.
        return { error: { message: 'Compte créé. Vérifiez votre email et confirmez pour activer votre compte.', code: 'EMAIL_CONFIRMATION_REQUIRED' } }
      }

      await refreshUser()
      return { error: null }
    } catch (error: any) {
      // Gérer les erreurs inattendues
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

