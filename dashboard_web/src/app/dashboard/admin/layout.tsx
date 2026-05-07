import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { getCurrentUser } from "@/lib/supabase/helpers"
import { isDevAdminUser } from "@/lib/auth/admin"

/**
 * Server component : protège toutes les pages /dashboard/admin/*
 * (par exemple /dashboard/admin/news).
 *
 * Politique : seul le compte dont l'email vérifié Supabase Auth correspond
 * à DEV_ADMIN_EMAIL est autorisé. Toute tentative est journalisée.
 */
export default async function DashboardAdminLayout({
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

  if (!user) {
    console.warn(`[admin/audit] dashboard_admin anonymous_redirect ip=${ip}`)
    redirect("/login")
  }

  if (!isDevAdminUser(user)) {
    console.warn(
      `[admin/audit] dashboard_admin forbidden user_id=${user.id} ` +
        `auth_email=${user.auth_email ?? "?"} app_email=${user.email ?? "?"} ` +
        `role=${user.role ?? "?"} ip=${ip}`,
    )
    redirect("/dashboard")
  }

  return <>{children}</>
}
