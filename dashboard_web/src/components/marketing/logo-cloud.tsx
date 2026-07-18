import Image from "next/image"
import { CUSTOMERS } from "@/lib/marketing-data"

export default function LogoCloud() {
  return (
    <section className="border-y border-gray-200 dark:border-white/10">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-8 px-6 py-12 sm:flex-row sm:justify-between">
        <p className="text-[13px] text-gray-500 dark:text-gray-400">
          Déjà utilisé par des concessionnaires moto au Québec
        </p>
        <div className="flex items-center gap-4">
          {CUSTOMERS.map((c) =>
            c.logo ? (
              <div
                key={c.name}
                className="flex h-12 w-32 items-center justify-center rounded-md bg-white px-4 ring-1 ring-gray-200 dark:ring-white/10"
              >
                <span className="relative h-7 w-full">
                  <Image src={c.logo} alt={c.name} fill sizes="128px" className="object-contain" />
                </span>
              </div>
            ) : (
              <span key={c.name} className="text-sm font-medium text-gray-400 dark:text-gray-500">
                {c.name}
              </span>
            )
          )}
        </div>
      </div>
    </section>
  )
}
