"use client"

import { useState } from "react"
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, ReferenceLine } from 'recharts'
import { ChevronDown, ChevronUp, TrendingDown, TrendingUp, Minus, Layers } from "lucide-react"

interface CategoryStats {
  categorie: string
  nombreProduits: number
  prixMoyenReference: number
  prixMoyenConcurrents: number
  ecartMoyenPourcentage: number
  competitifs: number
  nonCompetitifs: number
  detailParDetaillant: Array<{
    site: string
    prixMoyen: number
    ecartPourcentage: number
    nombreProduits: number
  }>
}

interface CategoryAnalysisProps {
  categories: CategoryStats[]
}

const categoryLabels: Record<string, string> = {
  moto: "Moto",
  motoneige: "Motoneige",
  motocross: "Motocross",
  scooter: "Scooter",
  quad: "Quad",
  "side-by-side": "Side-by-Side",
  vtt: "VTT",
  autre: "Autre",
}

function DetailTooltip({ active, payload }: any) {
  if (!active || !payload?.[0]) return null
  const d = payload[0].payload
  return (
    <div className="bg-[#0F0F12] border border-[#2B2B30] rounded-xl px-4 py-3 shadow-2xl">
      <p className="text-sm font-medium text-white mb-1.5">{d.fullSite}</p>
      <div className="space-y-1 text-xs">
        <div className="flex justify-between gap-6">
          <span className="text-gray-400">Prix moyen</span>
          <span className="font-semibold text-white">
            {d.prixMoyen.toLocaleString('fr-CA', { minimumFractionDigits: 2 })}$
          </span>
        </div>
        <div className="flex justify-between gap-6">
          <span className="text-gray-400">Écart vs vous</span>
          <span className={`font-bold ${d.ecart < -2 ? 'text-emerald-400' : d.ecart > 2 ? 'text-red-400' : 'text-gray-400'}`}>
            {d.ecart > 0 ? '+' : ''}{d.ecart.toFixed(1)}%
          </span>
        </div>
        <div className="flex justify-between gap-6">
          <span className="text-gray-400">Produits</span>
          <span className="text-white">{d.nombreProduits}</span>
        </div>
      </div>
    </div>
  )
}

