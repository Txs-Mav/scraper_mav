"use client"

import { useState } from "react"
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

function ecartColor(ecart: number): string {
  if (ecart > 0.5) return 'text-[#A32D2D] dark:text-[#A32D2D]'
  if (ecart < -0.5) return 'text-[#3B6D11] dark:text-[#3B6D11]'
  return 'text-gray-500 dark:text-[#B0B0B0]'
}

export default function RetailerAnalysis({ detailleurs }: RetailerAnalysisProps) {
  const { t } = useLanguage()
  const [expandedRetailer, setExpandedRetailer] = useState<string | null>(null)

  if (detailleurs.length === 0) {
    return (
      <div className="bg-white dark:bg-[#1c1e20] rounded-2xl border border-gray-200 dark:border-[#2a2c2e] p-6">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
          {t("ap.retailerComparison")}
        </h3>
        <div className="text-center py-8 text-gray-500 dark:text-[#B0B0B0]">
          {t("ap.noRetailerData")}
        </div>
      </div>
    )
  }

  const refSite = detailleurs.find(d => d.isReference)
  const refEcart = refSite?.agressivite ?? 0
  // Nombre de produits matchés uniques = nombre de groupes où le site de
  // référence apparaît avec au moins un concurrent. Aligné avec le compteur
  // affiché dans la carte « Positionnement de Prix ».
  const totalCompared = refSite?.produitsComparables
    ?? Math.max(0, ...detailleurs.map(d => d.produitsComparables))

  // Données triées et normalisées pour la liste de barres divergentes
  const rankedRetailers = detailleurs
    .filter(d => d.produitsComparables > 0)
    .map(d => ({
      site: d.site,
      ecart: d.agressivite,
      produitsComparables: d.produitsComparables,
      isReference: d.isReference,
    }))
    .sort((a, b) => a.ecart - b.ecart)

  const maxAbs = Math.max(
    1,
    ...rankedRetailers.map(d => Math.abs(d.ecart))
  )

  return (
    <div className="bg-white dark:bg-[#1c1e20] rounded-2xl border border-gray-200 dark:border-[#2a2c2e] p-6">
      <div className="mb-5">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
          {t("ap.retailerComparison")}
        </h3>
        <p className="text-sm text-gray-500 dark:text-[#B0B0B0] mt-1">
          {t("ap.retailerDescNew")}
        </p>
      </div>

      {refSite && (
        <div className="mb-5 p-3.5 bg-gray-50 dark:bg-[#242628] rounded-xl border border-gray-200 dark:border-[#2a2c2e]">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs text-gray-500 uppercase tracking-wider font-medium">{t("ap.yourSitePosition")}</div>
              <div className={`text-xl font-bold mt-0.5 tabular-nums ${ecartColor(refEcart)}`}>
                {refEcart > 0 ? '+' : ''}{refEcart.toFixed(1)}%
              </div>
            </div>
            <div className="text-right text-xs text-gray-500">
              <div>{detailleurs.filter(d => d.produitsComparables > 0).length} {t("ap.retailersCompared")}</div>
              <div>{totalCompared} {t("ap.comparedCount")}</div>
            </div>
          </div>
          <p className="text-xs text-gray-500 mt-2">
            {refEcart > 0.5
              ? t("ap.retailerMoreExpensive").replace("{0}", refEcart.toFixed(1))
              : refEcart < -0.5
              ? t("ap.retailerCheaper").replace("{0}", Math.abs(refEcart).toFixed(1))
              : t("ap.retailerAligned")}
          </p>
        </div>
      )}

      {rankedRetailers.length > 0 && (
        <div>
          {/* En-tête de la liste avec axe */}
          <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-[#B0B0B0]/70 px-2 mb-2">
            <span className="flex items-center gap-1.5">
              <TrendingDown className="h-3 w-3" />
              {t("ap.cheaperLegendNew")}
            </span>
            <span className="text-gray-500">{t("ap.avgGapVsOthers")}</span>
            <span className="flex items-center gap-1.5">
              {t("ap.expensiveLegendNew")}
              <TrendingUp className="h-3 w-3" />
            </span>
          </div>

          {/* Liste de barres divergentes */}
          <ul className="divide-y divide-gray-100 dark:divide-[#2a2c2e] rounded-xl border border-gray-200 dark:border-[#2a2c2e] overflow-hidden bg-gray-50/40 dark:bg-[#161819]/40">
            {rankedRetailers.map((d, i) => {
              const ratio = Math.abs(d.ecart) / maxAbs
              const widthPct = Math.max(2, ratio * 50)
              const isCheap = d.ecart < -0.5
              const isExpensive = d.ecart > 0.5
              const sign = d.ecart > 0 ? '+' : ''

              const barColor = isCheap
                ? 'bg-[#3B6D11]/80'
                : isExpensive
                ? 'bg-[#A32D2D]/80'
                : 'bg-gray-400/60 dark:bg-gray-500/60'

              const labelColor = isCheap
                ? 'text-[#3B6D11]'
                : isExpensive
                ? 'text-[#A32D2D]'
                : 'text-gray-500 dark:text-[#B0B0B0]'

              return (
                <li
                  key={d.site}
                  className={`group grid grid-cols-[2rem_minmax(0,1fr)_minmax(0,2fr)_4.5rem] items-center gap-2 sm:gap-3 px-3 py-2.5 text-sm transition-colors hover:bg-white dark:hover:bg-[#1f2123] ${
                    d.isReference ? 'bg-[#EAF3DE]/50 dark:bg-[#3B6D11]/10' : ''
                  }`}
                >
                  {/* Rang */}
                  <span className="text-[11px] font-semibold tabular-nums text-gray-400 dark:text-[#B0B0B0]/60">
                    #{i + 1}
                  </span>

                  {/* Nom du site */}
                  <span className="flex items-center gap-1.5 min-w-0">
                    {d.isReference && (
                      <Award className="h-3.5 w-3.5 text-[#3B6D11] flex-shrink-0" />
                    )}
                    <span className="truncate font-medium text-gray-900 dark:text-white">
                      {d.site}
                    </span>
                    {d.isReference && (
                      <span className="hidden sm:inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-semibold leading-none bg-[#EAF3DE] text-[#27500A] dark:bg-[#3B6D11]/30 dark:text-[#3B6D11] flex-shrink-0">
                        {t("ap.yourSite")}
                      </span>
                    )}
                  </span>

                  {/* Barre divergente (50% gauche / 50% droite) */}
                  <div className="relative h-4 w-full">
                    {/* Axe central */}
                    <div className="absolute inset-y-0 left-1/2 w-px bg-gray-300 dark:bg-[#3a3c3e]" />
                    {/* Barre */}
                    {isCheap && (
                      <div
                        className={`absolute top-0 bottom-0 right-1/2 rounded-l-md ${barColor}`}
                        style={{ width: `${widthPct}%` }}
                      />
                    )}
                    {isExpensive && (
                      <div
                        className={`absolute top-0 bottom-0 left-1/2 rounded-r-md ${barColor}`}
                        style={{ width: `${widthPct}%` }}
                      />
                    )}
                    {!isCheap && !isExpensive && (
                      <div
                        className={`absolute top-1/2 -translate-y-1/2 left-1/2 -translate-x-1/2 h-2 w-2 rounded-full ${barColor}`}
                      />
                    )}
                  </div>

                  {/* % */}
                  <span className={`text-right tabular-nums font-bold text-sm ${labelColor}`}>
                    {sign}{d.ecart.toFixed(1)}%
                  </span>
                </li>
              )
            })}
          </ul>

          {/* Échelle */}
          <div className="mt-2 flex items-center justify-between text-[10px] tabular-nums text-gray-400 dark:text-[#B0B0B0]/60 px-2">
            <span>−{maxAbs.toFixed(1)}%</span>
            <span>0%</span>
            <span>+{maxAbs.toFixed(1)}%</span>
          </div>
        </div>
      )}

      {/* Tableau détaillé */}
      <div className="mt-6 overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-200 dark:border-[#2a2c2e]">
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
            {detailleurs.map((det, index) => {
              const ecart = det.agressivite
              return (
                <tr key={`row-${index}`} className="group">
                  <td colSpan={5} className="p-0">
                    <div
                      className="flex items-center cursor-pointer hover:hover:bg-gray-50 dark:hover:bg-[#2a2c2e] transition-colors rounded-lg"
                      onClick={() => setExpandedRetailer(
                        expandedRetailer === det.site ? null : det.site
                      )}
                    >
                      <div className="flex-1 py-3 px-4 text-sm text-gray-900 dark:text-white flex items-center gap-2 min-w-0">
                        {det.isReference && <Award className="h-3.5 w-3.5 text-[#3B6D11] flex-shrink-0" />}
                        <span className="truncate">{det.site}</span>
                        {det.isReference && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold leading-none bg-[#EAF3DE] text-[#27500A] dark:bg-[#3B6D11]/30 dark:text-[#3B6D11] flex-shrink-0">
                            {t("ap.yourSite")}
                          </span>
                        )}
                      </div>
                      <div className="py-3 px-4 text-sm text-right w-28">
                        {det.produitsComparables > 0 ? (
                          ecart > 0.5 ? (
                            <span className="text-[#A32D2D] dark:text-[#A32D2D] inline-flex items-center justify-end gap-1 font-semibold tabular-nums">
                              <TrendingUp className="h-3.5 w-3.5" />
                              +{ecart.toFixed(1)}%
                            </span>
                          ) : ecart < -0.5 ? (
                            <span className="text-[#3B6D11] inline-flex items-center justify-end gap-1 font-semibold tabular-nums">
                              <TrendingDown className="h-3.5 w-3.5" />
                              {ecart.toFixed(1)}%
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

                    {expandedRetailer === det.site && det.categorieStats && det.categorieStats.length > 0 && (
                      <div className="bg-gray-50 dark:bg-[#242628] mx-2 mb-2 rounded-lg px-4 py-3">
                        <div className="text-[11px] font-semibold text-gray-500 mb-2 uppercase tracking-wider">
                          {t("ap.avgGapCategory")}
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                          {det.categorieStats.map((cs, ci) => {
                            const isCheap = cs.agressivite < -2
                            const isExpensive = cs.agressivite > 2
                            return (
                              <div
                                key={ci}
                                className={`rounded-lg p-2.5 border ${
                                  isCheap
                                    ? 'bg-[#EAF3DE]/80 dark:bg-[#3B6D11]/10 border-[#3B6D11]/20 dark:border-[#3B6D11]/30'
                                    : isExpensive
                                    ? 'bg-[#FCEBEB]/80 dark:bg-[#A32D2D]/15 border-[#A32D2D]/20 dark:border-[#A32D2D]/30'
                                    : 'bg-white dark:bg-[#1c1e20] border-gray-200 dark:border-[#2a2c2e]'
                                }`}
                              >
                                <div className="flex items-center justify-between">
                                  <span className="text-xs font-medium text-gray-900 dark:text-white">
                                    {categoryLabels[cs.categorie] || cs.categorie}
                                  </span>
                                  <span className={`text-xs font-bold tabular-nums ${
                                    isCheap ? 'text-[#3B6D11] dark:text-[#3B6D11]'
                                      : isExpensive ? 'text-[#A32D2D] dark:text-[#A32D2D]'
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

                    <div className="h-px bg-gray-100 dark:bg-[#2a2c2e] mx-4" />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
