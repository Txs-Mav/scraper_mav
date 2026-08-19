// Usage : npx tsx scripts/test-detect-changes.ts  (issue Txs-Mav/scraper_mav#1)
import {
  detectChanges,
  computeUnitKey,
  type Product,
  type AlertConfig,
} from '../src/lib/alerts/detect-changes'

const config: AlertConfig = {
  watch_price_increase: true,
  watch_price_decrease: true,
  watch_new_products: true,
  watch_removed_products: true,
  watch_stock_changes: true,
  min_price_change_pct: 1,
  min_price_change_abs: 2,
}

const himUnit = (inv: string, prix: number) => ({
  unit_key: inv, inventaire: inv, prix,
  sourceUrl: `https://www.motosillimitees.com/fr/i/royal-enfield-himalayan-450-2025-a-vendre-${inv}/`,
})

const himalayan = (units: Array<{ unit_key?: string; inventaire?: string; prix?: number; sourceUrl?: string }>): Product => ({
  name: 'Royal Enfield Himalayan 450 2025',
  prix: Math.min(...units.map(u => u.prix!)),
  quantity: units.length,
  multi_unit: units.length >= 2,
  units: units.length >= 2 ? units : undefined,
  ...(units.length === 1 ? { inventaire: units[0].inventaire, sourceUrl: units[0].sourceUrl, prix: units[0].prix! } : {}),
  sourceUrl: units[0].sourceUrl,
} as Product)

const site = 'motosillimitees.com'
let failures = 0
function check(label: string, cond: boolean, extra?: any) {
  if (cond) console.log(`  ✅ ${label}`)
  else { failures++; console.error(`  ❌ ${label}`, extra ?? '') }
}

// ── T1 : scrape partiel (unité manquante 1 scrape) → AUCUNE alerte ──
{
  const full = [himalayan([himUnit('84565', 8495), himUnit('ins52093', 6995)])]
  const partial = [himalayan([himUnit('84565', 8495)])]
  const changes = detectChanges(full, partial, config, site, full)
  check('T1 scrape partiel → 0 alerte (le ping-pong est mort)', changes.length === 0, changes)
}

// ── T2 : retour de l'unité au scrape suivant → AUCUNE alerte ──
{
  const full = [himalayan([himUnit('84565', 8495), himUnit('ins52093', 6995)])]
  const partial = [himalayan([himUnit('84565', 8495)])]
  const changes = detectChanges(partial, full, config, site, full)
  check('T2 réapparition après scrape partiel → 0 alerte', changes.length === 0, changes)
}

// ── T3 : vrai changement de prix sur UNE unité ──
{
  const prev = [himalayan([himUnit('84565', 8495), himUnit('ins52093', 6995)])]
  const curr = [himalayan([himUnit('84565', 7995), himUnit('ins52093', 6995)])]
  const changes = detectChanges(prev, curr, config, site, prev)
  check('T3 baisse réelle → exactement 1 alerte', changes.length === 1, changes)
  check('T3 type price_decrease', changes[0]?.change_type === 'price_decrease')
  check('T3 details.unit_key = 84565', changes[0]?.details.unit_key === '84565')
  check('T3 details.unit_position présent', changes[0]?.details.unit_position === '1/2')
  check('T3 URL de la bonne unité', String(changes[0]?.details.sourceUrl).includes('84565'))
}

// ── T4 : absence confirmée sur 2 scrapes → removed ──
{
  const prevPrev = [himalayan([himUnit('84565', 8495), himUnit('ins52093', 6995)])]
  const prev = [himalayan([himUnit('84565', 8495)])]
  const curr = [himalayan([himUnit('84565', 8495)])]
  const changes = detectChanges(prev, curr, config, site, prevPrev)
  check('T4 absence 2 scrapes → 1 removed', changes.length === 1 && changes[0].change_type === 'removed_product', changes)
  check('T4 removed sur la bonne unité', changes[0]?.details.unit_key === 'ins52093')
}

