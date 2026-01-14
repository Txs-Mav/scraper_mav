# Configuration Stripe

## Problème actuel

L'erreur "Unexpected token '<', "<!DOCTYPE "... is not valid JSON" se produit car Stripe n'est pas configuré. L'endpoint retourne une page d'erreur HTML au lieu de JSON.

## Solution : Configurer Stripe

### 1. Créer un compte Stripe (si vous n'en avez pas)

1. Allez sur https://stripe.com
2. Créez un compte
3. Accédez au Dashboard Stripe

### 2. Récupérer les clés API

1. Dans le Dashboard Stripe, allez dans **Developers** > **API keys**
2. Vous verrez deux clés :
   - **Publishable key** (commence par `pk_test_` ou `pk_live_`)
   - **Secret key** (commence par `sk_test_` ou `sk_live_`)

### 3. Configurer les variables d'environnement

Créez un fichier `.env.local` à la racine du projet (s'il n'existe pas déjà) et ajoutez :

```env
# Stripe Configuration
STRIPE_SECRET_KEY=sk_test_votre_cle_secrete_ici
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_votre_cle_publique_ici

# Optionnel : pour les webhooks Stripe
STRIPE_WEBHOOK_SECRET=whsec_votre_secret_webhook_ici

# URL de l'application (pour les callbacks)
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

### 4. Créer les produits et prix dans Stripe

1. Dans le Dashboard Stripe, allez dans **Products**
2. Créez les produits pour vos plans :
   - **Free** (gratuit, pas besoin de créer dans Stripe)
   - **Standard** : Créez un produit "Standard Plan"
   - **Premium** : Créez un produit "Premium Plan"

3. Pour chaque produit payant :
   - Cliquez sur le produit
   - Ajoutez un prix (recurring/monthly ou annual)
   - Copiez l'ID du prix (commence par `price_`)

### 5. Mettre à jour le code avec les IDs de prix

Dans `src/app/dashboard/settings/page.tsx`, remplacez les placeholders :

```typescript
// Ligne ~764, remplacez :
onClick={() => handleStripeCheckout("price_standard")}

// Par le vrai ID de prix Stripe, par exemple :
onClick={() => handleStripeCheckout("price_1234567890abcdef")}
```

### 6. Redémarrer le serveur de développement

Après avoir ajouté les variables d'environnement :

```bash
# Arrêtez le serveur (Ctrl+C)
# Puis redémarrez
npm run dev
```

## Mode Test vs Production

- **Mode Test** : Utilisez les clés qui commencent par `sk_test_` et `pk_test_`
- **Mode Production** : Utilisez les clés qui commencent par `sk_live_` et `pk_live_`

⚠️ **Important** : Ne commitez jamais vos clés secrètes dans Git ! Le fichier `.env.local` doit être dans `.gitignore`.

## Vérification

Une fois configuré, l'erreur devrait disparaître et vous pourrez :
- Cliquer sur "Upgrade" pour créer une session Checkout Stripe
- Gérer l'abonnement via le Stripe Customer Portal

## Configuration du webhook Stripe (optionnel)

Pour synchroniser automatiquement les abonnements :

1. Dans Stripe Dashboard, allez dans **Developers** > **Webhooks**
2. Cliquez sur **Add endpoint**
3. URL : `https://votre-domaine.com/api/stripe/webhook`
4. Sélectionnez les événements :
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.paid`
   - `invoice.payment_failed`
5. Copiez le **Signing secret** et ajoutez-le dans `.env.local` comme `STRIPE_WEBHOOK_SECRET`