export default function CategoryAnalysis({ categories }: CategoryAnalysisProps) {
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null)

  if (categories.length === 0) {
    return (
      <div className="bg-white dark:bg-[#0F0F12] rounded-lg border border-gray-200 dark:border-[#1F1F23] p-6">
        <div className="flex items-center gap-2 mb-4">
          <Layers className="h-5 w-5 text-violet-500" />
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
            Analyse par Catégorie
          </h3>
        </div>
        <div className="text-center py-8 text-gray-500 dark:text-gray-400">
          Aucune donnée de catégorie disponible
        </div>
      </div>
    )
  }

  const getEcartColor = (ecart: number) => {
    if (ecart < -2) return 'text-emerald-600 dark:text-emerald-400'
    if (ecart > 2) return 'text-red-600 dark:text-red-400'
    return 'text-gray-500'
  }

  const getEcartIcon = (ecart: number) => {
    if (ecart < -2) return <TrendingDown className="h-4 w-4 text-emerald-500" />
    if (ecart > 2) return <TrendingUp className="h-4 w-4 text-red-500" />
    return <Minus className="h-4 w-4 text-gray-400" />
  }

  return (
    <div className="bg-white dark:bg-[#0F0F12] rounded-lg border border-gray-200 dark:border-[#1F1F23] p-6">
      <div className="flex items-center gap-2 mb-1">
        <Layers className="h-5 w-5 text-violet-500" />
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
          Analyse par Catégorie
        </h3>
      </div>
      <p className="text-sm text-gray-500 dark:text-gray-500 mb-5">
        Positionnement de vos prix par catégorie. Cliquez pour voir le détail par concurrent.
      </p>

      {/* Category cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-4">
        {categories.map(cat => {
          const isExpanded = expandedCategory === cat.categorie
          const ecart = cat.ecartMoyenPourcentage
          const isGood = ecart < -2
          const isBad = ecart > 2

          return (
            <button
              key={cat.categorie}
              onClick={() => setExpandedCategory(isExpanded ? null : cat.categorie)}
              className={`text-left rounded-xl p-4 border transition-all hover:shadow-sm ${
                isExpanded
                  ? 'ring-2 ring-violet-500/40 border-violet-300 dark:border-violet-800'
                  : isGood
                  ? 'border-emerald-200/70 dark:border-emerald-900/40 bg-emerald-50/50 dark:bg-emerald-900/10'
                  : isBad
                  ? 'border-red-200/70 dark:border-red-900/40 bg-red-50/50 dark:bg-red-900/10'
                  : 'border-gray-200 dark:border-[#2B2B30] bg-gray-50/50 dark:bg-[#1A1A1E]'
              }`}
            >
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-sm font-semibold text-gray-900 dark:text-white">
                  {categoryLabels[cat.categorie] || cat.categorie}
                </span>
                {getEcartIcon(ecart)}
              </div>

              <div className={`text-2xl font-bold tabular-nums ${getEcartColor(ecart)}`}>
                {ecart >= 0 ? '+' : ''}{ecart.toFixed(1)}%
              </div>

              <div className="flex items-center justify-between mt-2">
                <span className="text-[11px] text-gray-500">{cat.nombreProduits} produit(s)</span>
                <div className="flex items-center gap-0.5">
                  {isExpanded
                    ? <ChevronUp className="h-3.5 w-3.5 text-gray-400" />
                    : <ChevronDown className="h-3.5 w-3.5 text-gray-400" />
                  }
                </div>
              </div>
            </button>
          )
        })}
      </div>

      {/* Expanded detail */}
      {expandedCategory && (() => {
        const cat = categories.find(c => c.categorie === expandedCategory)
        if (!cat) return null

        const chartData = cat.detailParDetaillant
          .sort((a, b) => a.ecartPourcentage - b.ecartPourcentage)
          .map(d => ({
            site: d.site.length > 22 ? d.site.substring(0, 22) + '...' : d.site,
            fullSite: d.site,
            ecart: Number(d.ecartPourcentage.toFixed(1)),
            prixMoyen: d.prixMoyen,
            nombreProduits: d.nombreProduits,
            fill: d.ecartPourcentage < -2 ? '#34D399' : d.ecartPourcentage > 2 ? '#F87171' : '#6B7280',
          }))

        return (
          <div className="border border-gray-200 dark:border-[#2B2B30] rounded-xl overflow-hidden">
            {/* Header */}
            <div className="bg-gray-50 dark:bg-[#141417] px-5 py-3 border-b border-gray-200 dark:border-[#2B2B30]">
              <h4 className="text-sm font-semibold text-gray-900 dark:text-white">
                {categoryLabels[cat.categorie] || cat.categorie}
              </h4>
              <div className="flex gap-4 mt-1.5 text-xs text-gray-500">
                <span>Votre prix moy: <strong className="text-blue-600 dark:text-blue-400">{cat.prixMoyenReference > 0 ? `${cat.prixMoyenReference.toLocaleString('fr-CA', { minimumFractionDigits: 2 })}$` : 'N/A'}</strong></span>
                <span>Concurrents moy: <strong className="text-gray-900 dark:text-white">{cat.prixMoyenConcurrents > 0 ? `${cat.prixMoyenConcurrents.toLocaleString('fr-CA', { minimumFractionDigits: 2 })}$` : 'N/A'}</strong></span>
              </div>
            </div>

            {/* Chart */}
            {chartData.length > 0 && (
              <div className="px-5 py-4">
                <ResponsiveContainer width="100%" height={Math.max(160, chartData.length * 44)}>
                  <BarChart
                    data={chartData}
                    layout="vertical"
                    margin={{ top: 0, right: 30, bottom: 0, left: 8 }}
                  >
                    <XAxis
                      type="number"
                      stroke="transparent"
                      tick={{ fill: '#6B7280', fontSize: 11 }}
                      tickFormatter={(v: number) => `${v > 0 ? '+' : ''}${v}%`}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      type="category"
                      dataKey="site"
                      stroke="transparent"
                      tick={{ fill: '#9CA3AF', fontSize: 11 }}
                      width={160}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip
                      content={<DetailTooltip />}
                      cursor={{ fill: 'rgba(255,255,255,0.03)' }}
                    />
                    <ReferenceLine x={0} stroke="#374151" strokeWidth={1} />
                    <Bar dataKey="ecart" radius={[4, 4, 4, 4]} barSize={18}>
                      {chartData.map((entry, index) => (
                        <Cell key={index} fill={entry.fill} fillOpacity={0.85} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>

                <div className="mt-2 flex items-center justify-center gap-5 text-[11px] text-gray-500">
                  <div className="flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-sm bg-emerald-400" />
                    <span>Moins cher que vous</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-sm bg-red-400" />
                    <span>Plus cher que vous</span>
                  </div>
                </div>
              </div>
            )}

            {/* Compact table */}
            {cat.detailParDetaillant.length > 0 && (
              <div className="border-t border-gray-200 dark:border-[#2B2B30]">
                <table className="w-full">
                  <thead>
                    <tr className="bg-gray-50/50 dark:bg-[#141417]">
                      <th className="text-left py-2 px-5 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                        Concurrent
                      </th>
                      <th className="text-right py-2 px-4 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                        Prix moy.
                      </th>
                      <th className="text-right py-2 px-4 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                        Écart
                      </th>
                      <th className="text-right py-2 px-5 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                        Prod.
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {cat.detailParDetaillant.map((det, i) => (
                      <tr
                        key={i}
                        className="border-t border-gray-100 dark:border-[#1F1F23] hover:bg-gray-50/50 dark:hover:bg-[#1A1A1E]"
                      >
                        <td className="py-2 px-5 text-sm text-gray-900 dark:text-white">
                          {det.site}
                        </td>
                        <td className="py-2 px-4 text-sm text-right font-medium text-gray-900 dark:text-white tabular-nums">
                          {det.prixMoyen.toLocaleString('fr-CA', { minimumFractionDigits: 2 })}$
                        </td>
                        <td className={`py-2 px-4 text-sm text-right font-semibold tabular-nums ${
                          det.ecartPourcentage < -2 ? 'text-emerald-600 dark:text-emerald-400'
                            : det.ecartPourcentage > 2 ? 'text-red-600 dark:text-red-400'
                            : 'text-gray-500'
                        }`}>
                          {det.ecartPourcentage >= 0 ? '+' : ''}
                          {det.ecartPourcentage.toFixed(1)}%
                        </td>
                        <td className="py-2 px-5 text-sm text-right text-gray-500 tabular-nums">
                          {det.nombreProduits}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )
      })()}
    </div>
  )
}
