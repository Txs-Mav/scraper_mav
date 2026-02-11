"use client"

import { useState, useEffect } from "react"
import { useAuth } from "@/contexts/auth-context"
import { getLocalScrapingsCount } from "@/lib/local-storage"
import { PLAN_FEATURES } from "@/lib/plan-restrictions"

interface ScrapingLimit {
  current: number
  limit: number
  isAtLimit: boolean
  isNearLimit: boolean
  canScrape: boolean
  isLocal: boolean
}

export function useScrapingLimit(): ScrapingLimit {
  const { user } = useAuth()
  const [count, setCount] = useState(0)

  useEffect(() => {
    const fetchCount = async () => {
      if (user) {
        // Utilisateur connecté : compter depuis Supabase
        try {
          const response = await fetch('/api/scrapings')
          if (response.ok) {
            const data = await response.json()
            setCount(data.count || 0)
          }
        } catch (error) {
          console.error('Error fetching scrapings count:', error)
        }
      } else {
        // Non connecté : compter depuis localStorage
        setCount(getLocalScrapingsCount())
      }
    }

    fetchCount()
    
    // Rafraîchir le compteur toutes les 5 secondes
    const interval = setInterval(fetchCount, 5000)
    return () => clearInterval(interval)
  }, [user])

  // Plan standard (gratuit) ou non confirmé = 6 scrapings max
  // Plans pro/ultime confirmés (payés ou code promo) = illimités
  // Fallback : si subscription_source est null mais promo_code_id est défini → promo
  const effectiveSource = user?.subscription_source || (user?.promo_code_id ? 'promo' : null)
  const limit = PLAN_FEATURES.scrapingLimit(user?.subscription_plan, effectiveSource)
  const isAtLimit = count >= limit
  const isNearLimit = limit !== Infinity && count >= limit * 0.8

  return {
    current: count,
    limit,
    isAtLimit,
    isNearLimit,
    canScrape: !isAtLimit,
    isLocal: !user,
  }
}


