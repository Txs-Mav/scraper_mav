"use client"

/**
 * Guide de première visite d'une page.
 *
 * Met en évidence chaque zone clé tour à tour : tout l'écran est assombri
 * sauf l'élément expliqué (spotlight), avec une carte d'explication à côté
 * et une progression « Étape X sur N ». Ne s'affiche qu'à la première
 * visite (drapeau localStorage par page), et peut être rejoué en
 * dispatchant l'évènement `page-onboarding:replay:<pageKey>`.
 *
 * Usage :
 *   <PageOnboarding
 *     pageKey="strategie-pricing"
 *     ready={!loading}
 *     steps={[{ targetId: "step-rule", title: "…", description: "…" }]}
 *   />
 */

import { useCallback, useEffect, useState } from "react"
import { createPortal } from "react-dom"
import { X } from "lucide-react"

export type PageOnboardingStep = {
  /** id DOM de l'élément à mettre en lumière */
  targetId: string
  title: string
  description: string
}

const STORAGE_PREFIX = "page-onboarding-seen:"

/** Déclenche la relecture du guide d'une page (bouton « Revoir le guide »). */
export function replayPageOnboarding(pageKey: string) {
  window.dispatchEvent(new Event(`page-onboarding:replay:${pageKey}`))
}

type SpotlightRect = { top: number; left: number; width: number; height: number }

