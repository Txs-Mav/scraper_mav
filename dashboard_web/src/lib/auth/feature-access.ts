/**
 * Feature-gate "recherche par produit"
 *
 * Politique (mai 2026) : la feature n'est exposée qu'à une allowlist d'emails
 * pendant la phase de rodage. On gate à 3 niveaux pour éviter toute fuite :
 *   1. UI nav        → masque le lien dans top-nav (UX)
 *   2. Layout page   → redirige /dashboard/recherche vers /dashboard côté
 *                      serveur si non autorisé
 *   3. API routes    → renvoient 403 si appelées par un user non autorisé
 *
 * Source de vérité côté serveur :
 *   - `auth_email` (auth.users.email Supabase) — jamais `users.email` qui peut
 *     diverger (cf. lib/auth/admin.ts pour la même logique sur DEV_ADMIN_EMAIL).
 *
 * Pour ouvrir l'accès à un autre user, ajoute son email à `ALLOWLIST` ci-
 * dessous puis redéploie. Pas d'env var pour l'instant : on veut traçabilité
 * dans git de qui obtient l'accès.
 */
import { isDevAdminEmail, isDevAdminEmailPublic } from "./admin"

interface UserLike {
  auth_email?: string | null
  email?: string | null
}

const ALLOWLIST: readonly string[] = [
  "mmenard@mvmmotosport.com",
]

const NORMALIZED_ALLOWLIST = new Set(ALLOWLIST.map((e) => e.trim().toLowerCase()))

function normalizeEmail(email: string | null | undefined): string {
  return (email || "").trim().toLowerCase()
}

function isAllowlistedEmail(email: string | null | undefined): boolean {
  const normalized = normalizeEmail(email)
  if (!normalized) return false
  return NORMALIZED_ALLOWLIST.has(normalized)
}

/**
 * Serveur : autorise l'accès à la recherche par produit si l'email vérifié
 * (`auth_email`) est dans l'allowlist, OU si l'user est le dev admin (utile
 * pour maintenance/debug). Fail-closed sinon.
 */
export function isProductSearchAllowed(user: UserLike | null | undefined): boolean {
  if (!user) return false
  const authEmail = normalizeEmail(user.auth_email)
  if (!authEmail) return false
  if (isAllowlistedEmail(authEmail)) return true
  if (isDevAdminEmail(authEmail)) return true
  return false
}

/**
 * Client : variante qui accepte aussi `user.email` (l'email applicatif
 * exposé par useAuth). Sert UNIQUEMENT à masquer des liens dans l'UI — le
 * vrai gate reste serveur (layout + API).
 */
export function isProductSearchAllowedPublic(user: UserLike | null | undefined): boolean {
  if (!user) return false
  const candidate = normalizeEmail(user.auth_email || user.email)
  if (!candidate) return false
  if (isAllowlistedEmail(candidate)) return true
  if (isDevAdminEmailPublic(candidate)) return true
  return false
}
