import { redirect } from "next/navigation"
import { getCurrentUser } from "@/lib/supabase/helpers"
import { isDevAdminUser } from "@/lib/auth/admin"

/**
 * Server component : protège toutes les pages /dashboard/admin/*
 * (par exemple /dashboard/admin/news).
 *
 * Politique : seul le compte dont l'email correspond à DEV_ADMIN_EMAIL est
 * autorisé. Voir src/lib/auth/admin.ts pour la justification.
 */
export default async function DashboardAdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const user = await getCurrentUser()

  if (!user) {
    redirect("/login")
  }

  if (!isDevAdminUser(user)) {
    redirect("/dashboard")
  }

  return <>{children}</>
}
