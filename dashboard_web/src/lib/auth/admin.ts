/**
 * Single source of truth pour l'autorisation "console développeur".
 *
 * Politique stricte (révision sécurité mai 2026) :
 *   1. Le seul gate côté serveur est l'email de l'utilisateur authentifié
 *      comparé à `DEV_ADMIN_EMAIL` (variable d'environnement).
 *   2. Si `DEV_ADMIN_EMAIL` n'est PAS configuré, on bloque tout accès admin
 *      (fail-closed). Pas de fallback sur `users.role` : ce champ est trop
 *      facilement contournable (RLS mal configurée, héritage d'anciennes
 *      conventions, etc.) et on a déjà eu un incident où plusieurs comptes
 *      avaient `role='developer'` sans devoir l'être.
 *   3. L'email comparé doit provenir de `auth.users` (Supabase Auth), pas
 *      de `public.users`. Le helper `getCurrentUser()` est donc responsable
 *      d'attacher `auth_email` à l'objet user retourné.
 *
 * Utilisation :
 *   - Server : `import { isDevAdminUser } from '@/lib/auth/admin'`
 *              puis `isDevAdminUser(user)`. Lit `process.env.DEV_ADMIN_EMAIL`.
 *   - Client : `import { isDevAdminUserPublic } from '@/lib/auth/admin'`.
 *              Sert UNIQUEMENT à cacher des liens dans l'UI ; le vrai gate
 *              est serveur.
 */

interface UserLike {
  /** Email canonique vérifié par Supabase Auth (auth.users.email). */
  auth_email?: string | null
  /** Email applicatif (public.users.email). À ne pas utiliser pour la gate. */
  email?: string | null
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
 * STRICT : on compare uniquement `user.auth_email` (email vérifié Supabase
 * Auth) à `DEV_ADMIN_EMAIL`. Si `DEV_ADMIN_EMAIL` n'est pas configuré ou
 * que `auth_email` est absent, on retourne false (fail-closed).
 *
 * Pas de fallback sur `users.role` : trop fragile en cas de mauvaise RLS,
 * de migration ratée, ou d'héritage de comptes 'main'/'developer'.
 */
export function isDevAdminUser(user: UserLike | null | undefined): boolean {
  if (!user) return false
  const target = getDevAdminEmail()
  if (!target) {
    if (typeof console !== "undefined") {
      console.error(
        "[admin/auth] DEV_ADMIN_EMAIL non configuré — accès admin refusé (fail-closed). " +
          "Configure cette variable d'environnement sur Vercel/local pour activer la console.",
      )
    }
    return false
  }
  // On exige explicitement l'email vérifié de auth.users, pas l'email
  // applicatif (qui peut diverger via RLS ou triggers).
  const authEmail = normalizeEmail(user.auth_email)
  if (!authEmail) return false
  return authEmail === target
}

/**
 * Helper côté client : utilise NEXT_PUBLIC_DEV_ADMIN_EMAIL.
 *
 * Sert uniquement à cacher des liens dans l'UI (menu profil, etc.). Le vrai
 * contrôle d'accès est serveur (layouts + API routes). On compare l'email
 * exposé côté client (qui vient de la session Supabase Auth) à la variable
 * publique. Pas de fallback role.
 */
export function isDevAdminUserPublic(user: UserLike | null | undefined): boolean {
  if (!user) return false
  const target = getDevAdminEmailPublic()
  if (!target) return false
  // Côté client, on accepte aussi user.email parce que c'est l'email
  // applicatif (les composants existants passent ça). Mais le vrai gate
  // est serveur.
  const candidate = normalizeEmail(user.auth_email || user.email)
  return candidate === target
}
