import type { ReactNode } from "react"
import { Bricolage_Grotesque } from "next/font/google"
import MarketingHeader from "@/components/marketing/marketing-header"
import MarketingFooter from "@/components/marketing/marketing-footer"
import CookieBanner from "@/components/cookie-banner"

const display = Bricolage_Grotesque({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["500", "600", "700", "800"],
})

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <div
      className={`${display.variable} min-h-screen flex flex-col bg-white dark:bg-[#0b0c0d] text-gray-900 dark:text-white`}
    >
      <MarketingHeader />
      <main className="flex-1">{children}</main>
      <MarketingFooter />
      <CookieBanner />
    </div>
  )
}
