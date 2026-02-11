"use client"

import { useState, useEffect, Suspense } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { useAuth } from "@/contexts/auth-context"
import { createClient } from "@/lib/supabase/client"
import { Loader2, Eye, EyeOff, Mail } from "lucide-react"
import Image from "next/image"

function LoginContent() {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [loginSuccess, setLoginSuccess] = useState(false)
  const [infoMessage, setInfoMessage] = useState<string | null>(null)
  const [showResendButton, setShowResendButton] = useState(false)
  const [resendingEmail, setResendingEmail] = useState(false)
  const { login, user, isLoading } = useAuth()
  const router = useRouter()
  const searchParams = useSearchParams()
  const supabase = createClient()

  // Vérifier les paramètres d'URL pour afficher des messages informatifs
  useEffect(() => {
    const message = searchParams.get("message")
    if (message === "check_email") {
      setInfoMessage("Compte créé avec succès ! Vérifiez votre email et cliquez sur le lien de confirmation pour activer votre compte.")
    } else if (message === "check_email_promo") {
      setInfoMessage("Compte créé avec le code promo ! Vérifiez votre email et confirmez. Votre plan Ultime sera activé automatiquement, aucun paiement requis.")
    } else if (message === "confirm_email_then_pay") {
      setInfoMessage("Compte créé avec succès ! Vérifiez votre email et cliquez sur le lien de confirmation. Vous serez ensuite redirigé vers le paiement pour activer votre plan.")
    } else if (message === "confirmed") {
      setInfoMessage("Email confirmé avec succès ! Vous pouvez maintenant vous connecter.")
    } else if (message === "password_reset") {
      setInfoMessage("Mot de passe modifié avec succès ! Vous pouvez maintenant vous connecter avec votre nouveau mot de passe.")
    } else if (message === "auth_error") {
      setError("Erreur lors de la confirmation de l'email. Veuillez réessayer.")
    } else if (message === "missing_code") {
      setError("Lien de confirmation invalide. Veuillez vérifier votre email ou demander un nouveau lien.")
    }
  }, [searchParams])

  // Rediriger automatiquement si la connexion est marquée réussie
  useEffect(() => {
    if (loginSuccess) {
      router.push("/dashboard")
    }
  }, [loginSuccess, router])

  // Rediriger si déjà connecté
  useEffect(() => {
    if (!isLoading && user) {
      router.replace("/dashboard")
    }
  }, [user, isLoading, router])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    setLoginSuccess(false)
    setShowResendButton(false)

    const TIMEOUT_MS = 10000

    try {
      const loginWithTimeout = Promise.race([
        login(email, password),
        new Promise<{ error: { message: string; code?: string } }>((_, reject) =>
          setTimeout(() => reject(new Error("La connexion a pris trop de temps. Ce compte a peut-être été supprimé.")), TIMEOUT_MS)
        ),
      ])

      const { error } = await loginWithTimeout

      if (error) {
        const errorMessage = error.message || "Erreur lors de la connexion"
        setError(errorMessage)
        
        // Si l'email n'est pas confirmé, afficher le bouton de renvoi
        if (error.code === 'EMAIL_NOT_CONFIRMED' || errorMessage.includes('confirmer votre email')) {
          setShowResendButton(true)
        }
        return
      } else {
        setLoginSuccess(true)
        router.push("/dashboard")
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Une erreur est survenue"
      setError(message)
    } finally {
      setLoading(false)
    }
  }

  const handleResendConfirmation = async () => {
    if (!email) {
      setError("Veuillez entrer votre adresse email.")
      return
    }

    setResendingEmail(true)
    setError(null)

    try {
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback`
        }
      })

      if (error) {
        setError(error.message || "Erreur lors de l'envoi de l'email.")
      } else {
        setInfoMessage("Email de confirmation renvoyé ! Vérifiez votre boîte de réception (et les spams).")
        setShowResendButton(false)
      }
    } catch (err) {
      setError("Une erreur est survenue lors de l'envoi de l'email.")
    } finally {
      setResendingEmail(false)
    }
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
              Connexion
            </h2>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
              Connectez-vous à votre compte
            </p>
          </div>
        </div>

        <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
          {infoMessage && (
            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-900 rounded-lg p-3">
              <p className="text-sm text-blue-800 dark:text-blue-300">{infoMessage}</p>
            </div>
          )}
          {error && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900 rounded-lg p-3">
              <p className="text-sm text-red-800 dark:text-red-300">{error}</p>
              {showResendButton && (
                <button
                  type="button"
                  onClick={handleResendConfirmation}
                  disabled={resendingEmail}
                  className="mt-2 flex items-center gap-2 text-sm text-blue-600 dark:text-blue-400 hover:underline disabled:opacity-50"
                >
                  {resendingEmail ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Envoi en cours...
                    </>
                  ) : (
                    <>
                      <Mail className="h-4 w-4" />
                      Renvoyer l&apos;email de confirmation
                    </>
                  )}
                </button>
              )}
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label
                htmlFor="email"
                className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
              >
                Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-[#2B2B30] rounded-lg bg-white dark:bg-[#0F0F12] text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="votre@email.com"
              />
            </div>

            <div>
              <label
                htmlFor="password"
                className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
              >
                Mot de passe
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
            </div>
          </div>

          <div>
            <button
              type="submit"
              disabled={loading}
              className="w-full flex justify-center py-3 px-4 border border-transparent rounded-lg shadow-sm text-sm font-medium text-white bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 transform hover:scale-[1.02] active:scale-[0.98]"
            >
              {loading || loginSuccess ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  {loginSuccess ? "Connexion réussie..." : "Connexion..."}
                </>
              ) : (
                "Se connecter"
              )}
            </button>
          </div>

          <div className="text-center space-y-2">
            <div>
              <Link
                href="/forgot-password"
                className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
              >
                Mot de passe oublié ?
              </Link>
            </div>
            <div>
              <Link
                href="/create-account"
                className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
              >
                Créer un compte
              </Link>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function LoginPage() {
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
      <LoginContent />
    </Suspense>
  )
}


