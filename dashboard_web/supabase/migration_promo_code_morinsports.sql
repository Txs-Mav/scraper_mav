-- Migration : code magique de la campagne individuelle « Morin Sports ».
-- Ce code pilote la page publique go-data.co/morinsports (démo personnalisée,
-- référent verrouillé sur Morin Sports, Trois-Rivières) : le toggle
-- actif/désactivé de /admin/campagnes coupe ou rouvre la page.
-- Code de gate uniquement (DEMO_GATE_CODES) : refusé par validate/signup/apply.
-- Idempotente : ne fait rien si le code existe déjà.

INSERT INTO promo_codes (code, description, is_active, max_uses)
VALUES ('MORINSPORTS', 'Morin Sports — page personnalisée', true, NULL)
ON CONFLICT (code) DO NOTHING;
