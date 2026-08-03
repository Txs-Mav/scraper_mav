import type { Metadata } from "next"
import type { ReactNode } from "react"

// La page /about est un client component ("use client") et ne peut pas
// exporter `metadata` elle-même — ce layout serveur porte ses métadonnées.
export const metadata: Metadata = {
  title: "À propos",
  description:
    "Go-Data est bâtie au Québec pour les concessionnaires moto et sports motorisés : une veille de prix quotidienne, des données vérifiées, zéro promesse creuse.",
}

export default function AboutLayout({ children }: { children: ReactNode }) {
  return children
}
