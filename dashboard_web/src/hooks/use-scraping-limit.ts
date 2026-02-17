"use client"

import { useState, useEffect, useRef, useCallback } from "react"
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

const POLL_INTERVAL_MS = 30_000       // 30s en mode normal
const POLL_INTERVAL_FAST_MS = 10_000  // 10s après un scraping
const MAX_CONSECUTIVE_ERRORS = 3      // Après 3 erreurs, backoff exponentiel
const BACKOFF_BASE_MS = 15_000        // Base pour le backoff exponentiel

export function useScrapingLimit(): ScrapingLimit {
  const { user } = useAuth()
  const [count, setCount] = useState(0)
  const abortRef = useRef<AbortController | null>(null)
  const errorCountRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef = useRef(true)

  const fetchCount = useCallback(async () => {
    // Annuler toute requête précédente encore en cours
    if (abortRef.current) {
      abortRef.current.abort()
    }

    if (!user) {
      if (mountedRef.current) {
        setCount(getLocalScrapingsCount())
      }
      return
    }

    const controller = new AbortController()
    abortRef.current = controller

    try {
      const response = await fetch('/api/scrapings', {
        signal: controller.signal,
      })

      // Si le composant a été démonté pendant le fetch, ne rien faire
      if (!mountedRef.current) return

      if (response.ok) {
        const data = await response.json()
        setCount(data.count || 0)
        errorCountRef.current = 0 // Reset le compteur d'erreurs
      }
      // Erreur HTTP (500, 403, etc.) — ne pas crasher, juste ignorer
    } catch (error: unknown) {
      // AbortError est normal (annulation intentionnelle) — ne pas logger
      if (error instanceof DOMException && error.name === 'AbortError') {
        return
      }
      // Erreur réseau — incrémenter le compteur pour backoff
      if (mountedRef.current) {
        errorCountRef.current += 1
      }
    }
  }, [user])

  // Planifier le prochain polling avec backoff si nécessaire
  const scheduleNext = useCallback(() => {
    if (!mountedRef.current) return

    let delay = POLL_INTERVAL_MS

    if (errorCountRef.current > 0) {
      if (errorCountRef.current >= MAX_CONSECUTIVE_ERRORS) {
        // Backoff exponentiel : 15s, 30s, 60s, 120s... (cap 2min)
        delay = Math.min(
          BACKOFF_BASE_MS * Math.pow(2, errorCountRef.current - MAX_CONSECUTIVE_ERRORS),
          120_000
        )
      }
    }

    timerRef.current = setTimeout(async () => {
      if (!mountedRef.current) return
      await fetchCount()
      scheduleNext()
    }, delay)
  }, [fetchCount])

  useEffect(() => {
    mountedRef.current = true
    errorCountRef.current = 0

    // Fetch initial
    fetchCount().then(() => {
      if (mountedRef.current) {
        scheduleNext()
      }
    })

    return () => {
      mountedRef.current = false
      // Annuler la requête en cours
      if (abortRef.current) {
        abortRef.current.abort()
        abortRef.current = null
      }
      // Annuler le timer
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }
  }, [user, fetchCount, scheduleNext])

  // Plan standard (gratuit) ou non confirmé = 6 scrapings max
  // Plans pro/ultime confirmés (payés ou code promo) = illimités
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
