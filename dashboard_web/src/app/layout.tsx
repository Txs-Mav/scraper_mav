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

const siteUrl = process.env.NEXT_PUBLIC_APP_URL || "https://go-data.co"

export const metadata: Metadata = {
  title: {
    default: "Go-Data | Veille de prix pour concessionnaires moto et sports motorisés",
    template: "%s | Go-Data",
  },
  description:
    "Go-Data surveille chaque jour les prix et inventaires publics des concessionnaires concurrents. Comparez votre position, détectez les écarts, ajustez vos prix. Essai gratuit.",
  metadataBase: new URL(siteUrl),
  alternates: {
    // "./" (exactement) se résout contre le pathname de la requête : chaque
    // page se canonicalise elle-même. "/" canonicaliserait tout le site vers
    // l'accueil.
    canonical: "./",
  },
  // openGraph/twitter sans title, description ni images : Next remplit
  // og:title/og:description depuis le title/description résolus DE CHAQUE
  // page, et la convention fichier opengraph-image.tsx fournit og:image
  // (URL hashée, cache-bust automatique) — uniquement si `images` est absent.
  openGraph: {
    type: "website",
    locale: "fr_CA",
    url: "./",
    siteName: "Go-Data",
  },
  twitter: {
    card: "summary_large_image",
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
      "Go-Data aide les entreprises à collecter, comparer et suivre des données publiques de prix et d'inventaire.",
    contactPoint: {
      "@type": "ContactPoint",
      email: "gestion@go-data.co",
      telephone: "+1-819-448-2882",
      contactType: "customer service",
      availableLanguage: ["French", "English"],
    },
    // TODO: ajouter l'URL de la page LinkedIn entreprise dès qu'elle existe,
    // ex. sameAs: ["https://www.linkedin.com/company/go-data"]. Ne jamais
    // publier de placeholder ici — Google lit ce bloc tel quel.
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
          defaultTheme="dark"
          enableSystem={false}
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
