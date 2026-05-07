/**
 * Types TypeScript pour les utilisateurs et employés
 */

import type { BusinessType } from "@/lib/account-navigation"

export interface User {
    id: string
    name: string
    email: string
    /**
     * Email vérifié de Supabase Auth (auth.users.email). Source canonique
     * pour les contrôles d'accès admin — ne JAMAIS utiliser `email` (qui
     * vient de public.users et peut diverger). Présent uniquement quand
     * l'objet est construit côté serveur via `getCurrentUser()`.
     */
    auth_email?: string | null
    role: 'main' | 'developer' | 'employee' | 'user' | 'owner' | 'member'
    subscription_plan?: 'standard' | 'pro' | 'ultime'
    /** Source de l'abonnement : stripe = payé, promo = code promo. Si null, plan non confirmé. */
    subscription_source?: 'stripe' | 'promo' | null
    business_type?: BusinessType | null
    stripe_customer_id?: string | null
    avatar_url?: string | null
    main_account_id?: string | null // Pour les employés
    promo_code_id?: string | null
    pending_plan?: 'pro' | 'ultime' | null // Plan payant en attente de paiement
    created_at: string
    updated_at: string
}

export interface Employee {
    id: string
    main_account_id: string
    employee_id: string
    role: string
    permissions: string[]
    created_at: string
    updated_at: string
}

export interface Subscription {
    id: string
    user_id: string
    plan: 'standard' | 'pro' | 'ultime'
    status: 'active' | 'cancelled' | 'expired'
    started_at: string
    expires_at?: string | null
    created_at: string
    updated_at: string
}

export interface Scraping {
    id: string
    user_id: string
    reference_url: string
    competitor_urls: string[]
    products: any[] // JSONB
    metadata: any // JSONB
    scraping_time_seconds?: number | null
    mode?: string | null
    created_at: string
    updated_at: string
}


