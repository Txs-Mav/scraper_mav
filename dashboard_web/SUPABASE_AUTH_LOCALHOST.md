# Configuration Supabase Auth pour localhost

## Problème : Impossible de se connecter après création de compte

### Cause

Supabase exige par défaut la **confirmation de l'email** avant de pouvoir se connecter. Il faut cliquer sur le lien dans l'email de confirmation.

### Solution 1 : Confirmer l'email

1. Vérifiez votre boîte mail (et les spams)
2. Cliquez sur le lien de confirmation dans l'email de Supabase
3. Vous serez redirigé vers l'app et connecté automatiquement

### Solution 2 : Redirection vers localhost

Pour que le lien de confirmation redirige vers **localhost** (et non la prod) :

1. Aller dans **Supabase Dashboard** → **Project Settings** → **Auth**
2. Section **URL Configuration**
3. **Redirect URLs** : ajouter `http://localhost:3000/auth/callback`
4. **Site URL** (optionnel pour dev) : `http://localhost:3000`

### Solution 3 : Désactiver la confirmation (développement uniquement)

Pour tester sans confirmation d'email :

1. **Supabase Dashboard** → **Project Settings** → **Auth**
2. Décocher **Enable email confirmations**
3. Les nouveaux comptes pourront se connecter immédiatement

⚠️ Ne pas désactiver en production.
