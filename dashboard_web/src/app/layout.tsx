import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { AuthProvider } from "@/contexts/auth-context";
import { LanguageProvider } from "@/contexts/language-context";
import { Toaster } from "sonner";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const siteUrl = process.env.NEXT_PUBLIC_APP_URL || "https://www.go-data.co"

export const metadata: Metadata = {
  title: {
    default: "Go-Data | Collecte et structuration de données automatisée",
    template: "%s | Go-Data",
  },
  description:
    "Go-Data collecte, structure et livre vos données en quelques clics. Zéro code, zéro friction. Scraping intelligent propulsé par l'IA.",
  metadataBase: new URL(siteUrl),
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    locale: "fr_CA",
    url: siteUrl,
    siteName: "Go-Data",
    title: "Go-Data | Collecte et structuration de données automatisée",
    description:
      "Go-Data collecte, structure et livre vos données en quelques clics. Zéro code, zéro friction.",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "Go-Data — Vos données, prêtes à l'emploi",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Go-Data | Collecte de données automatisée",
    description:
      "Collectez, structurez et livrez vos données en quelques clics avec Go-Data.",
    images: ["/og-image.png"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  icons: {
    icon: "/icon.svg",
    apple: "/apple-icon",
  },
  verification: {
    google: "IfOxvSg3zgzHWEh9MVNTIz5Cd-xZ4iUDq7xeUPCSob8",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "Go-Data",
    url: siteUrl,
    logo: `${siteUrl}/Go-Data.svg`,
    description:
      "Go-Data collecte, structure et livre vos données en quelques clics. Scraping intelligent propulsé par l'IA.",
    contactPoint: {
      "@type": "ContactPoint",
      email: "gestion@go-data.co",
      telephone: "+1-819-448-2882",
      contactType: "customer service",
      availableLanguage: ["French", "English"],
    },
    sameAs: [],
  }

  const softwareJsonLd = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "Go-Data",
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    url: siteUrl,
    offers: {
      "@type": "AggregateOffer",
      priceCurrency: "CAD",
      lowPrice: "0",
      highPrice: "274.99",
      offerCount: 3,
    },
  }

  return (
    <html lang="fr" suppressHydrationWarning>
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(softwareJsonLd) }}
        />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <ThemeProvider
          attribute="class"
          forcedTheme="dark"
          disableTransitionOnChange
        >
          <LanguageProvider>
            <AuthProvider>
              {children}
              <Toaster
                position="bottom-right"
                toastOptions={{
                  style: {
                    borderRadius: "16px",
                    border: "1px solid rgba(0,0,0,0.06)",
                    boxShadow: "0 8px 32px -8px rgba(0,0,0,0.12)",
                    padding: "14px 18px",
                    fontSize: "14px",
                  },
                }}
                richColors
                closeButton
              />
            </AuthProvider>
          </LanguageProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
