"use client"

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell } from 'recharts'
import { Award, TrendingDown, TrendingUp } from "lucide-react"

interface Retailer {
  site: string
  prixMoyen: number
  agressivite: number
  frequencePromotions: number
  nombreProduits: number
}

interface RetailerAnalysisProps {
  detailleurs: Retailer[]
}

export default function RetailerAnalysis({ detailleurs }: RetailerAnalysisProps) {
  if (detailleurs.length === 0) {
    return (
      <div className="bg-white dark:bg-[#0F0F12] rounded-lg border border-gray-200 dark:border-[#1F1F23] p-6">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
          Analyse par Détaillant
        </h3>
        <div className="text-center py-8 text-gray-500 dark:text-gray-400">
          Aucune donnée de détaillant disponible
        </div>
      </div>
    )
  }

  // Identifier le leader prix (le moins cher)
  const leader = detailleurs[0]

  // Préparer les données pour le graphique
  const chartData = detailleurs.map(d => ({
    site: d.site.length > 30 ? d.site.substring(0, 30) + '...' : d.site,
    'Prix moyen': d.prixMoyen,
    'Agressivité': d.agressivite,
    'Fréquence promotions': d.frequencePromotions
  }))

  // Couleurs pour les barres (vert pour moins cher, rouge pour plus cher)
  const getBarColor = (index: number) => {
    if (index === 0) return '#10B981' // Vert pour le leader
    if (index === detailleurs.length - 1) return '#EF4444' // Rouge pour le plus cher
    return '#3B82F6' // Bleu pour les autres
  }

  return (
    <div className="bg-white dark:bg-[#0F0F12] rounded-lg border border-gray-200 dark:border-[#1F1F23] p-6">
      <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
        Analyse par Détaillant
      </h3>

      {/* Leader prix */}
      {leader && (
        <div className="mb-4 p-3 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-900">
          <div className="flex items-center gap-2">
            <Award className="h-5 w-5 text-green-600 dark:text-green-400" />
            <span className="text-sm font-semibold text-green-800 dark:text-green-300">
              Leader prix du marché: {leader.site}
            </span>
          </div>
          <div className="text-xs text-green-700 dark:text-green-400 mt-1">
            Prix moyen: {leader.prixMoyen.toFixed(2)}$ | {leader.nombreProduits} produits
          </div>
        </div>
      )}

      {/* Graphique en barres */}
      <ResponsiveContainer width="100%" height={400}>
        <BarChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
          <XAxis 
            dataKey="site" 
            stroke="#9CA3AF"
            tick={{ fill: '#9CA3AF', fontSize: 12 }}
            angle={-45}
            textAnchor="end"
            height={100}
          />
          <YAxis 
            stroke="#9CA3AF"
            tick={{ fill: '#9CA3AF' }}
          />
          <Tooltip 
            contentStyle={{ 
              backgroundColor: '#1F2937', 
              border: '1px solid #374151',
              borderRadius: '8px'
            }}
          />
          <Legend />
          <Bar dataKey="Prix moyen" fill="#3B82F6">
            {chartData.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={getBarColor(index)} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      {/* Tableau détaillé */}
      <div className="mt-6 overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-200 dark:border-[#1F1F23]">
              <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700 dark:text-gray-300">
                Détaillant
              </th>
              <th className="text-right py-3 px-4 text-sm font-semibold text-gray-700 dark:text-gray-300">
                Prix moyen
              </th>
              <th className="text-right py-3 px-4 text-sm font-semibold text-gray-700 dark:text-gray-300">
                Agressivité
              </th>
              <th className="text-right py-3 px-4 text-sm font-semibold text-gray-700 dark:text-gray-300">
                Promotions
              </th>
              <th className="text-right py-3 px-4 text-sm font-semibold text-gray-700 dark:text-gray-300">
                Produits
              </th>
            </tr>
          </thead>
          <tbody>
            {detailleurs.map((det, index) => (
              <tr
                key={index}
                className="border-b border-gray-100 dark:border-[#1F1F23] hover:bg-gray-50 dark:hover:bg-[#1F1F23]"
              >
                <td className="py-3 px-4 text-sm text-gray-900 dark:text-white">
                  {index === 0 && <Award className="inline h-4 w-4 text-green-500 mr-2" />}
                  {det.site}
                </td>
                <td className="py-3 px-4 text-sm text-right font-semibold text-gray-900 dark:text-white">
                  {det.prixMoyen.toFixed(2)}$
                </td>
                <td className="py-3 px-4 text-sm text-right">
                  {det.agressivite > 0 ? (
                    <span className="text-green-600 dark:text-green-400 flex items-center justify-end gap-1">
                      <TrendingDown className="h-4 w-4" />
                      {det.agressivite.toFixed(1)}%
                    </span>
                  ) : (
                    <span className="text-red-600 dark:text-red-400 flex items-center justify-end gap-1">
                      <TrendingUp className="h-4 w-4" />
                      {Math.abs(det.agressivite).toFixed(1)}%
                    </span>
                  )}
                </td>
                <td className="py-3 px-4 text-sm text-right text-gray-600 dark:text-gray-400">
                  {det.frequencePromotions.toFixed(1)}%
                </td>
                <td className="py-3 px-4 text-sm text-right text-gray-600 dark:text-gray-400">
                  {det.nombreProduits}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}


