import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { getCurrentUser } from "@/lib/supabase/helpers"
import { isDevAdminUser } from "@/lib/auth/admin"
import AdminLayoutClient from "./layout-client"

/**
 * Server component : vérifie l'autorisation AVANT tout render.
 *
 * Politique : seul le compte dont l'email vérifié Supabase Auth correspond
 * à DEV_ADMIN_EMAIL (variable d'environnement) peut accéder à /admin/*.
 * Pas de fallback sur users.role (cf. src/lib/auth/admin.ts).
 *
 * Le middleware Next.js bloque déjà les non-loggés en amont. Ce layout ajoute
 * la 2e couche : vérification d'identité AVANT que le HTML admin ne quitte
 * le serveur. Toute tentative est journalisée pour audit/forensique.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const user = await getCurrentUser()
  const hdrs = await headers()
  const ip =
    hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    hdrs.get("x-real-ip") ||
    "?"
  const ua = hdrs.get("user-agent") || "?"
  const path = hdrs.get("x-invoke-path") || hdrs.get("x-pathname") || "/admin"

  if (!user) {
    console.warn(
      `[admin/audit] anonymous_redirect path=${path} ip=${ip} ua="${ua}"`,
    )
    redirect("/login?next=/admin")
  }

  if (!isDevAdminUser(user)) {
    // On log l'identité de la tentative pour pouvoir tracer un usurpateur.
    console.warn(
      `[admin/audit] forbidden user_id=${user.id} ` +
        `auth_email=${user.auth_email ?? "?"} app_email=${user.email ?? "?"} ` +
        `role=${user.role ?? "?"} path=${path} ip=${ip} ua="${ua}"`,
    )
    redirect("/dashboard")
  }

  console.info(
    `[admin/audit] granted user_id=${user.id} auth_email=${user.auth_email} ` +
      `path=${path} ip=${ip}`,
  )

  return <AdminLayoutClient initialUser={user}>{children}</AdminLayoutClient>
}
