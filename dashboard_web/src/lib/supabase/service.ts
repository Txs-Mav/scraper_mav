/**
 * Client Supabase service role (bypasse RLS) pour opérations serveur sécurisées.
 * Nécessite la variable d'environnement SUPABASE_SERVICE_ROLE_KEY.
 */
import { createClient } from "@supabase/supabase-js"

const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL

if (!supabaseUrl) {
  throw new Error("NEXT_PUBLIC_SUPABASE_URL manquant pour le client service Supabase.")
}

if (!serviceRoleKey) {
  throw new Error("SUPABASE_SERVICE_ROLE_KEY manquant pour le client service Supabase.")
}

export const createServiceClient = () =>
  createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })

