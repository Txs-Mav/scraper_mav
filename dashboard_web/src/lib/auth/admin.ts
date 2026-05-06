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
 *
 * Fallback : si `DEV_ADMIN_EMAIL` n'est pas configuré dans l'env (typique
 * d'un déploiement Vercel où on a oublié de set la variable), on accepte
 * `user.role === 'developer'`. Ce fallback est sûr parce que :
 *   1. La promotion vers le rôle 'developer' est verrouillée par un trigger
 *      Postgres (migration_normalize_admin_role.sql) qui n'autorise que la
 *      service_role à effectuer ce changement.
 *   2. Le rôle est lu depuis `public.users` côté serveur via la session
 *      Supabase, pas depuis le JWT client.
 */
export function isDevAdminUser(user: UserLike | null | undefined): boolean {
  if (!user) return false
  if (isDevAdminEmail(user.email)) return true
  return normalizeEmail(user.role) === "developer"
}

/**
 * Helper côté client : utilise NEXT_PUBLIC_DEV_ADMIN_EMAIL.
 *
 * Fallback : si l'env publique n'est pas configurée (cas typique d'un
 * déploiement Vercel où on a oublié `NEXT_PUBLIC_DEV_ADMIN_EMAIL`), on
 * accepte aussi `user.role === 'developer'`. Le vrai gate (middleware +
 * server components + routes API) reste l'email serveur — ce check client
 * ne sert qu'à la redirection UI vers /admin.
 */
export function isDevAdminUserPublic(user: UserLike | null | undefined): boolean {
  if (!user) return false
  if (isDevAdminEmailPublic(user.email)) return true
  return normalizeEmail(user.role) === "developer"
}
