"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { createPortal } from "react-dom"
import { useRouter, usePathname } from "next/navigation"
import {
  X,
  Check,
  Rocket,
  Globe,
  BarChart2,
  Settings,
  ChevronRight,
  Sparkles,
  ArrowRight,
} from "lucide-react"
import { useAuth } from "@/contexts/auth-context"

interface StepDef {
  id: string
  label: string
  description: string
  hint: string
  icon: React.ElementType
  target: string | null
  page: string | null
}

const STEP_DEFS: StepDef[] = [
  {
    id: "profile",
    label: "Complétez votre profil",
    description: "Photo et informations",
    hint: "Ajoutez votre photo et vos informations pour personnaliser votre compte.",
    icon: Settings,
    target: "[data-onboarding='profile']",
    page: "/dashboard/settings",
  },
  {
    id: "config",
    label: "Ajoutez vos concurrents",
    description: "Configurez les sites à surveiller",
    hint: "Cliquez ici pour ajouter votre site de référence et les sites concurrents à surveiller.",
    icon: Globe,
    target: "[data-onboarding='config']",
    page: "/dashboard",
  },
  {
    id: "scrape",
    label: "Lancez la surveillance",
    description: "La plateforme analysera vos concurrents",
    hint: "Lancez la première analyse pour démarrer la surveillance automatique du marché.",
    icon: Rocket,
    target: "[data-onboarding='scrape']",
    page: "/dashboard",
  },
  {
    id: "analyze",
    label: "Explorez le marché",
    description: "Comparez les prix et trouvez les opportunités",
    hint: "Recherchez des produits, comparez les prix et identifiez votre positionnement.",
    icon: BarChart2,
    target: "[data-onboarding='analyze']",
    page: "/dashboard",
  },
]

const TUTORIAL_KEY = "go_data_tutorial"

interface SpotlightState {
  stepId: string
  rect: DOMRect | null
  hint: string
  label: string
  stepIndex: number
}

