/**
 * URLs des outils externes affichés dans la console développeur.
 *
 * Toutes configurables via variables d'environnement publiques (NEXT_PUBLIC_*)
 * pour pouvoir les changer sans recompiler. Si non définies, on retombe sur :
 *   - Pour Supabase : on dérive automatiquement l'URL projet depuis
 *     NEXT_PUBLIC_SUPABASE_URL.
 *   - Pour les autres : on renvoie vers la page d'accueil du service
 *     (l'utilisateur navigue ensuite manuellement).
 */

function deriveSupabaseDashboardUrl(): string {
  const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ""
  // ex: https://nvvvtlbfhiwffnrrtgfg.supabase.co → projet ref = nvvvtlbfhiwffnrrtgfg
  const match = supaUrl.match(/^https?:\/\/([^.]+)\.supabase\./)
  if (match && match[1]) {
    return `https://supabase.com/dashboard/project/${match[1]}`
  }
  return "https://supabase.com/dashboard"
}

export const EXTERNAL_LINKS = {
  github: process.env.NEXT_PUBLIC_GITHUB_ACTIONS_URL || "https://github.com/actions",
  railway: process.env.NEXT_PUBLIC_RAILWAY_URL || "https://railway.com/dashboard",
  vercel: process.env.NEXT_PUBLIC_VERCEL_URL || "https://vercel.com/dashboard",
  supabase: process.env.NEXT_PUBLIC_SUPABASE_DASHBOARD_URL || deriveSupabaseDashboardUrl(),
  gmail: process.env.NEXT_PUBLIC_GMAIL_URL || "https://mail.google.com/mail/u/0/#inbox",
}
