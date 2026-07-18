"use client"

import Link from "next/link"
import { ArrowRight, Check } from "lucide-react"

export type VerticalHeroProps = {
  eyebrow: string
  title: string
  subtitle: string
  metrics: { value: string; label: string }[]
  ctaPrimary: { href: string; label: string }
  ctaSecondary?: { href: string; label: string }
  benefits?: string[]
  visual?: React.ReactNode
}

export default function VerticalHero({
  eyebrow,
  title,
  subtitle,
  metrics,
  ctaPrimary,
  ctaSecondary,
  benefits,
  visual,
}: VerticalHeroProps) {
  return (
    <section className="mx-auto grid max-w-6xl items-center gap-12 px-6 pt-20 pb-16 lg:grid-cols-2">
      <div>
        <span className="inline-flex items-center gap-2 text-[13px] font-medium text-gray-500 dark:text-gray-400">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          {eyebrow}
        </span>

        <h1 className="mt-4 text-4xl font-semibold leading-[1.08] tracking-tight text-gray-900 sm:text-5xl dark:text-white">
          {title}
        </h1>
        <p className="mt-5 max-w-xl text-lg leading-relaxed text-gray-600 dark:text-gray-400">
          {subtitle}
        </p>

        {benefits && benefits.length > 0 && (
          <ul className="mt-6 space-y-2.5">
            {benefits.map((b, i) => (
              <li key={i} className="flex items-start gap-2.5 text-sm text-gray-700 dark:text-gray-300">
                <Check className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-500" />
                <span>{b}</span>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <Link
            href={ctaPrimary.href}
            className="inline-flex items-center justify-center gap-2 rounded-md bg-emerald-600 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-emerald-700"
          >
            {ctaPrimary.label}
            <ArrowRight className="h-4 w-4" />
          </Link>
          {ctaSecondary && (
            <Link
              href={ctaSecondary.href}
              className="inline-flex items-center justify-center rounded-md border border-gray-300 bg-white px-5 py-3 text-sm font-semibold text-gray-900 transition-colors hover:bg-gray-50 dark:border-white/15 dark:bg-transparent dark:text-white dark:hover:bg-white/[0.04]"
            >
              {ctaSecondary.label}
            </Link>
          )}
        </div>

        {metrics.length > 0 && (
          <div className="mt-10 grid grid-cols-3 gap-8 border-t border-gray-200 pt-6 dark:border-white/10">
            {metrics.map((m, i) => (
              <div key={i}>
                <div className="text-2xl font-semibold tracking-tight tabular-nums text-gray-900 dark:text-white">
                  {m.value}
                </div>
                <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">{m.label}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {visual && <div className="relative">{visual}</div>}
    </section>
  )
}
