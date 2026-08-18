-- Migration : code magique de la campagne individuelle « Moto Falardeau ».
-- Ce code pilote la page publique go-data.co/falardeau (démo personnalisée
-- pour Miguel, référent verrouillé sur Moto Falardeau) : le toggle
-- actif/désactivé de /admin/campagnes coupe ou rouvre la page.
-- Idempotente : ne fait rien si le code existe déjà.

INSERT INTO promo_codes (code, description, is_active, max_uses)
VALUES ('FALARDEAU', 'Moto Falardeau — page personnalisée (Miguel)', true, NULL)
ON CONFLICT (code) DO NOTHING;
