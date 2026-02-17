"use client"

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, ReferenceLine } from 'recharts'

interface Product {
  name: string
  prix: number
  prixMoyenMarche: number
  ecartPourcentage: number
  competitif: boolean
  hasCompetitor: boolean
  categorie: string
}

interface Retailer {
  site: string
  prixMoyen: number
  agressivite: number
  frequencePromotions: number
  nombreProduits: number
  produitsComparables: number
  categorieStats: Array<{
    categorie: string
    prixMoyen: number
    agressivite: number
    nombreProduits: number
  }>
}

interface VisualizationsProps {
  produits: Product[]
  detailleurs: Retailer[]
}

const formatPrice = (v: number) =>
  v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k$` : `${v.toFixed(0)}$`

function ProductGapTooltip({ active, payload }: any) {
  if (!active || !payload?.[0]) return null
  const d = payload[0].payload
  return (
    <div className="bg-[#0F0F12] border border-[#2B2B30] rounded-xl px-4 py-3 shadow-2xl max-w-xs">
      <p className="text-sm font-medium text-white mb-2 leading-snug">{d.fullName}</p>
      <div className="space-y-1 text-xs">
        <div className="flex justify-between gap-6">
          <span className="text-gray-400">Votre prix</span>
          <span className="font-semibold text-white">{d.prix.toLocaleString('fr-CA')}$</span>
        </div>
        <div className="flex justify-between gap-6">
          <span className="text-gray-400">Moy. concurrents</span>
          <span className="font-semibold text-white">{d.marche.toLocaleString('fr-CA')}$</span>
        </div>
        <div className="h-px bg-[#2B2B30] my-1" />
        <div className="flex justify-between gap-6">
          <span className="text-gray-400">Écart</span>
          <span className={`font-bold ${d.ecart < 0 ? 'text-emerald-400' : d.ecart > 0 ? 'text-red-400' : 'text-gray-400'}`}>
            {d.ecart > 0 ? '+' : ''}{d.ecart}%
            {d.ecart < -2 && ' — moins cher'}
            {d.ecart > 2 && ' — plus cher'}
          </span>
        </div>
      </div>
    </div>
  )
}

function RetailerGapTooltip({ active, payload }: any) {
  if (!active || !payload?.[0]) return null
  const d = payload[0].payload
  return (
    <div className="bg-[#0F0F12] border border-[#2B2B30] rounded-xl px-4 py-3 shadow-2xl">
      <p className="text-sm font-medium text-white mb-1">{d.fullSite}</p>
      <div className="space-y-1 text-xs">
        <div className="flex justify-between gap-6">
          <span className="text-gray-400">Agressivité</span>
          <span className={`font-bold ${d.agressivite > 0 ? 'text-emerald-400' : d.agressivite < 0 ? 'text-red-400' : 'text-gray-400'}`}>
            {d.agressivite > 0 ? '+' : ''}{d.agressivite.toFixed(1)}%
          </span>
        </div>
        <div className="flex justify-between gap-6">
          <span className="text-gray-400">Prix moyen</span>
          <span className="font-semibold text-white">{formatPrice(d.prixMoyen)}</span>
        </div>
        <div className="flex justify-between gap-6">
          <span className="text-gray-400">Produits</span>
          <span className="text-white">{d.nombreProduits}</span>
        </div>
      </div>
    </div>
  )
}

export default function Visualizations({ produits, detailleurs }: VisualizationsProps) {
  // --- Chart 1: Product price gap (diverging horizontal bars) ---
  const productGapData = produits
    .filter(p => p.hasCompetitor && p.prix > 0 && Math.abs(p.ecartPourcentage) > 0.1)
    .sort((a, b) => a.ecartPourcentage - b.ecartPourcentage)
    .slice(0, 18)
    .map(p => ({
      name: p.name.length > 32 ? p.name.substring(0, 32) + '...' : p.name,
      fullName: p.name,
      ecart: Number(p.ecartPourcentage.toFixed(1)),
      prix: p.prix,
      marche: p.prixMoyenMarche,
      fill: p.ecartPourcentage < -2 ? '#34D399' : p.ecartPourcentage > 2 ? '#F87171' : '#6B7280',
    }))

  // --- Chart 2: Retailer competitiveness (horizontal bars) ---
  const retailerData = detailleurs
    .filter(d => d.prixMoyen > 0)
    .sort((a, b) => b.agressivite - a.agressivite)
    .map(d => ({
      site: d.site.length > 25 ? d.site.substring(0, 25) + '...' : d.site,
      fullSite: d.site,
      agressivite: Number(d.agressivite.toFixed(1)),
      prixMoyen: d.prixMoyen,
      nombreProduits: d.nombreProduits,
      fill: d.agressivite > 2 ? '#34D399' : d.agressivite < -2 ? '#F87171' : '#6B7280',
    }))

  const hasProductData = productGapData.length > 0
  const hasRetailerData = retailerData.length > 0

  return (
    <div className="space-y-6">
      {/* Chart 1: Écart de prix par produit */}
      <div className="bg-white dark:bg-[#0F0F12] rounded-lg border border-gray-200 dark:border-[#1F1F23] p-6">
        <div className="mb-5">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
            Écart de prix par produit
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-500 mt-1">
            Votre prix comparé à la moyenne des concurrents
          </p>
        </div>

        {hasProductData ? (
          <>
            <ResponsiveContainer width="100%" height={Math.max(280, productGapData.length * 36)}>
              <BarChart
                data={productGapData}
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
                  dataKey="name"
                  stroke="transparent"
                  tick={{ fill: '#9CA3AF', fontSize: 11 }}
                  width={200}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  content={<ProductGapTooltip />}
                  cursor={{ fill: 'rgba(255,255,255,0.03)' }}
                />
                <ReferenceLine x={0} stroke="#374151" strokeWidth={1} />
                <Bar dataKey="ecart" radius={[4, 4, 4, 4]} barSize={18}>
                  {productGapData.map((entry, index) => (
                    <Cell key={index} fill={entry.fill} fillOpacity={0.85} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>

            {/* Legend */}
            <div className="mt-4 flex items-center justify-center gap-6 text-xs text-gray-500 dark:text-gray-500">
              <div className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-sm bg-emerald-400" />
                <span>Moins cher</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-sm bg-red-400" />
                <span>Plus cher</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-sm bg-gray-500" />
                <span>Similaire</span>
              </div>
            </div>
          </>
        ) : (
          <div className="text-center py-12 text-gray-500 dark:text-gray-500 text-sm">
            Aucune comparaison de prix disponible
          </div>
        )}
      </div>

      {/* Chart 2: Compétitivité par détaillant */}
      <div className="bg-white dark:bg-[#0F0F12] rounded-lg border border-gray-200 dark:border-[#1F1F23] p-6">
        <div className="mb-5">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
            Compétitivité par détaillant
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-500 mt-1">
            Écart moyen par rapport à votre prix de référence
          </p>
        </div>

        {hasRetailerData ? (
          <>
            <ResponsiveContainer width="100%" height={Math.max(200, retailerData.length * 52)}>
              <BarChart
                data={retailerData}
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
                  content={<RetailerGapTooltip />}
                  cursor={{ fill: 'rgba(255,255,255,0.03)' }}
                />
                <ReferenceLine x={0} stroke="#374151" strokeWidth={1} />
                <Bar dataKey="agressivite" radius={[4, 4, 4, 4]} barSize={24}>
                  {retailerData.map((entry, index) => (
                    <Cell key={index} fill={entry.fill} fillOpacity={0.85} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>

            <div className="mt-4 flex items-center justify-center gap-6 text-xs text-gray-500 dark:text-gray-500">
              <div className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-sm bg-emerald-400" />
                <span>Moins cher que vous</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-sm bg-red-400" />
                <span>Plus cher que vous</span>
              </div>
            </div>
          </>
        ) : (
          <div className="text-center py-12 text-gray-500 dark:text-gray-500 text-sm">
            Aucune donnée de détaillant disponible
          </div>
        )}
      </div>
    </div>
  )
}
