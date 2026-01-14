"use client"

import { useState, useEffect, useMemo, Suspense } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { createClient } from "@/lib/supabase/client"
import { Loader2, Eye, EyeOff, CheckCircle } from "lucide-react"
import Image from "next/image"

function ResetPasswordContent() {
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [validating, setValidating] = useState(true)
  const router = useRouter()
  const searchParams = useSearchParams()
  const supabase = useMemo(() => createClient(), [])

  // Extraire les valeurs de searchParams de manière stable
  const urlError = searchParams.get('error')
  const code = searchParams.get('code')
  const urlType = searchParams.get('type')

  // Vérifier que l'utilisateur a accès à cette page (via le token dans l'URL)
  useEffect(() => {
    let timeoutId: NodeJS.Timeout | null = null
    let authListener: { data: { subscription: any } } | null = null
    let isMounted = true

    const checkAccess = async () => {
      try {
        // Vérifier s'il y a une erreur dans l'URL
        if (urlError === 'invalid_link') {
          if (isMounted) {
            setError("Lien invalide ou expiré. Veuillez demander un nouveau lien de réinitialisation.")
            setValidating(false)
          }
          return
        }
        
        // Vérifier s'il y a un hash fragment dans l'URL (access_token, etc.)
        const hashParams = new URLSearchParams(window.location.hash.substring(1))
        const hashType = hashParams.get('type')
        const accessToken = hashParams.get('access_token')
        
        // Si on a un type=recovery dans l'URL ou le hash, c'est une réinitialisation
        // Si on a un code, on assume que c'est une réinitialisation (même sans type explicite)
        const isRecovery = urlType === 'recovery' || hashType === 'recovery' || !!code

        if (code) {
          // Échanger le code contre une session
          const { error } = await supabase.auth.exchangeCodeForSession(code)
          if (error) {
            if (isMounted) {
              setError("Lien invalide ou expiré. Veuillez demander un nouveau lien de réinitialisation.")
              setValidating(false)
            }
            return
          }
        } else if (accessToken && hashType === 'recovery') {
          // Le token est dans le hash, Supabase le gère automatiquement
          // On attend un peu pour que Supabase traite le hash
          await new Promise(resolve => setTimeout(resolve, 1000))
        } else if (!isRecovery) {
          // Pas de code, pas de hash avec type=recovery, et pas de type=recovery dans l'URL
          if (isMounted) {
            setError("Cette page est uniquement accessible via le lien de réinitialisation envoyé par email.")
            setValidating(false)
          }
          return
        }

        // Fonction pour vérifier la session
        const verifySession = () => {
          supabase.auth.getSession().then(({ data: { session } }) => {
            if (session && isMounted) {
              setValidating(false)
              // Nettoyer le listener et le timeout
              if (authListener) {
                authListener.data.subscription.unsubscribe()
                authListener = null
              }
              if (timeoutId) {
                clearTimeout(timeoutId)
                timeoutId = null
              }
            }
          })
        }

        // Vérifier immédiatement
        verifySession()

        // Si toujours en validation, écouter les changements d'authentification
        authListener = supabase.auth.onAuthStateChange((event, session) => {
          if (session && (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') && isMounted) {
            setValidating(false)
            if (authListener) {
              authListener.data.subscription.unsubscribe()
              authListener = null
            }
            if (timeoutId) {
              clearTimeout(timeoutId)
              timeoutId = null
            }
          }
        })

        // Timeout de sécurité après 10 secondes
        timeoutId = setTimeout(() => {
          if (isMounted) {
            setError("Le lien de réinitialisation a expiré ou est invalide. Veuillez demander un nouveau lien.")
            setValidating(false)
            if (authListener) {
              authListener.data.subscription.unsubscribe()
              authListener = null
            }
          }
        }, 10000)
      } catch (err: any) {
        if (isMounted) {
          setError("Erreur lors de la validation du lien. Veuillez réessayer.")
          setValidating(false)
        }
        if (authListener) {
          authListener.data.subscription.unsubscribe()
        }
        if (timeoutId) {
          clearTimeout(timeoutId)
        }
      }
    }

    checkAccess()

    // Nettoyage
    return () => {
      isMounted = false
      if (authListener) {
        authListener.data.subscription.unsubscribe()
      }
      if (timeoutId) {
        clearTimeout(timeoutId)
      }
    }
  }, [urlError, code, urlType, supabase])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    // Validation
    if (password.length < 6) {
      setError("Le mot de passe doit contenir au moins 6 caractères")
      return
    }

    if (password !== confirmPassword) {
      setError("Les mots de passe ne correspondent pas")
      return
    }

    setLoading(true)

    try {
      // Mettre à jour le mot de passe
      const { error } = await supabase.auth.updateUser({
        password: password,
      })

      if (error) {
        setError(error.message || "Erreur lors de la modification du mot de passe")
        return
      }

      setSuccess(true)
      // Rediriger vers la page de confirmation de mot de passe mis à jour
      router.replace("/auth/password-updated")
    } catch (err: any) {
      setError(err.message || "Une erreur est survenue")
    } finally {
      setLoading(false)
    }
  }

  if (validating) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 via-white to-purple-50 dark:from-[#0F0F12] dark:via-[#0F0F12] dark:to-[#1A0F1F] px-4">
        <div className="max-w-md w-full space-y-8 bg-white dark:bg-[#1F1F23] p-8 rounded-2xl border border-gray-200 dark:border-[#2B2B30] shadow-xl">
          <div className="flex flex-col items-center gap-4">
            <Loader2 className="h-8 w-8 animate-spin text-blue-600 dark:text-blue-400" />
            <p className="text-sm text-gray-600 dark:text-gray-400">Validation du lien...</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 via-white to-purple-50 dark:from-[#0F0F12] dark:via-[#0F0F12] dark:to-[#1A0F1F] px-4">
      <div className="max-w-md w-full space-y-8 bg-white dark:bg-[#1F1F23] p-8 rounded-2xl border border-gray-200 dark:border-[#2B2B30] shadow-xl">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="inline-flex items-center gap-3">
            <div className="relative h-10 w-10 rounded-xl bg-white dark:bg-[#141419] shadow-[0_12px_30px_-18px_rgba(0,0,0,0.45),0_0_0_6px_rgba(255,255,255,0.5)] dark:shadow-[0_12px_30px_-18px_rgba(0,0,0,0.6),0_0_0_6px_rgba(255,255,255,0.06)] overflow-hidden">
              <Image
                src="/Go-Data.png"
                alt="Go-Data"
                fill
                sizes="40px"
                className="object-contain"
              />
            </div>
            <span className="text-lg font-semibold text-gray-900 dark:text-white">Go-Data</span>
          </div>
          <div>
            <h2 className="text-3xl font-bold text-gray-900 dark:text-white">
              Réinitialiser le mot de passe
            </h2>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
              Entrez votre nouveau mot de passe
            </p>
          </div>
        </div>

        {success ? (
          <div className="space-y-4">
            <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-900 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <CheckCircle className="h-5 w-5 text-green-600 dark:text-green-400 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-sm font-medium text-green-800 dark:text-green-200">
                    Mot de passe modifié avec succès !
                  </p>
                  <p className="text-sm text-green-700 dark:text-green-300 mt-1">
                    Redirection vers la page de connexion...
                  </p>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
            {error && (
              <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900 rounded-lg p-3">
                <p className="text-sm text-red-800 dark:text-red-300">{error}</p>
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label
                  htmlFor="password"
                  className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                >
                  Nouveau mot de passe
                </label>
                <div className="relative">
                  <input
                    id="password"
                    name="password"
                    type={showPassword ? "text" : "password"}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full px-3 py-2 pr-10 border border-gray-300 dark:border-[#2B2B30] rounded-lg bg-white dark:bg-[#0F0F12] text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="••••••••"
                    minLength={6}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
                  >
                    {showPassword ? (
                      <EyeOff className="h-5 w-5" />
                    ) : (
                      <Eye className="h-5 w-5" />
                    )}
                  </button>
                </div>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  Minimum 6 caractères
                </p>
              </div>

              <div>
                <label
                  htmlFor="confirmPassword"
                  className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                >
                  Confirmer le mot de passe
                </label>
                <div className="relative">
                  <input
                    id="confirmPassword"
                    name="confirmPassword"
                    type={showConfirmPassword ? "text" : "password"}
                    required
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="w-full px-3 py-2 pr-10 border border-gray-300 dark:border-[#2B2B30] rounded-lg bg-white dark:bg-[#0F0F12] text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="••••••••"
                    minLength={6}
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
                  >
                    {showConfirmPassword ? (
                      <EyeOff className="h-5 w-5" />
                    ) : (
                      <Eye className="h-5 w-5" />
                    )}
                  </button>
                </div>
              </div>
            </div>

            <div>
              <button
                type="submit"
                disabled={loading || password.length < 6 || password !== confirmPassword}
                className="w-full flex justify-center py-3 px-4 border border-transparent rounded-lg shadow-sm text-sm font-medium text-white bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 transform hover:scale-[1.02] active:scale-[0.98]"
              >
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Modification en cours...
                  </>
                ) : (
                  "Modifier le mot de passe"
                )}
              </button>
            </div>

            <div className="text-center">
              <Link
                href="/login"
                className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
              >
                Retour à la connexion
              </Link>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 via-white to-purple-50 dark:from-[#0F0F12] dark:via-[#0F0F12] dark:to-[#1A0F1F] px-4">
        <div className="max-w-md w-full space-y-8 bg-white dark:bg-[#1F1F23] p-8 rounded-2xl border border-gray-200 dark:border-[#2B2B30] shadow-xl">
          <div className="flex flex-col items-center gap-4">
            <Loader2 className="h-8 w-8 animate-spin text-blue-600 dark:text-blue-400" />
            <p className="text-sm text-gray-600 dark:text-gray-400">Chargement...</p>
          </div>
        </div>
      </div>
    }>
      <ResetPasswordContent />
    </Suspense>
  )
}
