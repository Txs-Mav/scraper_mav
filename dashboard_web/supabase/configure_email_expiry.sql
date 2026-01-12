-- Configuration de l'expiration du lien de confirmation email à 24 heures
-- À exécuter dans l'éditeur SQL de Supabase
-- IMPORTANT: Cette configuration peut varier selon la version de Supabase

-- Méthode 1: Configuration via la table auth.config (si disponible)
-- Note: Cette table peut ne pas exister dans toutes les versions de Supabase
-- Dans ce cas, utilisez la méthode 2 (via le Dashboard)

DO $$
BEGIN
    -- Vérifier si la table auth.config existe
    IF EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'auth' 
        AND table_name = 'config'
    ) THEN
        -- Mettre à jour l'expiration du token de confirmation email à 24h (86400 secondes)
        UPDATE auth.config 
        SET email_confirmation_token_expiry = 86400 
        WHERE id = 1;
        
        -- Si la ligne n'existe pas, l'insérer
        IF NOT FOUND THEN
            INSERT INTO auth.config (id, email_confirmation_token_expiry)
            VALUES (1, 86400);
        END IF;
        
        RAISE NOTICE 'Configuration de l''expiration du token de confirmation email mise à jour à 24 heures (86400 secondes)';
    ELSE
        RAISE NOTICE 'La table auth.config n''existe pas. Veuillez configurer l''expiration via le Dashboard Supabase.';
    END IF;
END $$;

-- Méthode alternative: Via les settings du projet
-- Cette configuration doit généralement être faite via le Dashboard Supabase
-- Allez dans: Authentication > Settings > Email Auth
-- Cherchez "Email confirmation token expiry" ou "JWT expiry" et définissez à 86400 secondes (24h)

-- Vérification (optionnel)
-- SELECT * FROM auth.config WHERE id = 1;

