import Link from "next/link"
import { CheckCircle } from "lucide-react"

export default function EmailConfirmedPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-emerald-50 via-white to-teal-50 dark:from-[#1c1e20] dark:via-[#1c1e20] dark:to-[#1A0F1F] px-4">
      <div className="max-w-md w-full space-y-6 bg-white dark:bg-[#2a2c2e] p-8 rounded-2xl border border-gray-200 dark:border-[#343638] shadow-xl text-center">
        <div className="flex flex-col items-center gap-3">
          <CheckCircle className="h-10 w-10 text-green-500" />
          <h1 className="text-xl font-semibold text-gray-900 dark:text-white">
            Votre compte est confirmé
          </h1>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Vous pouvez maintenant vous connecter avec vos identifiants.
          </p>
        </div>
        <div className="pt-2">
          <Link
            href="/login"
            className="inline-flex w-full justify-center rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-emerald-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
          >
            Aller au login
          </Link>
        </div>
      </div>
    </div>
  )
}
