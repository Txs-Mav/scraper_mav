/**
 * Restrictions par plan d'abonnement
 *
 * Plans: standard (Gratuit), pro (Pro), ultime (Ultime)
 *
 * ┌─────────────────┬──────────────────────────────────────────────────────────┐
 * │ Plan           │ Accès                                                      │
 * ├─────────────────┼──────────────────────────────────────────────────────────┤
 * │ Gratuit        │ Dashboard, Paiements, Paramètres, Profil.                  │
 * │ (standard)     │ 6 scrapings max. PAS: Analytics, Alerte (0 alertes).       │
 * ├─────────────────┼──────────────────────────────────────────────────────────┤
 * │ Pro            │ Tout + Analytics, Alerte (max 3), scrapings illimités.     │
 * │ Ultime         │ Tout + alertes illimitées, scrapers illimités, SLA.        │
 * └─────────────────┴──────────────────────────────────────────────────────────┘
 */

export type PlanId = 'standard' | 'pro' | 'ultime'

export const PLAN_LABELS: Record<PlanId, string> = {
  standard: 'Gratuit',
  pro: 'Pro',
  ultime: 'Ultime',
}

/** Plan considéré comme "gratuit" (accès limité) */
export const FREE_PLAN: PlanId = 'standard'

/** Plans payants (accès complet aux fonctionnalités) */
export const PAID_PLANS: PlanId[] = ['pro', 'ultime']

/**
 * Vérifie si l'utilisateur a un plan payant confirmé (payé via Stripe ou code promo).
 * Un plan pro/ultime n'est pas confirmé tant que l'utilisateur n'a pas payé ou utilisé un code promo.
 */
export function isPaidPlan(
  plan: PlanId | undefined | null,
  subscriptionSource?: 'stripe' | 'promo' | null
): boolean {
  if (!plan || !PAID_PLANS.includes(plan)) return false
  // Plan pro/ultime n'est confirmé que si payé (stripe) ou code promo (promo)
  if (subscriptionSource === 'stripe' || subscriptionSource === 'promo') return true
  return false
}

export function isFreePlan(
  plan: PlanId | undefined | null,
  subscriptionSource?: 'stripe' | 'promo' | null
): boolean {
  return !isPaidPlan(plan, subscriptionSource)
}

/**
 * Accès aux pages / fonctionnalités selon le plan
 */
export type PlanContext = {
  plan?: PlanId | null
  subscriptionSource?: 'stripe' | 'promo' | null
}

export const PLAN_FEATURES = {
  /** Accès à la page Analytics */
  analytics: (plan: PlanId | undefined | null, source?: 'stripe' | 'promo' | null) =>
    isPaidPlan(plan, source),

  /** Accès à la page Alerte (pro/ultime uniquement) */
  alerte: (plan: PlanId | undefined | null, source?: 'stripe' | 'promo' | null) =>
    isPaidPlan(plan, source),

  /** Accès à la page Paiements (tous peuvent voir et upgrader) */
  payments: () => true,

  /** Scrapings: standard = 6 max, pro/ultime confirmé = illimité */
  scrapingLimit: (plan: PlanId | undefined | null, source?: 'stripe' | 'promo' | null) =>
    isPaidPlan(plan, source) ? Infinity : 6,

  /** Alertes (sites surveillés) : standard/gratuit = 0, pro = 3, ultime = illimité */
  alertLimit: (plan: PlanId | undefined | null, source?: 'stripe' | 'promo' | null): number => {
    if (!isPaidPlan(plan, source)) return 0
    if (plan === 'ultime') return Infinity
    if (plan === 'pro') return 3
    return 0
  },
} as const

export function canAccessAnalytics(
  plan: PlanId | undefined | null,
  subscriptionSource?: 'stripe' | 'promo' | null
): boolean {
  return PLAN_FEATURES.analytics(plan, subscriptionSource)
}

export function canAccessOrganisation(
  plan: PlanId | undefined | null,
  subscriptionSource?: 'stripe' | 'promo' | null
): boolean {
  return PLAN_FEATURES.alerte(plan, subscriptionSource)
}

/**
 * Retourne le nombre maximum d'alertes pour un plan donné.
 * -1 ou Infinity = illimité.
 */
export function getAlertLimit(
  plan: PlanId | undefined | null,
  subscriptionSource?: 'stripe' | 'promo' | null
): number {
  return PLAN_FEATURES.alertLimit(plan, subscriptionSource)
}