export default function PageOnboarding({
  pageKey,
  steps,
  ready = true,
}: {
  pageKey: string
  steps: PageOnboardingStep[]
  /** Attendre que la page ait fini de charger avant de mesurer les cibles. */
  ready?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [stepIndex, setStepIndex] = useState(0)
  const [rect, setRect] = useState<SpotlightRect | null>(null)

  // Première visite : on ouvre une fois la page prête (petit délai pour
  // laisser le layout se stabiliser avant de mesurer).
  useEffect(() => {
    if (!ready || open) return
    try {
      if (window.localStorage.getItem(STORAGE_PREFIX + pageKey)) return
    } catch {
      return
    }
    const timer = setTimeout(() => setOpen(true), 450)
    return () => clearTimeout(timer)
  }, [ready, pageKey, open])

  // Si la page redevient « pas prête » (ex. une autre modale requise s'ouvre
  // par-dessus), on se met en pause SANS poser le drapeau « vu » : le guide
  // se rouvrira tout seul quand `ready` repassera à true.
  useEffect(() => {
    if (!ready && open) {
      setOpen(false)
      setStepIndex(0)
    }
  }, [ready, open])

  // Relecture à la demande (évènement custom).
  useEffect(() => {
    const handler = () => {
      setStepIndex(0)
      setOpen(true)
    }
    const eventName = `page-onboarding:replay:${pageKey}`
    window.addEventListener(eventName, handler)
    return () => window.removeEventListener(eventName, handler)
  }, [pageKey])

  const close = useCallback(() => {
    try {
      window.localStorage.setItem(STORAGE_PREFIX + pageKey, "1")
    } catch { /* ignore */ }
    setOpen(false)
    setStepIndex(0)
  }, [pageKey])

  const step = steps[stepIndex]

  const measure = useCallback(() => {
    if (!step) return
    const el = document.getElementById(step.targetId)
    if (!el) {
      setRect(null)
      return
    }
    const r = el.getBoundingClientRect()
    setRect({ top: r.top, left: r.left, width: r.width, height: r.height })
  }, [step])

  // À chaque étape : scroller la cible au centre, puis mesurer. On re-mesure
  // aussi sur resize/scroll pour que le spotlight suive l'élément.
  useEffect(() => {
    if (!open || !step) return
    const el = document.getElementById(step.targetId)
    if (el) el.scrollIntoView({ block: "center", behavior: "smooth" })
    const timer = setTimeout(measure, 380)
    window.addEventListener("resize", measure)
    window.addEventListener("scroll", measure, true)
    return () => {
      clearTimeout(timer)
      window.removeEventListener("resize", measure)
      window.removeEventListener("scroll", measure, true)
    }
  }, [open, step, measure])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, close])

  if (!open || !step) return null

  const isLast = stepIndex === steps.length - 1
  const PAD = 8
  const isDesktop = typeof window !== "undefined" && window.innerWidth >= 640
  // Carte sous la cible si celle-ci est dans la moitié haute, sinon au-dessus.
  const cardBelow = rect ? rect.top + rect.height / 2 < window.innerHeight / 2 : true

  return createPortal(
    <div
      className="fixed inset-0 z-[10000]"
      role="dialog"
      aria-modal="true"
      aria-label="Guide de la page"
    >
      {/* Clic hors de la carte : on ferme (le guide ne doit jamais bloquer). */}
      <div className="absolute inset-0" onClick={close} />

      {rect ? (
        /* L'assombrissement est porté par le box-shadow géant du spotlight :
           tout est sombre SAUF la zone expliquée, qui reste nette. */
        <div
          className="absolute rounded-xl pointer-events-none transition-all duration-300 ease-out shadow-[0_0_0_9999px_rgba(0,0,0,0.55)] ring-2 ring-orange-500/80"
          style={{
            top: rect.top - PAD,
            left: rect.left - PAD,
            width: rect.width + PAD * 2,
            height: rect.height + PAD * 2,
          }}
        />
      ) : (
        <div className="absolute inset-0 bg-black/55 pointer-events-none" />
      )}

      <div
        className="absolute w-[min(400px,calc(100vw-32px))] rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#151719] p-4 shadow-2xl shadow-black/30"
        style={
          rect && isDesktop
            ? {
                top: cardBelow ? rect.top + rect.height + PAD + 14 : undefined,
                bottom: cardBelow ? undefined : window.innerHeight - rect.top + PAD + 14,
                left: Math.min(Math.max(16, rect.left), Math.max(16, window.innerWidth - 432)),
              }
            : { bottom: 16, left: 16 }
        }
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-orange-600 dark:text-orange-400">
            Étape {stepIndex + 1} sur {steps.length}
          </span>
          <button
            type="button"
            onClick={close}
            className="p-1 rounded text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-white/10"
            aria-label="Fermer le guide"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <h3 className="mt-1.5 text-[15px] font-semibold text-gray-900 dark:text-white">
          {step.title}
        </h3>
        <p className="mt-1 text-sm leading-relaxed text-gray-600 dark:text-gray-300">
          {step.description}
        </p>

        <div className="mt-4 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={close}
            className="text-xs font-medium text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
          >
            Passer le guide
          </button>
          <div className="flex items-center gap-2">
            {stepIndex > 0 && (
              <button
                type="button"
                onClick={() => setStepIndex((i) => Math.max(0, i - 1))}
                className="h-8 px-3 rounded-lg border border-gray-200 dark:border-white/15 text-xs font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-white/5"
              >
                Précédent
              </button>
            )}
            <button
              type="button"
              onClick={() => (isLast ? close() : setStepIndex((i) => i + 1))}
              className="h-8 px-3.5 rounded-lg bg-orange-600 text-xs font-semibold text-white hover:bg-orange-500 shadow-sm shadow-orange-600/30"
            >
              {isLast ? "Terminer" : "Suivant"}
            </button>
          </div>
        </div>

        {/* Progression : un point par étape */}
        <div className="mt-3 flex items-center justify-center gap-1.5">
          {steps.map((s, i) => (
            <span
              key={s.targetId}
              className={`h-1.5 rounded-full transition-all ${
                i === stepIndex
                  ? "w-4 bg-orange-500"
                  : "w-1.5 bg-gray-300 dark:bg-white/20"
              }`}
            />
          ))}
        </div>
      </div>
    </div>,
    document.body,
  )
}
