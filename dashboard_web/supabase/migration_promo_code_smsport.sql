-- Migration : code magique de la campagne individuelle « SM Sport ».
-- Ce code pilote la page publique go-data.co/smsport (démo personnalisée
-- pour Dave, référent verrouillé sur SM Sport) : le toggle actif/désactivé
-- de /admin/campagnes coupe ou rouvre la page.
-- Idempotente : ne fait rien si le code existe déjà.

INSERT INTO promo_codes (code, description, is_active, max_uses)
VALUES ('SMSPORT', 'SM Sport — page personnalisée (Dave)', true, NULL)
ON CONFLICT (code) DO NOTHING;
