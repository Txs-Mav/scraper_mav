/**
 * Sélection des concurrents pour une page démo campagne (campaign-demo.ts) :
 * classe tous les sites scrapés par correspondances exactes (buildMatchKey,
 * même logique que computeCampaignData) + unités du référent non
 * compétitives (concurrent moins cher) — les deux critères du registre
 * DEALER_CAMPAIGNS.
 *
 * Usage : npx tsx scripts/select-campaign-competitors.ts <domaine-referent>
 *   ex.   npx tsx scripts/select-campaign-competitors.ts excelmoto.com
 *
 * Lit NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY depuis .env.local.
 */
import { readFileSync } from 'node:fs'
import { buildMatchKey } from '../src/lib/analyze-from-cache'

const REFERENCE = process.argv[2]
if (!REFERENCE) {
  console.error('Usage: npx tsx scripts/select-campaign-competitors.ts <domaine-referent>')
  process.exit(1)
}

const MARKETPLACES = new Set(['lespac.com', 'kijiji.ca', 'autotrader.ca', 'cycletrader.com', 'motorcycledealers.ca'])

const env: Record<string, string> = {}
for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf-8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL
const KEY = env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !KEY) {
  console.error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY absents de .env.local')
  process.exit(1)
}

interface SiteRow { site_domain: string; products: any[] }

async function main() {
const res = await fetch(
  `${SUPABASE_URL}/rest/v1/scraped_site_data?status=eq.success&select=site_domain,products`,
  { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } }
)
if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`)
const rows: SiteRow[] = await res.json()
const bySite = new Map(rows.map(r => [r.site_domain, r.products || []]))

if (!bySite.has(REFERENCE)) {
  console.error(`Référent ${REFERENCE} absent de scraped_site_data (status=success)`)
  process.exit(1)
}

// Même défaut que computeCampaignData : la référence ne garde que son
// inventaire réel (pas le catalogue fabricant).
let refProducts = bySite.get(REFERENCE)!.filter(
  (p: any) => (p.sourceCategorie || '').toLowerCase() !== 'catalogue'
)
if (refProducts.length === 0) refProducts = bySite.get(REFERENCE)!
console.log(`Référent ${REFERENCE}: ${refProducts.length} produits (hors catalogue)`)

const refIndex = new Map<string, any[]>()
for (const rp of refProducts) {
  const key = buildMatchKey(rp, false)
  if (!key.split('|')[1]) continue
  if (!refIndex.has(key)) refIndex.set(key, [])
  refIndex.get(key)!.push(rp)
}
console.log(`Clés de matching du référent: ${refIndex.size}\n`)

function scoreSite(products: any[]): { matches: number; nonCompetitive: Set<string> } {
  let matches = 0
  const nonCompetitive = new Set<string>()
  for (const raw of products) {
    const key = buildMatchKey(raw, false)
    if (!key.split('|')[1]) continue
    const refs = refIndex.get(key)
    if (!refs || refs.length === 0) continue
    matches++
    const price = parseFloat(raw.prix) || 0
    let bestRef = refs[0]
    let minDiff = Infinity
    for (const r of refs) {
      const rp = parseFloat(r.prix) || 0
      if (rp > 0 && price > 0) {
        const d = Math.abs(price - rp)
        if (d < minDiff) { minDiff = d; bestRef = r }
      }
    }
    const refPrice = parseFloat(bestRef.prix) || 0
    if (price > 0 && refPrice > 0 && price < refPrice && bestRef.sourceUrl) {
      nonCompetitive.add(String(bestRef.sourceUrl))
    }
  }
  return { matches, nonCompetitive }
}

const scores = [...bySite.entries()]
  .filter(([domain]) => domain !== REFERENCE && !MARKETPLACES.has(domain))
  .map(([domain, products]) => ({ domain, products: products.length, ...scoreSite(products) }))
  .sort((a, b) => b.matches - a.matches || b.nonCompetitive.size - a.nonCompetitive.size)

console.log('domaine'.padEnd(32) + 'produits'.padStart(9) + 'matches'.padStart(9) + 'refNonComp'.padStart(11))
for (const s of scores) {
  console.log(s.domain.padEnd(32) + String(s.products).padStart(9) + String(s.matches).padStart(9) + String(s.nonCompetitive.size).padStart(11))
}

const top8 = scores.slice(0, 8)
const union = new Set<string>(top8.flatMap(s => [...s.nonCompetitive]))
const totalMatches = top8.reduce((sum, s) => sum + s.matches, 0)
console.log(`\nTop 8 (par matches) : ${top8.map(s => s.domain).join(', ')}`)
console.log(`Prix appariés : ${totalMatches} — unités non compétitives (union) : ${union.size} / ${refProducts.length}`)

// Sélection gloutonne : chaque site ajouté est celui qui couvre le plus de
// NOUVELLES unités non compétitives (tiebreak matches) — maximise
// l'argumentaire de la page avec 8 concurrents.
const greedy: typeof scores = []
const covered = new Set<string>()
const pool = scores.filter(s => s.matches > 0)
while (greedy.length < 8 && pool.length > 0) {
  pool.sort((a, b) => {
    const gainA = [...a.nonCompetitive].filter(u => !covered.has(u)).length
    const gainB = [...b.nonCompetitive].filter(u => !covered.has(u)).length
    return gainB - gainA || b.matches - a.matches
  })
  const next = pool.shift()!
  greedy.push(next)
  for (const u of next.nonCompetitive) covered.add(u)
}
console.log(`\nSélection gloutonne (couverture max) :`)
for (const s of greedy) {
  console.log(`  ${s.domain.padEnd(30)} matches=${String(s.matches).padStart(3)}  refNonComp=${s.nonCompetitive.size}`)
}
console.log(`Prix appariés : ${greedy.reduce((sum, s) => sum + s.matches, 0)} — unités non compétitives (union) : ${covered.size} / ${refProducts.length}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
