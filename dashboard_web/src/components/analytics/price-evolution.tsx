"use client"

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { TrendingUp, TrendingDown, AlertCircle } from "lucide-react"

interface PriceEvolutionProps {
  evolutionPrix: Array<{
    date: string
    prixReference: number
    prixMoyenMarche: number
    prixConcurrents: Record<string, number>
  }>
  scrapesParJour: Array<{ date: string; count: number }>
}

export default function PriceEvolutionChart({ evolutionPrix, scrapesParJour }: PriceEvolutionProps) {
  // Si pas de données d'évolution, afficher le graphique des scrapes par jour
  if (evolutionPrix.length === 0) {
    return (
      <div className="bg-white dark:bg-[#0F0F12] rounded-lg border border-gray-200 dark:border-[#1F1F23] p-6">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
          Évolution des Prix dans le Temps
        </h3>
        <div className="mb-4">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Graphique du nombre de scrapes effectués par jour
          </p>
        </div>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={scrapesParJour}>
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
            <XAxis 
              dataKey="date" 
              stroke="#9CA3AF"
              tick={{ fill: '#9CA3AF' }}
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
            <Line 
              type="monotone" 
              dataKey="count" 
              stroke="#3B82F6" 
              strokeWidth={2}
              name="Nombre de scrapes"
              dot={{ fill: '#3B82F6', r: 4 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    )
  }

  // Préparer les données pour le graphique
  const chartData = evolutionPrix.map(item => ({
    date: new Date(item.date).toLocaleDateString('fr-FR', { month: 'short', day: 'numeric' }),
    'Prix référence': item.prixReference,
    'Prix moyen marché': item.prixMoyenMarche,
    ...Object.entries(item.prixConcurrents).reduce((acc, [site, prix]) => {
      acc[site.substring(0, 20)] = prix
      return acc
    }, {} as Record<string, number>)
  }))

  // Détecter les baisses soudaines et promotions
  const anomalies: Array<{ date: string; type: string; message: string }> = []
  for (let i = 1; i < evolutionPrix.length; i++) {
    const prev = evolutionPrix[i - 1]
    const curr = evolutionPrix[i]
    const variation = ((curr.prixMoyenMarche - prev.prixMoyenMarche) / prev.prixMoyenMarche) * 100
    
    if (variation < -10) {
      anomalies.push({
        date: curr.date,
        type: 'baisse',
        message: `Baisse soudaine de ${Math.abs(variation).toFixed(1)}%`
      })
    }
  }

  return (
    <div className="bg-white dark:bg-[#0F0F12] rounded-lg border border-gray-200 dark:border-[#1F1F23] p-6">
      <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
        Évolution des Prix dans le Temps
      </h3>

      {/* Détections automatiques */}
      {anomalies.length > 0 && (
        <div className="mb-4 space-y-2">
          {anomalies.map((anomaly, index) => (
            <div
              key={index}
              className="flex items-center gap-2 p-2 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg"
            >
              <AlertCircle className="h-4 w-4 text-yellow-600 dark:text-yellow-400" />
              <span className="text-sm text-yellow-800 dark:text-yellow-300">
                {anomaly.message} le {new Date(anomaly.date).toLocaleDateString('fr-FR')}
              </span>
            </div>
          ))}
        </div>
      )}

      <ResponsiveContainer width="100%" height={400}>
        <LineChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
          <XAxis 
            dataKey="date" 
            stroke="#9CA3AF"
            tick={{ fill: '#9CA3AF' }}
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
          <Line 
            type="monotone" 
            dataKey="Prix référence" 
            stroke="#3B82F6" 
            strokeWidth={2}
            dot={{ fill: '#3B82F6', r: 4 }}
          />
          <Line 
            type="monotone" 
            dataKey="Prix moyen marché" 
            stroke="#10B981" 
            strokeWidth={2}
            strokeDasharray="5 5"
            dot={{ fill: '#10B981', r: 4 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}


