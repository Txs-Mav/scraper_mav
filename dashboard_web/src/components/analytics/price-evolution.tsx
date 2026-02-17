"use client"

import { AreaChart, Area, LineChart, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { AlertCircle } from "lucide-react"

interface PriceEvolutionProps {
  evolutionPrix: Array<{
    date: string
    prixReference: number
    prixMoyenMarche: number
    prixConcurrents: Record<string, number>
  }>
  scrapesParJour: Array<{ date: string; count: number }>
}

function ScrapeTooltip({ active, payload, label }: any) {
  if (!active || !payload?.[0]) return null
  return (
    <div className="bg-[#0F0F12] border border-[#2B2B30] rounded-xl px-4 py-3 shadow-2xl">
      <p className="text-xs text-gray-400 mb-1">{label}</p>
      <p className="text-sm font-semibold text-white">
        {payload[0].value} scrape{payload[0].value > 1 ? 's' : ''}
      </p>
    </div>
  )
}

function PriceTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-[#0F0F12] border border-[#2B2B30] rounded-xl px-4 py-3 shadow-2xl">
      <p className="text-xs text-gray-400 mb-2">{label}</p>
      <div className="space-y-1">
        {payload.map((entry: any, i: number) => (
          <div key={i} className="flex items-center gap-2 text-xs">
            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color }} />
            <span className="text-gray-400">{entry.name}</span>
            <span className="font-semibold text-white ml-auto tabular-nums">
              {Number(entry.value).toLocaleString('fr-CA')}$
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function PriceEvolutionChart({ evolutionPrix, scrapesParJour }: PriceEvolutionProps) {
  if (evolutionPrix.length === 0) {
    const hasData = scrapesParJour.length > 0

    return (
      <div className="bg-white dark:bg-[#0F0F12] rounded-lg border border-gray-200 dark:border-[#1F1F23] p-6">
        <div className="mb-5">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
            Activité de scraping
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-500 mt-1">
            Nombre de scrapes effectués par jour
          </p>
        </div>

        {hasData ? (
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={scrapesParJour} margin={{ top: 4, right: 8, bottom: 0, left: -16 }}>
              <defs>
                <linearGradient id="scrapeGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#3B82F6" stopOpacity={0.2} />
                  <stop offset="100%" stopColor="#3B82F6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="date"
                stroke="transparent"
                tick={{ fill: '#6B7280', fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v: string) => {
                  const d = new Date(v)
                  return d.toLocaleDateString('fr-CA', { day: 'numeric', month: 'short' })
                }}
              />
              <YAxis
                stroke="transparent"
                tick={{ fill: '#6B7280', fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                allowDecimals={false}
              />
              <Tooltip content={<ScrapeTooltip />} />
              <Area
                type="monotone"
                dataKey="count"
                stroke="#3B82F6"
                strokeWidth={2}
                fill="url(#scrapeGradient)"
                dot={{ fill: '#3B82F6', r: 3, strokeWidth: 0 }}
                activeDot={{ fill: '#3B82F6', r: 5, strokeWidth: 2, stroke: '#0F0F12' }}
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="text-center py-12 text-gray-500 text-sm">
            Aucune donnée d'activité disponible
          </div>
        )}
      </div>
    )
  }

  const chartData = evolutionPrix.map(item => ({
    date: new Date(item.date).toLocaleDateString('fr-FR', { month: 'short', day: 'numeric' }),
    'Votre prix': item.prixReference,
    'Moy. concurrents': item.prixMoyenMarche,
    ...Object.entries(item.prixConcurrents).reduce((acc, [site, prix]) => {
      acc[site.substring(0, 20)] = prix
      return acc
    }, {} as Record<string, number>)
  }))

  const anomalies: Array<{ date: string; message: string }> = []
  for (let i = 1; i < evolutionPrix.length; i++) {
    const prev = evolutionPrix[i - 1]
    const curr = evolutionPrix[i]
    const variation = ((curr.prixMoyenMarche - prev.prixMoyenMarche) / prev.prixMoyenMarche) * 100
    if (variation < -10) {
      anomalies.push({
        date: curr.date,
        message: `Baisse de ${Math.abs(variation).toFixed(1)}% le ${new Date(curr.date).toLocaleDateString('fr-FR')}`
      })
    }
  }

  return (
    <div className="bg-white dark:bg-[#0F0F12] rounded-lg border border-gray-200 dark:border-[#1F1F23] p-6">
      <div className="mb-5">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
          Évolution des prix
        </h3>
        <p className="text-sm text-gray-500 dark:text-gray-500 mt-1">
          Suivi de vos prix et de la moyenne concurrente dans le temps
        </p>
      </div>

      {anomalies.length > 0 && (
        <div className="mb-4 space-y-1.5">
          {anomalies.map((a, i) => (
            <div key={i} className="flex items-center gap-2 p-2 bg-amber-50 dark:bg-amber-900/10 rounded-lg border border-amber-200/60 dark:border-amber-900/30">
              <AlertCircle className="h-3.5 w-3.5 text-amber-500 flex-shrink-0" />
              <span className="text-xs text-amber-800 dark:text-amber-300">{a.message}</span>
            </div>
          ))}
        </div>
      )}

      <ResponsiveContainer width="100%" height={340}>
        <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: -16 }}>
          <XAxis
            dataKey="date"
            stroke="transparent"
            tick={{ fill: '#6B7280', fontSize: 11 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            stroke="transparent"
            tick={{ fill: '#6B7280', fontSize: 11 }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip content={<PriceTooltip />} />
          <Legend
            wrapperStyle={{ paddingTop: 12, fontSize: 12 }}
            iconType="circle"
            iconSize={8}
          />
          <Line
            type="monotone"
            dataKey="Votre prix"
            stroke="#3B82F6"
            strokeWidth={2.5}
            dot={{ fill: '#3B82F6', r: 3, strokeWidth: 0 }}
            activeDot={{ fill: '#3B82F6', r: 5, strokeWidth: 2, stroke: '#0F0F12' }}
          />
          <Line
            type="monotone"
            dataKey="Moy. concurrents"
            stroke="#34D399"
            strokeWidth={2}
            strokeDasharray="6 3"
            dot={{ fill: '#34D399', r: 3, strokeWidth: 0 }}
            activeDot={{ fill: '#34D399', r: 5, strokeWidth: 2, stroke: '#0F0F12' }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