// ── T5 : nouvelle unité d'un modèle existant → new_product ──
{
  const past = [himalayan([himUnit('84565', 8495), himUnit('ins52093', 6995)])]
  const curr = [himalayan([himUnit('84565', 8495), himUnit('ins52093', 6995), himUnit('ins99999', 7499)])]
  const changes = detectChanges(past, curr, config, site, past)
  check('T5 nouvelle unité → 1 new_product', changes.length === 1 && changes[0].change_type === 'new_product', changes)
  check('T5 new sur ins99999', changes[0]?.details.unit_key === 'ins99999')
}

// ── T6 : transition pré-migration (fusionné → units[]) → silence ──
{
  const merged: Product = {
    name: 'Royal Enfield Himalayan 450 2025', prix: 6995, inventaire: '84565',
    sourceUrl: 'https://www.motosillimitees.com/fr/i/royal-enfield-himalayan-450-2025-a-vendre-84565/',
    quantity: 2, groupedUrls: ['a', 'b'],
  } as Product
  const curr = [himalayan([himUnit('84565', 8495), himUnit('ins52093', 6995)])]
  const changes = detectChanges([merged], curr, config, site, [merged])
  check('T6 transition fusionné→units[] → 0 alerte (pas de fausse hausse min→réel)', changes.length === 0, changes)
}

// ── T7 : marketplace sans units[], URL repostée → prix par nom, pas de retrait ──
{
  const prev: Product[] = [{ name: 'Kawasaki Ninja 400 2020', prix: 5000, sourceUrl: 'https://www.kijiji.ca/v-moto/annonce-abc' } as Product]
  const curr: Product[] = [{ name: 'Kawasaki Ninja 400 2020', prix: 4500, sourceUrl: 'https://www.kijiji.ca/v-moto/annonce-def' } as Product]
  const changes = detectChanges(prev, curr, config, site, prev)
  check('T7 repli nom → 1 price_decrease uniquement', changes.length === 1 && changes[0].change_type === 'price_decrease', changes)
}

// ── T8 : cas Polaris réel (mono-unité, 15 671 → 15 171) ──
{
  const p = (prix: number): Product => ({
    name: 'Polaris Sportsman 6x6 570 2026', prix,
    sourceUrl: 'https://www.motosillimitees.com/fr/neuf/vtt/inventaire/polaris-sportsman-6x6-570-2026-a-vendre-ins52104/',
  } as Product)
  const changes = detectChanges([p(15671)], [p(15171)], config, site, [p(15671)])
  check('T8 Polaris → 1 price_decrease', changes.length === 1 && changes[0].change_type === 'price_decrease', changes)
  check('T8 pourcentage -3.19', changes[0]?.percentage_change === -3.19)
  check('T8 unit_key ins52104', changes[0]?.details.unit_key === 'ins52104')
}

// ── T9 : parité de cascade avec Python (mêmes entrées → mêmes clés) ──
{
  check('T9 vin prioritaire', computeUnitKey({ vin: 'SN1TLC9B5SC629648', inventaire: '86987' }) === 'SN1TLC9B5SC629648')
  check('T9 inventaire', computeUnitKey({ inventaire: '86987', sourceUrl: 'https://x/a-vendre-99999/' }) === '86987')
  check('T9 ID URL', computeUnitKey({ sourceUrl: 'https://x/triumph-scrambler-1200-x-2026-a-vendre-inst4/' }) === 'inst4')
  check('T9 md5 12 car.', computeUnitKey({ name: 'Yamaha MT-07 2026', couleur: 'Bleu' }).length === 12)
}

// ── T10 : unité vendue d'un modèle multi → removed malgré les jumelles ──
{
  const prevPrev = [himalayan([himUnit('84565', 8495), himUnit('ins52093', 6995)])]
  const sold = [himalayan([himUnit('84565', 8495)])]
  const changes = detectChanges(sold, sold, config, site, prevPrev)
  check('T10 vente confirmée → removed malgré jumelle présente', changes.length === 1 && changes[0].change_type === 'removed_product', changes)
}

console.log(failures === 0 ? '\nTOUS LES TESTS PASSENT' : `\n${failures} ÉCHEC(S)`)
process.exit(failures === 0 ? 0 : 1)
