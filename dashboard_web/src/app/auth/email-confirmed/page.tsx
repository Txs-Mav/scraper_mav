import Link from "next/link"
import { CheckCircle } from "lucide-react"

export default function EmailConfirmedPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 via-white to-purple-50 dark:from-[#0F0F12] dark:via-[#0F0F12] dark:to-[#1A0F1F] px-4">
      <div className="max-w-md w-full space-y-6 bg-white dark:bg-[#1F1F23] p-8 rounded-2xl border border-gray-200 dark:border-[#2B2B30] shadow-xl text-center">
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
            className="inline-flex w-full justify-center rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
          >
            Aller au login
          </Link>
        </div>
      </div>
    </div>
  )
}
