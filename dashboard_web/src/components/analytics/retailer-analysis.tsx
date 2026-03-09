"use client"

import { useState } from "react"
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, ReferenceLine } from 'recharts'
import { Award, TrendingDown, TrendingUp, ChevronDown, ChevronUp } from "lucide-react"
import { useLanguage } from "@/contexts/language-context"

interface Retailer {
  site: string
  prixMoyen: number
  agressivite: number
  frequencePromotions: number
  nombreProduits: number
  produitsComparables: number
  isReference?: boolean
  categorieStats: Array<{
    categorie: string
    prixMoyen: number
    agressivite: number
    nombreProduits: number
  }>
}

interface RetailerAnalysisProps {
  detailleurs: Retailer[]
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

const fmtPrice = (v: number) =>
  v.toLocaleString('fr-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '$'

function EcartTooltip({ active, payload }: any) {
  const { t } = useLanguage()
  if (!active || !payload?.[0]) return null
  const d = payload[0].payload
  const sign = d.ecart > 0 ? '+' : ''
  return (
    <div className="bg-[#0F0F12] border border-[#2B2B30] rounded-xl px-4 py-3 shadow-2xl max-w-xs">
      <p className="text-sm font-medium text-white mb-2">{d.fullSite}</p>
      <div className="space-y-1.5 text-xs">
        <div className="flex justify-between gap-6">
          <span className="text-gray-400">{t("ap.avgGap")}</span>
          <span className={`font-bold ${d.ecart > 0.5 ? 'text-emerald-400' : d.ecart < -0.5 ? 'text-red-400' : 'text-gray-400'}`}>
            {sign}{d.ecart.toFixed(1)}%
          </span>
        </div>
        <div className="flex justify-between gap-6">
          <span className="text-gray-400">{t("ap.comparedCount")}</span>
          <span className="text-white">{d.produitsComparables}</span>
        </div>
        <div className="h-px bg-[#2B2B30]" />
        <div className="text-gray-500 leading-relaxed">
          {d.ecart > 0.5
            ? t("ap.lessExpensive").replace("{0}", d.ecart.toFixed(1))
            : d.ecart < -0.5
            ? t("ap.moreExpensive").replace("{0}", Math.abs(d.ecart).toFixed(1))
            : t("ap.aligned")}
        </div>
      </div>
    </div>
  )
}

export default function RetailerAnalysis({ detailleurs }: RetailerAnalysisProps) {
  const { t } = useLanguage()
  const [expandedRetailer, setExpandedRetailer] = useState<string | null>(null)

  if (detailleurs.length === 0) {
    return (
      <div className="bg-white/70 dark:bg-white/[0.025] backdrop-blur-sm rounded-lg border border-gray-200/60 dark:border-white/[0.06] p-6">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
          {t("ap.retailerComparison")}
        </h3>
        <div className="text-center py-8 text-gray-500 dark:text-gray-400">
          {t("ap.noRetailerData")}
        </div>
      </div>
    )
  }

  const competitorsOnly = detailleurs.filter(d => !d.isReference && d.produitsComparables > 0)
  const ecartMoyenGeneral = competitorsOnly.length > 0
    ? competitorsOnly.reduce((s, d) => s + d.agressivite, 0) / competitorsOnly.length
    : 0

  // Données du graphique — écart moyen par produit comparable
  const chartData = detailleurs
    .filter(d => d.produitsComparables > 0)
    .map(d => ({
      site: d.site.length > 25 ? d.site.substring(0, 25) + '...' : d.site,
      fullSite: d.site,
      ecart: Number(d.agressivite.toFixed(1)),
      produitsComparables: d.produitsComparables,
      fill: d.agressivite > 2 ? '#34D399' : d.agressivite < -2 ? '#F87171' : '#6B7280',
    }))

  return (
    <div className="bg-white/70 dark:bg-white/[0.025] backdrop-blur-sm rounded-lg border border-gray-200/60 dark:border-white/[0.06] p-6">
      <div className="mb-5">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
          {t("ap.retailerComparison")}
        </h3>
        <p className="text-sm text-gray-500 dark:text-gray-500 mt-1">
          {t("ap.retailerDesc")}
        </p>
      </div>

      {/* Stat résumé */}
      {competitorsOnly.length > 0 && (
        <div className="mb-5 p-3.5 bg-gray-50 dark:bg-[#141417] rounded-xl border border-gray-200 dark:border-[#2B2B30]">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs text-gray-500 uppercase tracking-wider font-medium">{t("ap.generalAvgGap")}</div>
              <div className={`text-xl font-bold mt-0.5 tabular-nums ${ecartMoyenGeneral > 0.5 ? 'text-emerald-600 dark:text-emerald-400' : ecartMoyenGeneral < -0.5 ? 'text-red-600 dark:text-red-400' : 'text-gray-600 dark:text-gray-400'}`}>
                {ecartMoyenGeneral > 0 ? '+' : ''}{ecartMoyenGeneral.toFixed(1)}%
              </div>
            </div>
            <div className="text-right text-xs text-gray-500">
              <div>{competitorsOnly.length} {t("ap.comparisons")}</div>
              <div>{competitorsOnly.reduce((s, d) => s + d.produitsComparables, 0)} {t("ap.comparedCount")}</div>
            </div>
          </div>
          <p className="text-xs text-gray-500 mt-2">
            {ecartMoyenGeneral < -0.5
              ? t("ap.moreExpensive").replace("{0}", Math.abs(ecartMoyenGeneral).toFixed(1))
              : ecartMoyenGeneral > 0.5
              ? t("ap.lessExpensive").replace("{0}", ecartMoyenGeneral.toFixed(1))
              : t("ap.aligned")}
          </p>
        </div>
      )}

      {/* Graphique : écart moyen par détaillant (barres divergentes) */}
      {chartData.length > 0 && (
        <>
          <ResponsiveContainer width="100%" height={Math.max(180, chartData.length * 48)}>
            <BarChart
              data={chartData}
              layout="vertical"
              margin={{ top: 0, right: 40, bottom: 0, left: 8 }}
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
                tick={{ fill: '#9CA3AF', fontSize: 12 }}
                width={180}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                content={<EcartTooltip />}
                cursor={{ fill: 'rgba(255,255,255,0.03)' }}
              />
              <ReferenceLine x={0} stroke="#374151" strokeWidth={1} />
              <Bar dataKey="ecart" radius={[4, 4, 4, 4]} barSize={22}>
                {chartData.map((entry, index) => (
                  <Cell key={index} fill={entry.fill} fillOpacity={0.85} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>

          <div className="mt-3 flex items-center justify-center gap-6 text-xs text-gray-500">
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-sm bg-emerald-400" />
              <span>{t("ap.cheaperLegend")}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-sm bg-red-400" />
              <span>{t("ap.expensiveLegend")}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-sm bg-gray-500" />
              <span>{t("ap.similarLegend")}</span>
            </div>
          </div>
        </>
      )}

      {/* Tableau détaillé */}
      <div className="mt-6 overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-200 dark:border-[#1F1F23]">
              <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                {t("ap.retailer")}
              </th>
              <th className="text-right py-3 px-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                {t("ap.avgGapShort")}
              </th>
              <th className="text-right py-3 px-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                {t("ap.comparedCountShort")}
              </th>
              <th className="text-right py-3 px-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                {t("ap.totalProducts")}
              </th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {detailleurs.map((det, index) => (
              <tr key={`row-${index}`} className="group">
                <td colSpan={5} className="p-0">
                  {/* Main row */}
                  <div
                    className="flex items-center cursor-pointer hover:bg-gray-50 dark:hover:bg-[#1A1A1E] transition-colors rounded-lg"
                    onClick={() => setExpandedRetailer(
                      expandedRetailer === det.site ? null : det.site
                    )}
                  >
                    <div className="flex-1 py-3 px-4 text-sm text-gray-900 dark:text-white flex items-center gap-2 min-w-0">
                      {det.isReference && <Award className="h-3.5 w-3.5 text-blue-500 flex-shrink-0" />}
                      <span className="truncate">{det.site}</span>
                      {det.isReference && (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold leading-none bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 flex-shrink-0">
                          {t("ap.yourSite")}
                        </span>
                      )}
                    </div>
                    <div className="py-3 px-4 text-sm text-right w-28">
                      {det.produitsComparables > 0 ? (
                        det.agressivite > 0.5 ? (
                          <span className="text-emerald-600 dark:text-emerald-400 inline-flex items-center justify-end gap-1 font-semibold tabular-nums">
                            <TrendingDown className="h-3.5 w-3.5" />
                            +{det.agressivite.toFixed(1)}%
                          </span>
                        ) : det.agressivite < -0.5 ? (
                          <span className="text-red-600 dark:text-red-400 inline-flex items-center justify-end gap-1 font-semibold tabular-nums">
                            <TrendingUp className="h-3.5 w-3.5" />
                            {det.agressivite.toFixed(1)}%
                          </span>
                        ) : (
                          <span className="text-gray-500 tabular-nums">0.0%</span>
                        )
                      ) : (
                        <span className="text-gray-400 text-xs">—</span>
                      )}
                    </div>
                    <div className="py-3 px-4 text-sm text-right text-gray-500 tabular-nums w-28">
                      {det.produitsComparables > 0 ? det.produitsComparables : '—'}
                    </div>
                    <div className="py-3 px-4 text-sm text-right text-gray-500 tabular-nums w-24">
                      {det.nombreProduits}
                    </div>
                    <div className="py-3 px-2 w-10 flex justify-center">
                      {det.categorieStats && det.categorieStats.length > 0 ? (
                        expandedRetailer === det.site
                          ? <ChevronUp className="h-4 w-4 text-gray-400" />
                          : <ChevronDown className="h-4 w-4 text-gray-400" />
                      ) : null}
                    </div>
                  </div>

                  {/* Expanded: breakdown par catégorie */}
                  {expandedRetailer === det.site && det.categorieStats && det.categorieStats.length > 0 && (
                    <div className="bg-gray-50/50 dark:bg-[#141417] mx-2 mb-2 rounded-lg px-4 py-3">
                      <div className="text-[11px] font-semibold text-gray-500 mb-2 uppercase tracking-wider">
                        {t("ap.avgGapCategory")}
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                        {det.categorieStats.map((cs, ci) => {
                          const isGood = cs.agressivite > 2
                          const isBad = cs.agressivite < -2
                          return (
                            <div
                              key={ci}
                              className={`rounded-lg p-2.5 border ${
                                isGood
                                  ? 'bg-emerald-50/80 dark:bg-emerald-900/10 border-emerald-200/60 dark:border-emerald-900/30'
                                  : isBad
                                  ? 'bg-red-50/80 dark:bg-red-900/10 border-red-200/60 dark:border-red-900/30'
                                  : 'bg-white dark:bg-white/[0.025] border-gray-200/60 dark:border-[#2B2B30]'
                              }`}
                            >
                              <div className="flex items-center justify-between">
                                <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
                                  {categoryLabels[cs.categorie] || cs.categorie}
                                </span>
                                <span className={`text-xs font-bold tabular-nums ${
                                  isGood ? 'text-emerald-600 dark:text-emerald-400'
                                    : isBad ? 'text-red-600 dark:text-red-400'
                                    : 'text-gray-500'
                                }`}>
                                  {cs.agressivite > 0 ? '+' : ''}{cs.agressivite.toFixed(1)}%
                                </span>
                              </div>
                              <div className="text-[10px] text-gray-400 mt-0.5">
                                {cs.nombreProduits} produit(s) — {fmtPrice(cs.prixMoyen)} moy.
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}

                  <div className="h-px bg-gray-100 dark:bg-[#1F1F23] mx-4" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
