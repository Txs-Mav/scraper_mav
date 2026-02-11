"use client"

import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, Cell } from 'recharts'

interface Product {
  name: string
  prix: number
  prixMoyenMarche: number
  ecartPourcentage: number
  competitif: boolean
  categorie: string
}

interface Retailer {
  site: string
  prixMoyen: number
  agressivite: number
  frequencePromotions: number
  nombreProduits: number
}

interface VisualizationsProps {
  produits: Product[]
  detailleurs: Retailer[]
}

// Limite pour filtrer les prix aberrants (IDs ou valeurs incorrectes)
const MAX_REASONABLE_PRICE = 500000 // 500k$ max raisonnable pour un véhicule

export default function Visualizations({ produits, detailleurs }: VisualizationsProps) {
  // Préparer les données pour le scatter plot (prix référence vs marché)
  // Filtrer les prix aberrants (> 500k$ sont probablement des IDs ou erreurs)
  const scatterData = produits
    .filter(p => p.prix > 0 && p.prix < MAX_REASONABLE_PRICE && p.prixMoyenMarche > 0 && p.prixMoyenMarche < MAX_REASONABLE_PRICE)
    .map(p => ({
      x: p.prix,
      y: p.prixMoyenMarche,
      name: p.name.substring(0, 30),
      ecart: p.ecartPourcentage
    }))

  // Préparer les données pour le graphique d'écart moyen
  // Filtrer les détaillants avec prix moyen raisonnable
  const ecartData = detailleurs
    .filter(d => d.prixMoyen > 0 && d.prixMoyen < MAX_REASONABLE_PRICE)
    .map(d => ({
    site: d.site.length > 20 ? d.site.substring(0, 20) + '...' : d.site,
    ecartMoyen: d.agressivite, // Utiliser l'agressivité comme proxy de l'écart
    couleur: d.agressivite > 0 ? '#10B981' : d.agressivite < 0 ? '#EF4444' : '#6B7280'
  }))

  return (
    <div className="space-y-6">
      {/* Graphique de dispersion */}
      <div className="bg-white dark:bg-[#0F0F12] rounded-lg border border-gray-200 dark:border-[#1F1F23] p-6">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
          Graphique de Dispersion - Prix Référence vs Marché
        </h3>
        <ResponsiveContainer width="100%" height={400}>
          <ScatterChart data={scatterData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
            <XAxis 
              type="number" 
              dataKey="x" 
              name="Prix référence"
              stroke="#9CA3AF"
              tick={{ fill: '#9CA3AF' }}
              label={{ value: 'Prix référence ($)', position: 'insideBottom', offset: -5 }}
            />
            <YAxis 
              type="number" 
              dataKey="y" 
              name="Prix moyen marché"
              stroke="#9CA3AF"
              tick={{ fill: '#9CA3AF' }}
              label={{ value: 'Prix moyen marché ($)', angle: -90, position: 'insideLeft' }}
            />
            <Tooltip 
              cursor={{ strokeDasharray: '3 3' }}
              contentStyle={{ 
                backgroundColor: '#1F2937', 
                border: '1px solid #374151',
                borderRadius: '8px'
              }}
            />
            <Scatter name="Produits" data={scatterData} fill="#3B82F6">
              {scatterData.map((entry, index) => (
                <Cell 
                  key={`cell-${index}`} 
                  fill={entry.ecart < 0 ? '#10B981' : entry.ecart > 0 ? '#EF4444' : '#6B7280'} 
                />
              ))}
            </Scatter>
          </ScatterChart>
        </ResponsiveContainer>
        <div className="mt-4 flex items-center gap-4 text-xs text-gray-600 dark:text-gray-400">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-green-500 rounded"></div>
            <span>Moins cher que le marché</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-red-500 rounded"></div>
            <span>Plus cher que le marché</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-gray-500 rounded"></div>
            <span>Égal au marché</span>
          </div>
        </div>
      </div>

      {/* Diagramme des écarts moyens */}
      <div className="bg-white dark:bg-[#0F0F12] rounded-lg border border-gray-200 dark:border-[#1F1F23] p-6">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
          Écart Moyen des Prix par Détaillant
        </h3>
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
          Comparaison avec la moyenne du marché (rouge = plus cher, vert = moins cher, gris = égal)
        </p>
        <ResponsiveContainer width="100%" height={400}>
          <BarChart data={ecartData}>
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
              label={{ value: 'Écart moyen (%)', angle: -90, position: 'insideLeft' }}
            />
            <Tooltip 
              contentStyle={{ 
                backgroundColor: '#1F2937', 
                border: '1px solid #374151',
                borderRadius: '8px'
              }}
            />
            <Bar dataKey="ecartMoyen" name="Écart moyen">
              {ecartData.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.couleur} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        <div className="mt-4 flex items-center gap-4 text-xs text-gray-600 dark:text-gray-400">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-red-500 rounded"></div>
            <span>Plus cher que le marché</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-green-500 rounded"></div>
            <span>Moins cher que le marché</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-gray-500 rounded"></div>
            <span>Égal au marché</span>
          </div>
        </div>
      </div>
    </div>
  )
}


