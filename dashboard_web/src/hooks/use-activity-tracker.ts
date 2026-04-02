"use client"

import { useEffect, useRef, useCallback } from "react"
import { usePathname } from "next/navigation"
import { useAuth } from "@/contexts/auth-context"

const HEARTBEAT_INTERVAL_MS = 5 * 60_000

function getSessionId(): string {
  const key = "go-data-activity-session"
  let id = sessionStorage.getItem(key)
  if (!id) {
    id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
    sessionStorage.setItem(key, id)
  }
  return id
}

function logActivity(
  event_type: string,
  extra: Record<string, any> = {}
) {
  const body = { event_type, ...extra }
  try {
    if (event_type === "session_end" && typeof navigator.sendBeacon === "function") {
      navigator.sendBeacon(
        "/api/activity/log",
        new Blob([JSON.stringify(body)], { type: "application/json" })
      )
      return
    }
  } catch { /* fall through to fetch */ }
  fetch("/api/activity/log", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    keepalive: true,
  }).catch(() => {})
}

export function useActivityTracker() {
  const { user } = useAuth()
  const pathname = usePathname()
  const sessionStartRef = useRef<number>(0)
  const prevPathRef = useRef<string>("")
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const sessionIdRef = useRef<string>("")

  const stopHeartbeat = useCallback(() => {
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current)
      heartbeatRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!user) {
      stopHeartbeat()
      return
    }

    try {
      sessionIdRef.current = getSessionId()
    } catch {
      sessionIdRef.current = `${Date.now()}`
    }

    sessionStartRef.current = Date.now()
    const sid = sessionIdRef.current

    logActivity("session_start", { session_id: sid, page: pathname })

    heartbeatRef.current = setInterval(() => {
      logActivity("heartbeat", { session_id: sid, page: pathname })
    }, HEARTBEAT_INTERVAL_MS)

    const handleUnload = () => {
      const duration = Math.round((Date.now() - sessionStartRef.current) / 1000)
      logActivity("session_end", {
        session_id: sid,
        duration_seconds: duration,
        page: pathname,
      })
    }

    window.addEventListener("beforeunload", handleUnload)

    return () => {
      window.removeEventListener("beforeunload", handleUnload)
      stopHeartbeat()
    }
    // Only on user change (login/logout), not on every pathname change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id])

  useEffect(() => {
    if (!user || !pathname || pathname === prevPathRef.current) return
    prevPathRef.current = pathname

    logActivity("page_view", {
      session_id: sessionIdRef.current,
      page: pathname,
    })
  }, [user, pathname])
}

export { logActivity }
