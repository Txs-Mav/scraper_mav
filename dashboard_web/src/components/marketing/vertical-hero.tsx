"use client"

import Link from "next/link"
import { ArrowRight, CheckCircle2 } from "lucide-react"

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
    <section className="relative overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,rgba(16,185,129,0.08),transparent_50%)] pointer-events-none" />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-20 pb-16 grid lg:grid-cols-2 gap-12 items-center">
        <div>
          <span className="inline-flex items-center px-3 py-1.5 rounded-full bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 text-xs font-semibold uppercase tracking-wider border border-emerald-100 dark:border-emerald-900/40">
            {eyebrow}
          </span>
          <h1 className="mt-5 text-4xl md:text-6xl font-black tracking-tight leading-[1.05] text-gray-900 dark:text-white">
            {title}
          </h1>
          <p className="mt-5 text-lg md:text-xl text-gray-600 dark:text-gray-300 leading-relaxed max-w-xl">
            {subtitle}
          </p>
          {benefits && benefits.length > 0 && (
            <ul className="mt-6 space-y-2.5">
              {benefits.map((b, i) => (
                <li key={i} className="flex items-start gap-2.5 text-sm text-gray-700 dark:text-gray-200">
                  <CheckCircle2 className="h-4 w-4 text-emerald-500 mt-0.5 flex-shrink-0" />
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-8 flex flex-col sm:flex-row gap-3">
            <Link
              href={ctaPrimary.href}
              className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-emerald-600 text-white font-semibold hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-600/25"
            >
              {ctaPrimary.label}
              <ArrowRight className="h-4 w-4" />
            </Link>
            {ctaSecondary && (
              <Link
                href={ctaSecondary.href}
                className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-white dark:bg-white/[0.05] text-gray-900 dark:text-white font-semibold border border-gray-200 dark:border-white/10 hover:border-gray-300 dark:hover:border-white/20 transition-all"
              >
                {ctaSecondary.label}
              </Link>
            )}
          </div>
          <div className="mt-10 grid grid-cols-3 gap-3">
            {metrics.map((m, i) => (
              <div key={i} className="rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#1a1c1e] p-3">
                <div className="text-lg font-black text-gray-900 dark:text-white">{m.value}</div>
                <div className="text-[10px] uppercase tracking-wider text-gray-500 dark:text-gray-400 mt-0.5">{m.label}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="relative">{visual}</div>
      </div>
    </section>
  )
}
