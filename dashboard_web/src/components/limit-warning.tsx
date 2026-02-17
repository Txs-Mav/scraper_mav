"use client"

import { AlertTriangle, TrendingUp } from "lucide-react"
import Link from "next/link"

interface LimitWarningProps {
  type: 'scrapings' | 'analytics'
  current: number
  limit: number
  plan?: 'standard' | 'pro' | 'ultime' | null
  isAuthenticated?: boolean
}

export default function LimitWarning({ type, current, limit, plan, isAuthenticated = false }: LimitWarningProps) {
  const percentage = (current / limit) * 100
  const isNearLimit = percentage >= 80
  const isAtLimit = current >= limit

  if (!isNearLimit && !isAtLimit) {
    return null
  }

  const getMessage = () => {
    if (type === 'analytics') {
      if (!isAuthenticated) {
        return "Connectez-vous pour accéder aux analytics"
      }
      if (plan === 'standard') {
        return "Passez au plan Pro ou Ultime pour accéder aux analytics"
      }
      return null
    }

    if (type === 'scrapings') {
      if (isAtLimit) {
        if (!isAuthenticated) {
          return `Limite de ${limit} scrapings atteinte. Connectez-vous pour plus de scrapings.`
        }
        if (plan === 'standard') {
          return `Limite de ${limit} scrapings atteinte. Passez au plan Pro ou Ultime pour des scrapings illimités.`
        }
      }
      if (isNearLimit) {
        return `Vous avez utilisé ${current}/${limit} scrapings. ${!isAuthenticated ? 'Connectez-vous' : plan === 'standard' ? 'Passez au plan Pro ou Ultime' : ''} pour plus de scrapings.`
      }
    }

    return null
  }

  const message = getMessage()
  if (!message) return null

  return (
    <div className={`rounded-lg p-4 mb-4 ${
      isAtLimit 
        ? 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900' 
        : 'bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-900'
    }`}>
      <div className="flex items-start gap-3">
        <AlertTriangle className={`h-5 w-5 flex-shrink-0 ${
          isAtLimit 
            ? 'text-red-600 dark:text-red-400' 
            : 'text-yellow-600 dark:text-yellow-400'
        }`} />
        <div className="flex-1">
          <p className={`text-sm font-medium ${
            isAtLimit 
              ? 'text-red-800 dark:text-red-300' 
              : 'text-yellow-800 dark:text-yellow-300'
          }`}>
            {message}
          </p>
          {type === 'scrapings' && (
            <div className="mt-2">
              <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                <div
                  className={`h-2 rounded-full transition-all ${
                    isAtLimit 
                      ? 'bg-red-600 dark:bg-red-500' 
                      : 'bg-yellow-600 dark:bg-yellow-500'
                  }`}
                  style={{ width: `${Math.min(percentage, 100)}%` }}
                />
              </div>
              <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                {current} / {limit} scrapings utilisés
              </p>
            </div>
          )}
          {((!isAuthenticated && type === 'analytics') || (plan === 'standard' && type === 'analytics')) && (
            <div className="mt-3">
              {!isAuthenticated ? (
                <Link
                  href="/login"
                  className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm"
                >
                  <TrendingUp className="h-4 w-4" />
                  Se connecter
                </Link>
              ) : (
                <Link
                  href="/dashboard/payments"
                  className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm"
                >
                  <TrendingUp className="h-4 w-4" />
                  Passer au plan Pro
                </Link>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}


