"use client"

import { LineChart, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { useLanguage } from "@/contexts/language-context"
import SectionCard from "./section-card"

interface PriceEvolutionProps {
  evolutionPrix: Array<{
    date: string
    prixReference: number
    prixMoyenMarche: number
    prixConcurrents: Record<string, number>
  }>
  scrapesParJour: Array<{ date: string; count: number }>
}

function PriceTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-[var(--color-background-primary)] border border-[var(--color-border-secondary)] rounded-xl px-3 py-2 shadow-2xl text-xs">
      <p className="text-[var(--color-text-secondary)] mb-1.5">{label}</p>
      <div className="space-y-1">
        {payload.map((entry: any, i: number) => (
          <div key={i} className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: entry.color }} />
            <span className="text-[var(--color-text-secondary)]">{entry.name}</span>
            <span className="font-semibold text-[var(--color-text-primary)] ml-auto tabular-nums">
              {Number(entry.value).toLocaleString('fr-CA')}$
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

// Vue compacte « histogramme » pour l'activité de scraping :
// barres verticales calibrées sur la valeur max, pas de ligne plate.
function ScrapesBarStrip({
  data,
  locale,
}: {
  data: Array<{ date: string; count: number }>
  locale: string
}) {
  const lc = locale === 'en' ? 'en-CA' : 'fr-CA'
  const max = Math.max(1, ...data.map(d => d.count))
  // Limite l'affichage aux 30 derniers jours pour rester lisible.
  const items = data.slice(-30)

  return (
    <div className="w-full">
      <div
        className={`grid items-end gap-1 h-24 ${
          items.length <= 7 ? 'grid-flow-col' : 'grid-flow-col'
        }`}
        style={{ gridAutoColumns: 'minmax(0, 56px)' }}
      >
        {items.map((d, i) => {
          const heightPct = (d.count / max) * 100
          const isEmpty = d.count === 0
          return (
            <div key={i} className="flex flex-col items-center justify-end h-full group relative">
              <div
                className={`w-full rounded-t-md transition-colors ${
                  isEmpty
                    ? 'bg-[var(--color-background-secondary)]/40'
                    : 'bg-orange-500/75 group-hover:bg-orange-500'
                }`}
                style={{ height: `${Math.max(3, heightPct)}%` }}
              />
              {/* Tooltip CSS pur */}
              <span className="pointer-events-none absolute bottom-full mb-1 hidden group-hover:block bg-[var(--color-background-primary)] border border-[var(--color-border-secondary)] rounded-md px-2 py-1 text-[10px] tabular-nums text-[var(--color-text-primary)] shadow whitespace-nowrap z-10">
                {new Date(d.date).toLocaleDateString(lc, { day: 'numeric', month: 'short' })} ·{' '}
                <span className="font-semibold">{d.count}</span>
              </span>
            </div>
          )
        })}
      </div>
      {/* Échelle inférieure — premier et dernier point uniquement */}
      <div className="flex items-center justify-between text-[10px] tabular-nums text-[var(--color-text-secondary)] mt-1.5">
        <span>{new Date(items[0]?.date ?? Date.now()).toLocaleDateString(lc, { day: 'numeric', month: 'short' })}</span>
        <span>{new Date(items[items.length - 1]?.date ?? Date.now()).toLocaleDateString(lc, { day: 'numeric', month: 'short' })}</span>
      </div>
    </div>
  )
}

export default function PriceEvolutionChart({ evolutionPrix, scrapesParJour }: PriceEvolutionProps) {
  const { t, locale } = useLanguage()
  const lc = locale === 'en' ? 'en-CA' : 'fr-CA'

  // ── Mode « activité de scraping » : aucune évolution prix encore ──
  if (evolutionPrix.length === 0) {
    const hasData = scrapesParJour.length > 0
    const totalScrapes = scrapesParJour.reduce((sum, d) => sum + d.count, 0)
    const peakDay = hasData
      ? scrapesParJour.reduce((max, d) => (d.count > max.count ? d : max), scrapesParJour[0])
      : null
    const avgPerActiveDay = hasData
      ? totalScrapes / Math.max(1, scrapesParJour.filter(d => d.count > 0).length)
      : 0

    return (
      <SectionCard
        title={t("ap.scrapingActivity")}
        subtitle={t("ap.scrapesPerDay")}
      >
        {hasData ? (
          <div className="grid grid-cols-1 md:grid-cols-[auto_1fr] gap-5 items-stretch">
            {/* KPI dominant à gauche */}
            <div className="flex md:flex-col md:justify-between gap-4 md:min-w-[10rem]">
              <div>
                <p className="text-[11px] uppercase tracking-wider text-[var(--color-text-secondary)] font-medium">
                  {t("analytics.scrapes")}
                </p>
                <p className="text-5xl font-extrabold tabular-nums leading-none mt-1.5 text-[var(--color-text-primary)] tracking-tight">
                  {totalScrapes.toLocaleString(lc)}
                </p>
              </div>
              <div className="flex md:flex-col gap-3 md:gap-2">
                {peakDay && peakDay.count > 0 && (
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-[var(--color-text-secondary)] font-medium">
                      {t("ap.peakDay")}
                    </p>
                    <p className="text-base font-bold tabular-nums text-[var(--color-text-primary)] mt-0.5">
                      {peakDay.count}{' '}
                      <span className="text-[11px] font-normal text-[var(--color-text-secondary)]">
                        · {new Date(peakDay.date).toLocaleDateString(lc, { day: 'numeric', month: 'short' })}
                      </span>
                    </p>
                  </div>
                )}
                {avgPerActiveDay > 0 && (
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-[var(--color-text-secondary)] font-medium">
                      Moy. / jour
                    </p>
                    <p className="text-base font-bold tabular-nums text-[var(--color-text-primary)] mt-0.5">
                      {avgPerActiveDay.toFixed(1)}
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Histogramme à droite */}
            <ScrapesBarStrip data={scrapesParJour} locale={locale} />
          </div>
        ) : (
          <p className="text-sm text-[var(--color-text-secondary)] text-center py-6">
            {t("ap.noActivityData")}
          </p>
        )}
      </SectionCard>
    )
  }

  const chartData = evolutionPrix.map(item => ({
    date: new Date(item.date).toLocaleDateString(lc, { month: 'short', day: 'numeric' }),
    [t("ap.yourPrice")]: item.prixReference,
    [t("ap.avgCompetitors")]: item.prixMoyenMarche,
    ...Object.entries(item.prixConcurrents).reduce((acc, [site, prix]) => {
      acc[site.substring(0, 20)] = prix
      return acc
    }, {} as Record<string, number>)
  }))

  // Variation du prix de référence (premier vs dernier point) — KPI dominant
  const firstRef = evolutionPrix.find(p => p.prixReference > 0)?.prixReference ?? 0
  const lastRef = [...evolutionPrix].reverse().find(p => p.prixReference > 0)?.prixReference ?? 0
  const variation = firstRef > 0 ? ((lastRef - firstRef) / firstRef) * 100 : 0
  const variationColor =
    variation > 0.1
      ? 'text-red-600 dark:text-red-400'
      : variation < -0.1
        ? 'text-emerald-600 dark:text-emerald-400'
        : 'text-[var(--color-text-primary)]'

  return (
    <SectionCard
      title={t("ap.priceEvolution")}
      subtitle={t("ap.priceEvolutionDesc")}
      meta={
        lastRef > 0 ? (
          <div className="flex items-baseline gap-3 mt-1">
            <span className="text-3xl font-extrabold tabular-nums leading-none text-[var(--color-text-primary)] tracking-tight">
              {lastRef.toLocaleString(lc, { maximumFractionDigits: 0 })}$
            </span>
            {Math.abs(variation) > 0.1 && (
              <span className={`text-sm font-semibold tabular-nums ${variationColor}`}>
                {variation > 0 ? '+' : ''}{variation.toFixed(1)}%
              </span>
            )}
          </div>
        ) : undefined
      }
    >
      <ResponsiveContainer width="100%" height={260}>
        <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: -16 }}>
          <XAxis
            dataKey="date"
            stroke="transparent"
            tick={{ fill: 'currentColor', fontSize: 11, opacity: 0.6 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            stroke="transparent"
            tick={{ fill: 'currentColor', fontSize: 11, opacity: 0.6 }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip content={<PriceTooltip />} cursor={{ stroke: 'currentColor', strokeOpacity: 0.15 }} />
          <Legend
            wrapperStyle={{ paddingTop: 12, fontSize: 11 }}
            iconType="circle"
            iconSize={6}
          />
          <Line
            type="monotone"
            dataKey={t("ap.yourPrice")}
            stroke="currentColor"
            strokeWidth={2}
            dot={{ r: 2.5, strokeWidth: 0, fill: 'currentColor' }}
            activeDot={{ r: 4, strokeWidth: 0 }}
          />
          <Line
            type="monotone"
            dataKey={t("ap.avgCompetitors")}
            stroke="currentColor"
            strokeOpacity={0.4}
            strokeWidth={1.5}
            strokeDasharray="4 3"
            dot={false}
            activeDot={{ r: 3, strokeWidth: 0 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </SectionCard>
  )
}
