"use client"

import { Code2, Webhook, Terminal, Zap, Globe2, ShieldCheck } from "lucide-react"
import VerticalHero from "@/components/marketing/vertical-hero"
import FeatureGrid from "@/components/marketing/feature-grid"
import CaseStudiesGrid from "@/components/marketing/case-study-card"
import CTASection from "@/components/marketing/cta-section"
import FAQ from "@/components/marketing/faq"
import { useLanguage } from "@/contexts/language-context"

const CURL_SAMPLE = `curl -X POST https://api.go-data.co/v1/scrape \\
  -H "Authorization: Bearer gd_live_••••••••" \\
  -H "Content-Type: application/json" \\
  -d '{
    "url": "https://example.com/products/123",
    "render_js": true,
    "country": "US"
  }'`

const PYTHON_SAMPLE = `from godata import GoData

client = GoData(api_key="gd_live_...")

result = client.scrape(
    url="https://example.com/products/123",
    render_js=True,
    country="US",
)

print(result.data)
# {
#   "title": "Produit exemple",
#   "price": 49.99,
#   "currency": "USD",
#   "in_stock": True,
#   "rating": 4.7,
#   ...
# }`

const JS_SAMPLE = `import { GoData } from "@go-data/sdk"

const client = new GoData({ apiKey: process.env.GODATA_KEY })

const result = await client.scrape({
  url: "https://example.com/products/123",
  renderJs: true,
  country: "US",
})

console.log(result.data)`

export default function DevelopersVertical() {
  const { t } = useLanguage()
  return (
    <>
      <VerticalHero
        eyebrow={t("vertical.developers.eyebrow")}
        title={t("vertical.developers.title")}
        subtitle={t("vertical.developers.subtitle")}
        metrics={[
          { value: "À venir", label: t("vertical.developers.metric1") },
          { value: "À cadrer", label: t("vertical.developers.metric2") },
          { value: "À tester", label: t("vertical.developers.metric3") },
        ]}
        ctaPrimary={{ href: "/dashboard/api-keys", label: t("vertical.developers.cta") }}
        ctaSecondary={{ href: "/docs", label: "Read the docs" }}
        benefits={[
          "API publique à préparer avant annonce forte",
          "SDKs à envisager après stabilisation de l'API",
          "Documentation en français prioritaire",
          "Aucune promesse SLA / proxy tant que non validée",
        ]}
        visual={
          <div className="rounded-2xl border border-gray-200 dark:border-white/10 bg-[#0d0f10] dark:bg-[#0d0f10] p-0 overflow-hidden shadow-2xl">
            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-white/10 bg-white/[0.02]">
              <div className="flex gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full bg-red-400" />
                <div className="w-2.5 h-2.5 rounded-full bg-yellow-400" />
                <div className="w-2.5 h-2.5 rounded-full bg-green-400" />
              </div>
              <span className="text-[11px] font-mono text-gray-400 ml-2">curl</span>
            </div>
            <pre className="p-4 text-[11px] leading-relaxed font-mono text-emerald-300 overflow-x-auto">{CURL_SAMPLE}</pre>
          </div>
        }
      />

      <section className="max-w-7xl mx-auto px-4 sm:px-6 py-16">
        <div className="grid md:grid-cols-2 gap-5">
          <div className="rounded-2xl border border-gray-200 dark:border-white/10 bg-[#0d0f10] overflow-hidden">
            <div className="px-4 py-2.5 border-b border-white/10 text-xs font-mono text-gray-400">python</div>
            <pre className="p-4 text-[11px] leading-relaxed font-mono text-blue-300 overflow-x-auto">{PYTHON_SAMPLE}</pre>
          </div>
          <div className="rounded-2xl border border-gray-200 dark:border-white/10 bg-[#0d0f10] overflow-hidden">
            <div className="px-4 py-2.5 border-b border-white/10 text-xs font-mono text-gray-400">javascript</div>
            <pre className="p-4 text-[11px] leading-relaxed font-mono text-yellow-200 overflow-x-auto">{JS_SAMPLE}</pre>
          </div>
        </div>
      </section>

      <FeatureGrid
        title="Roadmap développeur"
        subtitle="Préparer l'interface et la documentation sans prétendre que l'infrastructure est déjà comparable aux acteurs enterprise."
        items={[
          { icon: Code2, title: t("vertical.developers.usecase1Title"), description: t("vertical.developers.usecase1Desc") },
          { icon: Terminal, title: t("vertical.developers.usecase2Title"), description: t("vertical.developers.usecase2Desc") },
          { icon: Zap, title: t("vertical.developers.usecase3Title"), description: t("vertical.developers.usecase3Desc") },
          { icon: Webhook, title: "Webhooks for everything", description: "Stream every result, every error, every status change to your endpoint with HMAC-signed payloads." },
          { icon: Globe2, title: "Proxy / géolocalisation", description: "À définir techniquement avant publication." },
          { icon: ShieldCheck, title: "SLA / sécurité", description: "À documenter après mise en place d'un monitoring réel." },
        ]}
      />

      <CaseStudiesGrid vertical="developers" />
      <FAQ
        items={[
          { q: "L'API est-elle déjà publique ?", a: "Elle doit être traitée comme roadmap tant que les endpoints, la sécurité et la facturation ne sont pas stabilisés." },
          { q: "Les SDKs existent-ils ?", a: "Non, pas à annoncer comme livrés. Ils peuvent être listés comme à venir." },
          { q: "Peut-on promettre un SLA ?", a: "Non. Il faut brancher un monitoring réel avant d'afficher des chiffres." },
        ]}
      />
      <CTASection primaryHref="/dashboard/api-keys" primaryLabel={t("vertical.developers.cta")} />
    </>
  )
}
