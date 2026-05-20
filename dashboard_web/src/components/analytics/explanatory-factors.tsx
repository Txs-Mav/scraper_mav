"use client"

import { useLanguage } from "@/contexts/language-context"
import SectionCard from "./section-card"

interface Product {
  name: string
  prix: number
  prixMoyenMarche: number
  ecartPourcentage: number
  competitif: boolean
  hasCompetitor: boolean
  categorie: string
  disponibilite?: string
  sourceUrl?: string
  sourceSite?: string
  etat?: string
  inventaire?: string
}

interface ExplanatoryFactorsProps {
  produits: Product[]
}

export default function ExplanatoryFactors({ produits }: ExplanatoryFactorsProps) {
  const { t, locale } = useLanguage()
  const lc = locale === 'en' ? 'en-CA' : 'fr-CA'

  const stats = {
    usage: produits.filter(p => {
      const etat = (p.etat || '').toLowerCase()
      return etat === 'usagé' || etat === 'usage' || etat === 'used'
    }).length,
    inventaire: produits.filter(p => {
      const inv = (p.inventaire || '').toLowerCase()
      const etat = (p.etat || '').toLowerCase()
      const isUsed = etat === 'usagé' || etat === 'usage' || etat === 'used'
      return !isUsed && (inv === 'inventaire' || inv === 'inventory' || inv === 'en_stock' || p.disponibilite === 'en_stock')
    }).length,
    catalogue: produits.filter(p => {
      const inv = (p.inventaire || '').toLowerCase()
      const etat = (p.etat || '').toLowerCase()
      const isUsed = etat === 'usagé' || etat === 'usage' || etat === 'used'
      const isInventaire = inv === 'inventaire' || inv === 'inventory' || inv === 'en_stock' || p.disponibilite === 'en_stock'
      return !isUsed && !isInventaire
    }).length,
    total: produits.length,
  }

  const rows: Array<{ label: string; value: number; pct: number }> = [
    { label: t("ap.inventory"), value: stats.inventaire, pct: stats.total > 0 ? (stats.inventaire / stats.total) * 100 : 0 },
    { label: t("ap.catalogue"), value: stats.catalogue, pct: stats.total > 0 ? (stats.catalogue / stats.total) * 100 : 0 },
    { label: t("ap.used"), value: stats.usage, pct: stats.total > 0 ? (stats.usage / stats.total) * 100 : 0 },
  ].sort((a, b) => b.value - a.value)

  // Magnitude relative pour les barres : on prend le max parmi les lignes
  // pour que la barre la plus longue remplisse l'espace dispo.
  const maxValue = Math.max(1, ...rows.map(r => r.value))

  return (
    <SectionCard
      title={t("ap.factors")}
      meta={
        <div className="flex items-baseline gap-2 mt-1">
          <span className="text-3xl font-extrabold tabular-nums leading-none text-[var(--color-text-primary)] tracking-tight">
            {stats.total.toLocaleString(lc)}
          </span>
          <span className="text-xs text-[var(--color-text-secondary)] uppercase tracking-wider font-medium">
            {t("ap.total").toLowerCase()}
          </span>
        </div>
      }
      bodyClassName="px-0 py-0"
    >
      <div className="px-5 py-2 grid grid-cols-[1fr_minmax(0,8rem)_4rem_4rem] gap-3 items-center text-[11px] font-medium uppercase tracking-wider text-[var(--color-text-secondary)] border-b border-[var(--color-border-tertiary)]/40">
        <span>{t("ap.factorSource")}</span>
        <span className="hidden md:block" />
        <span className="text-right">{t("ap.factorCount")}</span>
        <span className="text-right">%</span>
      </div>
      <ul>
        {rows.map((row, i) => {
          const barPct = (row.value / maxValue) * 100
          return (
            <li
              key={i}
              className="grid grid-cols-[1fr_minmax(0,8rem)_4rem_4rem] gap-3 items-center px-5 py-3 text-sm border-b last:border-b-0 border-[var(--color-border-tertiary)]/30 hover:bg-[var(--color-background-hover)]/40 transition-colors"
            >
              <span className="text-[var(--color-text-primary)] font-medium truncate">{row.label}</span>
              <div className="hidden md:block h-2 w-full rounded-full bg-[var(--color-background-secondary)] overflow-hidden">
                <div
                  className="h-full rounded-full bg-[var(--color-text-primary)]/60 transition-all"
                  style={{ width: `${Math.max(2, barPct)}%` }}
                />
              </div>
              <span className="text-right tabular-nums font-bold text-[var(--color-text-primary)]">
                {row.value.toLocaleString(lc)}
              </span>
              <span className="text-right tabular-nums text-[var(--color-text-secondary)] font-medium">
                {row.pct.toFixed(1)}%
              </span>
            </li>
          )
        })}
      </ul>
    </SectionCard>
  )
}
