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
    { label: t("ap.used"), value: stats.usage, pct: stats.total > 0 ? (stats.usage / stats.total) * 100 : 0 },
    { label: t("ap.inventory"), value: stats.inventaire, pct: stats.total > 0 ? (stats.inventaire / stats.total) * 100 : 0 },
    { label: t("ap.catalogue"), value: stats.catalogue, pct: stats.total > 0 ? (stats.catalogue / stats.total) * 100 : 0 },
  ]

  // Bars look like Image 2 — colonnes Source | Clicks | %
  return (
    <SectionCard
      title={t("ap.factors")}
      meta={
        <span className="text-xs text-[var(--color-text-secondary)] tabular-nums">
          <span className="font-semibold text-[var(--color-text-primary)]">{stats.total.toLocaleString(locale === 'en' ? 'en-CA' : 'fr-CA')}</span>{" "}
          {t("ap.total").toLowerCase()}
        </span>
      }
      bodyClassName="px-0 py-0"
    >
      <div className="px-5 py-2 grid grid-cols-[1fr_5rem_4rem] gap-3 items-center text-[11px] font-medium uppercase tracking-wider text-[var(--color-text-secondary)] border-b border-[var(--color-border-tertiary)]/40">
        <span>{t("ap.factorSource")}</span>
        <span className="text-right">{t("ap.factorCount")}</span>
        <span className="text-right">%</span>
      </div>
      <ul>
        {rows.map((row, i) => (
          <li
            key={i}
            className="grid grid-cols-[1fr_5rem_4rem] gap-3 items-center px-5 py-2.5 text-sm border-b last:border-b-0 border-[var(--color-border-tertiary)]/30"
          >
            <span className="text-[var(--color-text-primary)] truncate">{row.label}</span>
            <span className="text-right tabular-nums font-semibold text-[var(--color-text-primary)]">
              {row.value.toLocaleString(locale === 'en' ? 'en-CA' : 'fr-CA')}
            </span>
            <span className="text-right tabular-nums text-[var(--color-text-secondary)]">
              {row.pct.toFixed(1)}%
            </span>
          </li>
        ))}
      </ul>
    </SectionCard>
  )
}
