# Gestion des Codes Promo

## Comportement lors de la désactivation d'un code promo

### Ce qui se passe actuellement

Quand vous désactivez un code promo dans la base de données :

1. **Nouveaux utilisateurs** : Ne pourront plus utiliser ce code promo
2. **Utilisateurs existants avec ce code** : 
   - **Conservent leur plan actuel** (gratuit) tant qu'ils ne changent pas de plan
   - **Lors du prochain changement de plan** : Le système détecte que le code est désactivé et rétrograde automatiquement l'utilisateur au plan standard

### Comment désactiver un code promo

#### Option 1 : Via SQL (Recommandé)

Exécutez cette requête dans l'éditeur SQL de Supabase :

```sql
-- Désactiver un code promo spécifique
UPDATE promo_codes 
SET 
  is_active = false, 
  deactivated_at = NOW() 
WHERE code = 'PROMO2024-XXXXXX';
```

#### Option 2 : Rétrograder immédiatement tous les utilisateurs

Si vous voulez rétrograder immédiatement tous les utilisateurs qui utilisent un code désactivé :

```sql
-- Exécuter le script de révocation
-- Voir: supabase/revoke_disabled_promo_codes.sql
```

### Rétrograder automatiquement les utilisateurs

Pour rétrograder automatiquement tous les utilisateurs dont le code promo a été désactivé :

1. **Exécuter le script SQL** : `supabase/revoke_disabled_promo_codes.sql`
2. **Ou utiliser l'API** : `/api/promo-codes/revoke` (nécessite l'ID utilisateur)

### Vérifier le statut d'un code promo

Pour voir quels utilisateurs utilisent un code promo :

```sql
SELECT 
  u.id,
  u.email,
  u.name,
  u.subscription_plan,
  pc.code,
  pc.is_active,
  pc.current_uses
FROM users u
JOIN promo_codes pc ON u.promo_code_id = pc.id
WHERE pc.code = 'PROMO2024-XXXXXX';
```

### Comportement détaillé

#### Scénario 1 : Code promo désactivé, utilisateur ne change pas de plan
- ✅ L'utilisateur **garde son plan actuel** (gratuit)
- ⚠️ Le plan reste actif jusqu'à ce que l'utilisateur tente de changer de plan

#### Scénario 2 : Code promo désactivé, utilisateur change de plan
- 🔄 Le système détecte que le code est désactivé
- 📉 L'utilisateur est **automatiquement rétrogradé au plan standard**
- 🔒 Le code promo est retiré de son compte
- 💳 Si l'utilisateur veut un plan payant, il devra payer via Stripe

#### Scénario 3 : Rétrogradation manuelle
- Exécutez le script `revoke_disabled_promo_codes.sql`
- Tous les utilisateurs avec des codes désactivés sont rétrogradés immédiatement

### Recommandations

1. **Avant de désactiver un code** : Informez les utilisateurs concernés
2. **Après désactivation** : Exécutez le script de révocation pour rétrograder immédiatement
3. **Surveillance** : Vérifiez régulièrement les codes promo actifs

### API disponible

- `GET /api/promo-codes/check-status` : Vérifier le statut du code promo de l'utilisateur connecté
- `POST /api/promo-codes/revoke` : Révoquer manuellement un code promo pour un utilisateur
