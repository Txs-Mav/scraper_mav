import type { ReactNode } from "react"
import MarketingHeader from "@/components/marketing/marketing-header"
import MarketingFooter from "@/components/marketing/marketing-footer"
import CookieBanner from "@/components/cookie-banner"

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col bg-[#fafbfc] dark:bg-[#0d0f10] text-gray-900 dark:text-white">
      <MarketingHeader />
      <main className="flex-1">{children}</main>
      <MarketingFooter />
      <CookieBanner />
    </div>
  )
}
