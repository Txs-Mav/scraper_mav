/**
 * Types TypeScript pour les utilisateurs et employés
 */

export interface User {
    id: string
    name: string
    email: string
    role: 'main' | 'employee' | 'user' | 'owner' | 'member'
    subscription_plan?: 'standard' | 'pro' | 'ultime'
    /** Source de l'abonnement : stripe = payé, promo = code promo. Si null, plan non confirmé. */
    subscription_source?: 'stripe' | 'promo' | null
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


