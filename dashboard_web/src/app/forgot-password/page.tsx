"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { createClient } from "@/lib/supabase/client"
import { Loader2, Mail } from "lucide-react"
import Image from "next/image"

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("")
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()
  const supabase = createClient()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      // Configurer l'URL de redirection vers le callback avec type=recovery
      // Le callback redirigera ensuite vers /reset-password
      // IMPORTANT: Cette URL doit être autorisée dans les paramètres Supabase
      const redirectTo = `${window.location.origin}/auth/callback?type=recovery`
      
      console.log('Requesting password reset for:', email)
      console.log('Redirect URL:', redirectTo)
      
      const { data, error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo,
      })

      console.log('Reset password response:', { data, error })

      if (error) {
        console.error('Error sending reset email:', error)
        setError(error.message || "Erreur lors de l'envoi de l'email")
        setLoading(false)
        return
      }

      // Même si pas d'erreur, vérifier que l'email a bien été envoyé
      // Supabase peut retourner success même si l'email n'est pas envoyé (pour des raisons de sécurité)
      setSuccess(true)
    } catch (err: any) {
      console.error('Exception in password reset:', err)
      setError(err.message || "Une erreur est survenue")
    } finally {
      setLoading(false)
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
              Mot de passe oublié
            </h2>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
              Entrez votre email pour recevoir un lien de réinitialisation
            </p>
          </div>
        </div>

        {success ? (
          <div className="space-y-4">
            <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-900 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <Mail className="h-5 w-5 text-green-600 dark:text-green-400 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-sm font-medium text-green-800 dark:text-green-200">
                    Email envoyé !
                  </p>
                  <p className="text-sm text-green-700 dark:text-green-300 mt-1">
                    Vérifiez votre boîte de réception. Un lien de réinitialisation a été envoyé à <strong>{email}</strong>.
                  </p>
                  <p className="text-xs text-green-600 dark:text-green-400 mt-2">
                    Le lien est valide pendant 1 heure.
                  </p>
                </div>
              </div>
            </div>
            <Link
              href="/login"
              className="block text-center text-sm text-blue-600 dark:text-blue-400 hover:underline"
            >
              Retour à la connexion
            </Link>
          </div>
        ) : (
          <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
            {error && (
              <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900 rounded-lg p-3">
                <p className="text-sm text-red-800 dark:text-red-300">{error}</p>
              </div>
            )}

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
              <button
                type="submit"
                disabled={loading}
                className="w-full flex justify-center py-3 px-4 border border-transparent rounded-lg shadow-sm text-sm font-medium text-white bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 transform hover:scale-[1.02] active:scale-[0.98]"
              >
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Envoi en cours...
                  </>
                ) : (
                  "Envoyer le lien de réinitialisation"
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

