import { redirect } from "next/navigation"
import { getCurrentUser } from "@/lib/supabase/helpers"
import { isDevAdminUser } from "@/lib/auth/admin"
import AdminLayoutClient from "./layout-client"

/**
 * Server component : vérifie l'autorisation AVANT tout render.
 *
 * Politique : seul le compte dont l'email correspond à DEV_ADMIN_EMAIL
 * (variable d'environnement) peut accéder à /admin/*. Le rôle Postgres
 * (`users.role`) n'est PAS la gate : c'est l'email qui fait foi (cf.
 * src/lib/auth/admin.ts).
 *
 * Le middleware Next.js bloque déjà les non-loggés en amont. Ce layout ajoute
 * la 2e couche : vérification de l'identité du compte dev, AVANT que le HTML
 * admin ne quitte le serveur. Plus aucun flash d'UI pour un non-autorisé.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const user = await getCurrentUser()

  if (!user) {
    redirect("/login?next=/admin")
  }

  if (!isDevAdminUser(user)) {
    redirect("/dashboard")
  }

  return <AdminLayoutClient initialUser={user}>{children}</AdminLayoutClient>
}