export default function OnboardingChecklist() {
  const [dismissed, setDismissed] = useState(true)
  const [minimized, setMinimized] = useState(false)
  const { user } = useAuth()
  const router = useRouter()
  const pathname = usePathname()
  const [mounted, setMounted] = useState(false)

  const [completedSteps, setCompletedSteps] = useState<string[]>([])
  const [spotlight, setSpotlight] = useState<SpotlightState | null>(null)
  const spotlightTimerRef = useRef<NodeJS.Timeout | null>(null)

  const [tutorialMode, setTutorialMode] = useState(false)
  const [tutorialStepIndex, setTutorialStepIndex] = useState(0)

  // Restore tutorial state from sessionStorage on mount
  useEffect(() => {
    setMounted(true)
    try {
      const stored = sessionStorage.getItem(TUTORIAL_KEY)
      if (stored) {
        const { stepIndex } = JSON.parse(stored)
        setTutorialMode(true)
        setTutorialStepIndex(stepIndex)
      }
    } catch { /* ignore */ }
  }, [])

  // Normal onboarding init
  useEffect(() => {
    if (!user) return
    const stored = localStorage.getItem(`onboarding_${user.id}`)
    if (stored === "dismissed") {
      setDismissed(true)
      return
    }
    const completed: string[] = stored ? JSON.parse(stored) : []
    setCompletedSteps(completed)

    const hasProducts = localStorage.getItem(`has_scraped_${user.id}`) === "true"

    if (hasProducts) {
      setDismissed(true)
      localStorage.setItem(`onboarding_${user.id}`, "dismissed")
      return
    }

    const autoComplete: string[] = []
    if (user.avatar_url) autoComplete.push("profile")

    const merged = [...new Set([...completed, ...autoComplete])]
    if (merged.length !== completed.length) {
      setCompletedSteps(merged)
      localStorage.setItem(`onboarding_${user.id}`, JSON.stringify(merged))
    }

    if (merged.length >= 4) {
      setDismissed(true)
      localStorage.setItem(`onboarding_${user.id}`, "dismissed")
      return
    }

    setDismissed(false)
  }, [user])

  // Listen for restart-onboarding event
  useEffect(() => {
    const handleRestart = () => {
      sessionStorage.setItem(TUTORIAL_KEY, JSON.stringify({ stepIndex: 0 }))
      setTutorialMode(true)
      setTutorialStepIndex(0)
      setSpotlight(null)
      setMinimized(false)
    }
    window.addEventListener("restart-onboarding", handleRestart)
    return () => window.removeEventListener("restart-onboarding", handleRestart)
  }, [])

  // Show spotlight for a tutorial step
  const showTutorialSpotlight = useCallback((stepDef: StepDef, index: number) => {
    if (!stepDef.target) {
      setSpotlight({
        stepId: stepDef.id,
        rect: null,
        hint: stepDef.hint,
        label: stepDef.label,
        stepIndex: index,
      })
      return
    }

    const el = document.querySelector(stepDef.target) as HTMLElement | null
    if (!el) {
      setSpotlight({
        stepId: stepDef.id,
        rect: null,
        hint: stepDef.hint,
        label: stepDef.label,
        stepIndex: index,
      })
      return
    }

    el.scrollIntoView({ behavior: "smooth", block: "center" })

    if (spotlightTimerRef.current) clearTimeout(spotlightTimerRef.current)
    spotlightTimerRef.current = setTimeout(() => {
      const rect = el.getBoundingClientRect()
      setSpotlight({
        stepId: stepDef.id,
        rect,
        hint: stepDef.hint,
        label: stepDef.label,
        stepIndex: index,
      })
    }, 400)
  }, [])

  // Activate tutorial step: navigate if needed, then show spotlight
  useEffect(() => {
    if (!tutorialMode || !mounted) return

    const stepDef = STEP_DEFS[tutorialStepIndex]
    if (!stepDef) return

    if (stepDef.page && pathname !== stepDef.page) {
      router.push(stepDef.page)
      return
    }

    const tryFind = (attempts: number) => {
      if (!stepDef.target) {
        showTutorialSpotlight(stepDef, tutorialStepIndex)
        return
      }
      const el = document.querySelector(stepDef.target)
      if (el) {
        showTutorialSpotlight(stepDef, tutorialStepIndex)
      } else if (attempts > 0) {
        setTimeout(() => tryFind(attempts - 1), 200)
      } else {
        showTutorialSpotlight(stepDef, tutorialStepIndex)
      }
    }

    const timer = setTimeout(() => tryFind(10), 300)
    return () => clearTimeout(timer)
  }, [tutorialMode, tutorialStepIndex, mounted, pathname, router, showTutorialSpotlight])

  // Advance to next tutorial step
  const handleTutorialNext = useCallback(() => {
    if (spotlightTimerRef.current) clearTimeout(spotlightTimerRef.current)
    setSpotlight(null)

    const nextIndex = tutorialStepIndex + 1
    if (nextIndex >= STEP_DEFS.length) {
      sessionStorage.removeItem(TUTORIAL_KEY)
      setTutorialMode(false)
      return
    }

    sessionStorage.setItem(TUTORIAL_KEY, JSON.stringify({ stepIndex: nextIndex }))
    setTutorialStepIndex(nextIndex)
  }, [tutorialStepIndex])

  // --- Normal onboarding logic ---
  const markComplete = useCallback((stepId: string) => {
    if (!user) return
    const updated = [...new Set([...completedSteps, stepId])]
    setCompletedSteps(updated)
    localStorage.setItem(`onboarding_${user.id}`, JSON.stringify(updated))
    if (updated.length >= 4) {
      setTimeout(() => {
        setDismissed(true)
        localStorage.setItem(`onboarding_${user.id}`, "dismissed")
      }, 1500)
    }
  }, [user, completedSteps])

  const handleDismiss = () => {
    if (!user) return
    setDismissed(true)
    localStorage.setItem(`onboarding_${user.id}`, "dismissed")
  }

  const dismissSpotlight = useCallback(() => {
    setSpotlight(null)
    if (spotlightTimerRef.current) clearTimeout(spotlightTimerRef.current)
  }, [])

  const activateSpotlight = useCallback((stepDef: StepDef) => {
    if (!stepDef.target) {
      markComplete(stepDef.id)
      if (stepDef.page) router.push(stepDef.page)
      return
    }

    if (stepDef.page && pathname !== stepDef.page) {
      router.push(stepDef.page)
      setTimeout(() => {
        trySpotlight(stepDef)
      }, 600)
      return
    }

    trySpotlight(stepDef)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, router, markComplete])

  const trySpotlight = (stepDef: StepDef) => {
    if (!stepDef.target) return
    const el = document.querySelector(stepDef.target) as HTMLElement | null
    if (!el) {
      markComplete(stepDef.id)
      return
    }

    el.scrollIntoView({ behavior: "smooth", block: "center" })

    spotlightTimerRef.current = setTimeout(() => {
      const rect = el.getBoundingClientRect()
      setSpotlight({
        stepId: stepDef.id,
        rect,
        hint: stepDef.hint,
        label: stepDef.label,
        stepIndex: -1,
      })
    }, 400)
  }

  // Reposition spotlight on scroll/resize
  useEffect(() => {
    if (!spotlight || !spotlight.rect) return

    const handleScroll = () => {
      const stepDef = STEP_DEFS.find((s) => s.id === spotlight.stepId)
      if (!stepDef?.target) return
      const el = document.querySelector(stepDef.target) as HTMLElement | null
      if (!el) { dismissSpotlight(); return }
      const rect = el.getBoundingClientRect()
      setSpotlight((prev) => prev ? { ...prev, rect } : null)
    }

    window.addEventListener("scroll", handleScroll, true)
    window.addEventListener("resize", handleScroll)
    return () => {
      window.removeEventListener("scroll", handleScroll, true)
      window.removeEventListener("resize", handleScroll)
    }
  }, [spotlight, dismissSpotlight])

  const steps = STEP_DEFS.map((def) => ({
    ...def,
    completed: completedSteps.includes(def.id),
  }))

  const completedCount = steps.filter((s) => s.completed).length
  const progress = (completedCount / steps.length) * 100

  const pad = 8

  // --- Render: tutorial mode (overlay visuel + widget bas-gauche) ---
  const renderTutorialOverlay = () => {
    if (!mounted || !tutorialMode || !spotlight) return null

    const currentStepDef = STEP_DEFS.find((s) => s.id === spotlight.stepId)
    const Icon = currentStepDef?.icon || Rocket
    const isLast = spotlight.stepIndex >= STEP_DEFS.length - 1
    const hasRect = spotlight.rect !== null

    return createPortal(
      <>
        {/* Overlay visuel non-cliquable */}
        <div className="fixed inset-0 z-[89] pointer-events-none animate-in fade-in duration-200">
          {hasRect && spotlight.rect ? (
            <>
              <div
                className="absolute inset-0 bg-black/60 backdrop-blur-[3px] transition-all duration-300"
                style={{
                  clipPath: `polygon(
                    0% 0%, 0% 100%, 
                    ${spotlight.rect.left - pad}px 100%, 
                    ${spotlight.rect.left - pad}px ${spotlight.rect.top - pad}px, 
                    ${spotlight.rect.right + pad}px ${spotlight.rect.top - pad}px, 
                    ${spotlight.rect.right + pad}px ${spotlight.rect.bottom + pad}px, 
                    ${spotlight.rect.left - pad}px ${spotlight.rect.bottom + pad}px, 
                    ${spotlight.rect.left - pad}px 100%, 
                    100% 100%, 100% 0%
                  )`,
                }}
              />
              <div
                className="absolute rounded-2xl ring-2 ring-emerald-500/80 shadow-[0_0_40px_rgba(16,185,129,0.4)] transition-all duration-300"
                style={{
                  left: spotlight.rect.left - pad,
                  top: spotlight.rect.top - pad,
                  width: spotlight.rect.width + pad * 2,
                  height: spotlight.rect.height + pad * 2,
                }}
              />
            </>
          ) : (
            <div className="absolute inset-0 bg-black/60 backdrop-blur-[3px] transition-all duration-300" />
          )}
        </div>

        {/* Widget fixe en bas à gauche */}
        <div className="fixed bottom-6 left-6 z-[91] w-80 animate-in slide-in-from-bottom-4 fade-in duration-300">
          <div className="bg-[var(--color-background-primary)] rounded-2xl shadow-2xl shadow-black/20 border border-[var(--color-border-secondary)] overflow-hidden">
            {/* Header avec progress */}
            <div className="px-5 pt-4 pb-3 border-b border-[var(--color-border-tertiary)]">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2.5">
                  <div className="p-1.5 rounded-lg bg-gradient-to-br from-emerald-500 to-emerald-600">
                    <Rocket className="h-3.5 w-3.5 text-white" />
                  </div>
                  <span className="text-xs font-bold text-[var(--color-text-primary)]">Guide de démarrage</span>
                </div>
                <span className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                  {spotlight.stepIndex + 1}/{STEP_DEFS.length}
                </span>
              </div>
              {/* Progress dots */}
              <div className="flex items-center gap-1.5">
                {STEP_DEFS.map((_, i) => (
                  <div
                    key={_.id}
                    className={`h-1 rounded-full transition-all duration-500 ${
                      i === spotlight.stepIndex
                        ? "flex-[3] bg-emerald-500"
                        : i < spotlight.stepIndex
                          ? "flex-1 bg-emerald-300 dark:bg-emerald-700"
                          : "flex-1 bg-gray-200 dark:bg-gray-700"
                    }`}
                  />
                ))}
              </div>
            </div>

            {/* Étape courante */}
            <div className="px-5 py-4">
              <div className="flex items-start gap-3">
                <div className="p-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 flex-shrink-0 mt-0.5">
                  <Icon className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-[var(--color-text-primary)]">{spotlight.label}</p>
                  <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed mt-1">{spotlight.hint}</p>
                </div>
              </div>
            </div>

            {/* Bouton suivant */}
            <div className="px-4 pb-4">
              <button
                type="button"
                onClick={handleTutorialNext}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-semibold shadow-lg shadow-emerald-600/25 hover:bg-emerald-700 hover:shadow-xl hover:-translate-y-0.5 active:scale-[0.98] transition-all"
              >
                {isLast ? "Terminer" : "Étape suivante"}
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      </>,
      document.body
    )
  }

  // --- Render: normal spotlight overlay ---
  const renderNormalSpotlight = () => {
    if (!mounted || !spotlight || tutorialMode) return null

    return createPortal(
      <div
        className="fixed inset-0 z-[90] animate-in fade-in duration-200"
        onClick={() => {
          markComplete(spotlight.stepId)
          dismissSpotlight()
        }}
      >
        {spotlight.rect ? (
          <>
            <div
              className="absolute inset-0 bg-black/60 backdrop-blur-[3px] transition-all duration-300"
              style={{
                clipPath: `polygon(
                  0% 0%, 0% 100%, 
                  ${spotlight.rect.left - pad}px 100%, 
                  ${spotlight.rect.left - pad}px ${spotlight.rect.top - pad}px, 
                  ${spotlight.rect.right + pad}px ${spotlight.rect.top - pad}px, 
                  ${spotlight.rect.right + pad}px ${spotlight.rect.bottom + pad}px, 
                  ${spotlight.rect.left - pad}px ${spotlight.rect.bottom + pad}px, 
                  ${spotlight.rect.left - pad}px 100%, 
                  100% 100%, 100% 0%
                )`,
              }}
            />
            <div
              className="absolute rounded-2xl ring-2 ring-emerald-500/80 shadow-[0_0_40px_rgba(16,185,129,0.4)] transition-all duration-300 pointer-events-none"
              style={{
                left: spotlight.rect.left - pad,
                top: spotlight.rect.top - pad,
                width: spotlight.rect.width + pad * 2,
                height: spotlight.rect.height + pad * 2,
              }}
            />
            <div
              className="absolute z-[91] pointer-events-none animate-in slide-in-from-bottom-2 fade-in duration-300"
              style={{
                left: Math.max(16, Math.min(spotlight.rect.left, window.innerWidth - 360)),
                top: spotlight.rect.bottom + pad + 16,
              }}
            >
              <div className="bg-[var(--color-background-primary)] rounded-2xl shadow-2xl shadow-black/20 border border-[var(--color-border-secondary)] p-5 max-w-xs">
                <div className="flex items-center gap-2 mb-2">
                  <div className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                  <p className="text-sm font-bold text-[var(--color-text-primary)]">{spotlight.label}</p>
                </div>
                <p className="text-sm text-[var(--color-text-secondary)] leading-relaxed">{spotlight.hint}</p>
                <p className="text-xs text-[var(--color-text-secondary)] mt-3">Cliquez n&apos;importe où pour continuer</p>
              </div>
            </div>
          </>
        ) : null}
      </div>,
      document.body
    )
  }

  // --- Render: normal onboarding checklist ---
  const renderChecklist = () => {
    if (dismissed || tutorialMode) return null

    if (minimized) {
      return (
        <button
          type="button"
          onClick={() => setMinimized(false)}
          className="fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-3 rounded-full bg-emerald-600 text-white text-sm font-semibold shadow-lg shadow-emerald-600/30 hover:bg-emerald-700 hover:shadow-xl hover:-translate-y-0.5 transition-all"
        >
          <Sparkles className="h-4 w-4" />
          {completedCount}/{steps.length}
        </button>
      )
    }

    return (
      <div className="fixed bottom-6 right-6 z-50 w-80 bg-[var(--color-background-primary)] rounded-2xl shadow-2xl shadow-black/15 dark:shadow-black/40 border border-[var(--color-border-secondary)] overflow-hidden animate-in slide-in-from-bottom-4 fade-in duration-300">
        <div className="relative px-5 pt-5 pb-4">
          <div className="absolute top-3 right-3 flex items-center gap-1">
            <button
              type="button"
              onClick={() => setMinimized(true)}
              className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-[var(--color-background-hover)] transition text-xs"
            >
              —
            </button>
            <button
              type="button"
              onClick={handleDismiss}
              className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-[var(--color-background-hover)] transition"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-600 shadow-lg shadow-emerald-600/20">
              <Rocket className="h-4 w-4 text-white" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-[var(--color-text-primary)]">Bienvenue !</h3>
              <p className="text-xs text-[var(--color-text-secondary)]">{completedCount}/{steps.length} étapes</p>
            </div>
          </div>
          <div className="h-1.5 rounded-full bg-gray-100 dark:bg-white/[0.06] overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-600 transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        <div className="px-3 pb-3 space-y-1">
          {steps.map((step) => {
            const StepIcon = step.icon
            const stepDef = STEP_DEFS.find((s) => s.id === step.id)!
            return (
              <button
                key={step.id}
                type="button"
                onClick={() => !step.completed && activateSpotlight(stepDef)}
                disabled={step.completed}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-all group ${
                  step.completed
                    ? "opacity-60"
                    : "hover:bg-[var(--color-background-hover)]"
                }`}
              >
                <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 transition-all ${
                  step.completed
                    ? "bg-emerald-100 dark:bg-emerald-900/30"
                    : "bg-gray-100 dark:bg-white/[0.06] group-hover:bg-emerald-50 dark:group-hover:bg-emerald-950/30"
                }`}>
                  {step.completed ? (
                    <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                  ) : (
                    <StepIcon className="h-3.5 w-3.5 text-[var(--color-text-secondary)] group-hover:text-emerald-600 dark:group-hover:text-emerald-400" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-medium ${step.completed ? "line-through text-gray-400" : "text-[var(--color-text-primary)]"}`}>
                    {step.label}
                  </p>
                  <p className="text-xs text-[var(--color-text-secondary)] truncate">{step.description}</p>
                </div>
                {!step.completed && (
                  <ChevronRight className="h-4 w-4 text-gray-300 dark:text-gray-600 group-hover:text-emerald-500 flex-shrink-0 transition" />
                )}
              </button>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <>
      {renderTutorialOverlay()}
      {renderNormalSpotlight()}
      {renderChecklist()}
    </>
  )
}
