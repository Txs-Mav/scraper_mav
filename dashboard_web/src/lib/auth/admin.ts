/**
 * Single source of truth pour l'autorisation "console développeur".
 *
 * Politique courante (mai 2026) :
 *   Seul le compte dont l'email correspond à DEV_ADMIN_EMAIL (variable
 *   d'environnement définie dans .env) peut accéder à /admin/* et
 *   /dashboard/admin/*. Le rôle Postgres (`users.role`) n'est PAS utilisé
 *   comme gate : c'est l'email qui fait foi, parce que la base contient
 *   actuellement plusieurs comptes en `role='main'` qui ne devraient pas
 *   avoir d'accès admin.
 *
 * Utilisation :
 *   - Server   : `import { isDevAdminUser } from '@/lib/auth/admin'`
 *                puis `isDevAdminUser(user)`. Lit `process.env.DEV_ADMIN_EMAIL`.
 *   - Client   : `import { isDevAdminEmail } from '@/lib/auth/admin'`
 *                avec `process.env.NEXT_PUBLIC_DEV_ADMIN_EMAIL` exposé.
 *
 * Note de sécurité : le client guard est superflu — la vraie protection
 * est dans le middleware + les server components + les API routes. Le client
 * guard sert uniquement à éviter le flash de l'UI admin pour un user qui
 * aurait été rétrogradé en cours de session.
 */

interface UserLike {
  email?: string | null
  role?: string | null
}

function normalizeEmail(email: string | null | undefined): string {
  return (email || "").trim().toLowerCase()
}

/**
 * Récupère l'email du compte dev admin depuis l'env serveur.
 * Retourne "" si non configuré (auquel cas TOUT accès admin est bloqué — fail-safe).
 */
export function getDevAdminEmail(): string {
  return normalizeEmail(process.env.DEV_ADMIN_EMAIL)
}

/**
 * Récupère l'email du compte dev admin depuis l'env client.
 * Retourne "" si non configuré.
 */
export function getDevAdminEmailPublic(): string {
  return normalizeEmail(process.env.NEXT_PUBLIC_DEV_ADMIN_EMAIL)
}

/**
 * Vérifie si un email correspond au compte dev admin (côté serveur).
 * Si DEV_ADMIN_EMAIL n'est pas défini, retourne `false` (fail-safe).
 */
export function isDevAdminEmail(email: string | null | undefined): boolean {
  const target = getDevAdminEmail()
  if (!target) return false
  return normalizeEmail(email) === target
}

/**
 * Variante client : utilise NEXT_PUBLIC_DEV_ADMIN_EMAIL.
 */
export function isDevAdminEmailPublic(email: string | null | undefined): boolean {
  const target = getDevAdminEmailPublic()
  if (!target) return false
  return normalizeEmail(email) === target
}

/**
 * Helper principal côté serveur : retourne true si l'utilisateur a accès
 * à la console développeur.
 */
export function isDevAdminUser(user: UserLike | null | undefined): boolean {
  if (!user) return false
  return isDevAdminEmail(user.email)
}

/**
 * Helper côté client : utilise NEXT_PUBLIC_DEV_ADMIN_EMAIL.
 */
export function isDevAdminUserPublic(user: UserLike | null | undefined): boolean {
  if (!user) return false
  return isDevAdminEmailPublic(user.email)
}
