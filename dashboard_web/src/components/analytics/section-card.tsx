"use client"

import { useState, type ReactNode } from "react"
import { ChevronDown } from "lucide-react"
import { useLanguage } from "@/contexts/language-context"

/**
 * Surface unifiée pour les blocs Analytics. S'aligne sur l'esthétique
 * neutre de la page Surveillance : pas de bloc coloré, pas d'icône
 * décorative dans le header, fond translucide avec backdrop-blur,
 * bordure très discrète.
 *
 * Header cliquable optionnel : permet de « décortiquer » l'information
 * en révélant un panneau supplémentaire (ex. détails, drill-down).
 */
interface SectionCardProps {
  title: string
  subtitle?: string
  actions?: ReactNode
  meta?: ReactNode
  children: ReactNode
  details?: ReactNode
  defaultExpanded?: boolean
  className?: string
  bodyClassName?: string
  detailsLabel?: string
}

export default function SectionCard({
  title,
  subtitle,
  actions,
  meta,
  children,
  details,
  defaultExpanded = false,
  className = "",
  bodyClassName = "",
  detailsLabel,
}: SectionCardProps) {
  const { t } = useLanguage()
  const [expanded, setExpanded] = useState(defaultExpanded)
  const hasDetails = !!details

  return (
    <section
      className={`rounded-2xl border border-[var(--color-border-tertiary)]/55 bg-[var(--color-background-primary)]/35 backdrop-blur-md shadow-[0_16px_50px_-40px_rgba(15,23,42,0.55)] ${className}`}
    >
      <header className="flex items-start justify-between gap-3 px-5 pt-4 pb-3 border-b border-[var(--color-border-tertiary)]/40">
        <div className="min-w-0 flex-1">
          <h3 className="text-[15px] font-semibold text-[var(--color-text-primary)] tracking-tight leading-tight">
            {title}
          </h3>
          {subtitle && (
            <p className="text-xs text-[var(--color-text-secondary)] mt-0.5 leading-snug">
              {subtitle}
            </p>
          )}
          {meta && <div className="mt-1.5">{meta}</div>}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {actions}
          {hasDetails && (
            <button
              type="button"
              onClick={() => setExpanded(v => !v)}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-background-hover)] transition"
              aria-expanded={expanded}
            >
              <span>{detailsLabel || (expanded ? t("ap.detailsCollapse") : t("ap.detailsToggle"))}</span>
              <ChevronDown
                className={`h-3 w-3 transition-transform ${expanded ? "rotate-180" : ""}`}
                strokeWidth={2}
              />
            </button>
          )}
        </div>
      </header>

      <div className={`px-5 py-4 ${bodyClassName}`}>{children}</div>

      {hasDetails && expanded && (
        <div className="border-t border-[var(--color-border-tertiary)]/40 px-5 py-4 bg-[var(--color-background-secondary)]/30">
          {details}
        </div>
      )}
    </section>
  )
}
