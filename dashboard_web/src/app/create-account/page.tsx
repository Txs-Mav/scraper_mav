"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { useAuth } from "@/contexts/auth-context"
import { Loader2, Eye, EyeOff } from "lucide-react"

import { Sparkles, Zap, Crown } from "lucide-react"

const PLANS = [
  { 
    id: "free", 
    name: "Gratuit", 
    description: "Accès de base", 
    icon: Sparkles,
    color: "from-gray-500 to-gray-600",
    features: ["10 scrapings maximum", "Dashboard de base"]
  },
  { 
    id: "standard", 
    name: "Standard", 
    description: "Fonctionnalités avancées", 
    price: "À venir",
    icon: Zap,
    color: "from-blue-500 to-blue-600",
    features: ["Scrapings illimités", "Analytics avancés", "Support prioritaire"]
  },
  { 
    id: "premium", 
    name: "Premium", 
    description: "Toutes les fonctionnalités", 
    price: "À venir",
    icon: Crown,
    color: "from-purple-500 to-purple-600",
    features: ["Tout du Standard", "API access", "Support 24/7", "Gestion d'équipe"]
  },
]

export default function CreateAccountPage() {
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [selectedPlan, setSelectedPlan] = useState("free")
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [accountExists, setAccountExists] = useState(false)
  const [registrationSuccess, setRegistrationSuccess] = useState(false)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const { register, user, isLoading } = useAuth()
  const router = useRouter()

  // Rediriger automatiquement vers login après inscription réussie (email à confirmer)
  useEffect(() => {
    if (registrationSuccess && successMessage) {
      // Rediriger vers login après 3 secondes pour laisser le temps de lire le message
      const timer = setTimeout(() => {
        router.push("/login?message=check_email")
      }, 3000)

      return () => clearTimeout(timer)
    }
  }, [registrationSuccess, successMessage, router])

  // Rediriger vers login si le compte existe déjà
  useEffect(() => {
    if (accountExists) {
      const timer = setTimeout(() => {
        router.push("/login")
      }, 3000) // Rediriger après 3 secondes

      return () => clearTimeout(timer)
    }
  }, [accountExists, router])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setAccountExists(false)

    if (password !== confirmPassword) {
      setError("Les mots de passe ne correspondent pas")
      return
    }

    if (password.length < 6) {
      setError("Le mot de passe doit contenir au moins 6 caractères")
      return
    }

    setLoading(true)
    setError(null)
    setSuccessMessage(null)

    try {
      const { error } = await register({
        name,
        email,
        password,
        plan: selectedPlan,
      })

      if (error) {
        // Gérer différents formats d'erreur
        let errorMessage = "Erreur lors de la création du compte"
        
        if (typeof error === 'string') {
          errorMessage = error
        } else if (error?.message) {
          errorMessage = error.message
        } else if (error?.error?.message) {
          errorMessage = error.error.message
        }

        // Vérifier si le compte existe déjà
        if (error?.code === 'ACCOUNT_EXISTS' || errorMessage.includes('existe déjà')) {
          setAccountExists(true)
          errorMessage = "Un compte existe déjà avec cet email. Redirection vers la page de connexion..."
        }

        // Cas de confirmation email requise
        if (error?.code === 'EMAIL_CONFIRMATION_REQUIRED') {
          setSuccessMessage("Compte créé. Vérifiez votre email et confirmez pour activer votre compte.")
          setLoading(false)
          return
        }
        
        setError(errorMessage)
        setLoading(false) // S'assurer que loading est mis à false en cas d'erreur
      } else {
        // Succès : marquer comme réussi et afficher l'instruction email
        setSuccessMessage("Compte créé. Vérifiez votre email et confirmez pour activer votre compte.")
        setRegistrationSuccess(true)
            setLoading(false)
      }
    } catch (err: any) {
      // Gérer les erreurs inattendues
      console.error('Error in handleSubmit:', err)
      setError(err.message || "Une erreur est survenue. Veuillez réessayer.")
      setLoading(false) // S'assurer que loading est mis à false
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 via-white to-purple-50 dark:from-[#0F0F12] dark:via-[#0F0F12] dark:to-[#1A0F1F] px-4 py-12">
      <div className="max-w-4xl w-full space-y-8">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-2">
            Commencez votre aventure
          </h1>
          <p className="text-lg text-gray-600 dark:text-gray-400">
            Créez votre compte et accédez à des outils puissants de scraping
          </p>
        </div>

        <div className="bg-white dark:bg-[#1F1F23] p-8 rounded-2xl border border-gray-200 dark:border-[#2B2B30] shadow-xl">
          <div>
            <h2 className="text-3xl font-bold text-center text-gray-900 dark:text-white">
              Créer un compte
            </h2>
            <p className="mt-2 text-center text-sm text-gray-600 dark:text-gray-400">
              Inscrivez-vous pour commencer
            </p>
          </div>

          <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
            {successMessage && (
              <div className="rounded-lg p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-900">
                <p className="text-sm text-green-800 dark:text-green-300 font-medium">
                  {successMessage}
                </p>
                <p className="text-xs mt-2 text-green-700 dark:text-green-300">
                  Ouvrez l'email de confirmation, cliquez sur le lien, puis reconnectez-vous pour accéder au tableau de bord.
                </p>
              </div>
            )}
            {error && (
              <div className={`rounded-lg p-3 ${
                accountExists 
                  ? "bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-900" 
                  : "bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900"
              }`}>
                <p className={`text-sm ${
                  accountExists 
                    ? "text-blue-800 dark:text-blue-300" 
                    : "text-red-800 dark:text-red-300"
                }`}>
                  {error}
                </p>
                {accountExists && (
                  <p className="text-xs mt-2 text-blue-600 dark:text-blue-400">
                    Vous serez redirigé automatiquement dans quelques secondes...
                  </p>
                )}
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label
                  htmlFor="name"
                  className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                >
                  Nom complet
                </label>
                <input
                  id="name"
                  name="name"
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-[#2B2B30] rounded-lg bg-white dark:bg-[#0F0F12] text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Jean Dupont"
                />
              </div>

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

            {/* Sélection d'abonnement */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-4">
                Plan d'abonnement
              </label>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {PLANS.map((plan) => {
                  const Icon = plan.icon
                  const isSelected = selectedPlan === plan.id
                  return (
                    <button
                      key={plan.id}
                      type="button"
                      onClick={() => setSelectedPlan(plan.id)}
                      className={`relative p-6 rounded-xl border-2 transition-all duration-200 transform hover:scale-105 ${
                        isSelected
                          ? `border-blue-500 bg-gradient-to-br ${plan.color} shadow-lg`
                          : "border-gray-200 dark:border-[#2B2B30] hover:border-gray-300 dark:hover:border-[#3B3B40] bg-white dark:bg-[#0F0F12]"
                      }`}
                    >
                      {isSelected && (
                        <div className="absolute top-2 right-2">
                          <div className="w-6 h-6 bg-white rounded-full flex items-center justify-center">
                            <svg className="w-4 h-4 text-blue-600" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                            </svg>
                          </div>
                        </div>
                      )}
                      <div className="text-center">
                        <div className={`inline-flex items-center justify-center w-12 h-12 rounded-full mb-3 ${
                          isSelected 
                            ? 'bg-white/20 text-white' 
                            : 'bg-gray-100 dark:bg-[#1F1F23] text-gray-600 dark:text-gray-400'
                        }`}>
                          <Icon className="h-6 w-6" />
                        </div>
                        <div className={`font-bold text-lg mb-1 ${
                          isSelected ? 'text-white' : 'text-gray-900 dark:text-white'
                        }`}>
                          {plan.name}
                        </div>
                        <div className={`text-sm mb-3 ${
                          isSelected ? 'text-white/90' : 'text-gray-600 dark:text-gray-400'
                        }`}>
                          {plan.description}
                        </div>
                        {plan.price && (
                          <div className={`text-xs font-semibold mb-2 ${
                            isSelected ? 'text-white/80' : 'text-gray-500 dark:text-gray-500'
                          }`}>
                            {plan.price}
                          </div>
                        )}
                        <ul className={`text-xs space-y-1 text-left mt-3 ${
                          isSelected ? 'text-white/90' : 'text-gray-600 dark:text-gray-400'
                        }`}>
                          {plan.features.map((feature, idx) => (
                            <li key={idx} className="flex items-start gap-1">
                              <span className={isSelected ? 'text-white' : 'text-blue-600 dark:text-blue-400'}>•</span>
                              <span>{feature}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </button>
                  )
                })}
              </div>
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
                    Création du compte...
                  </>
                ) : (
                  "Créer le compte"
                )}
              </button>
            </div>

            <div className="text-center">
              <Link
                href="/login"
                className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
              >
                Déjà un compte ? Se connecter
              </Link>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}

