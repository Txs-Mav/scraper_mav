import Link from "next/link"
import Image from "next/image"

const COLUMNS: { title: string; links: { href: string; label: string }[] }[] = [
  {
    title: "Produit",
    links: [
      { href: "/pricing", label: "Tarifs" },
      { href: "/demo", label: "Démo" },
    ],
  },
  {
    title: "Entreprise",
    links: [
      { href: "/about", label: "À propos" },
      { href: "/contact", label: "Contact" },
      { href: "/security", label: "Sécurité" },
    ],
  },
  {
    title: "Légal",
    links: [
      { href: "/legal/privacy", label: "Confidentialité" },
      { href: "/legal/terms", label: "Conditions" },
    ],
  },
]

export default function MarketingFooter() {
  const year = new Date().getFullYear()

  return (
    <footer className="border-t border-gray-200 dark:border-white/10">
      <div className="mx-auto max-w-6xl px-6 py-14">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div>
            <Link href="/" className="flex items-center gap-2.5">
              <span className="relative h-7 w-7 overflow-hidden rounded-md ring-1 ring-gray-200 dark:ring-white/10">
                <Image src="/Go-Data.svg" alt="Go-Data" fill sizes="28px" className="object-contain" />
              </span>
              <span className="text-[15px] font-semibold tracking-tight text-gray-900 dark:text-white">
                Go-Data
              </span>
            </Link>
            <p className="mt-3 max-w-xs text-sm leading-relaxed text-gray-500 dark:text-gray-400">
              Veille de prix et données concurrentielles pour le marché moto et les sports
              motorisés.
            </p>
          </div>

          {COLUMNS.map((col) => (
            <div key={col.title}>
              <h3 className="text-[12px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
                {col.title}
              </h3>
              <ul className="mt-4 space-y-2.5">
                {col.links.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="text-sm text-gray-600 transition-colors hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 flex flex-col items-start justify-between gap-3 border-t border-gray-200 pt-6 sm:flex-row sm:items-center dark:border-white/10">
          <p className="text-xs text-gray-400 dark:text-gray-500">
            © {year} Go-Data. Tous droits réservés.
          </p>
          <p className="text-xs text-gray-400 dark:text-gray-500">
            <a href="mailto:gestion@go-data.co" className="hover:text-gray-900 dark:hover:text-white">
              gestion@go-data.co
            </a>
            {" · "}
            819-448-2882
          </p>
        </div>
      </div>
    </footer>
  )
}
