# Configuration Stripe

## Variables d'environnement requises

Ajoutez les variables suivantes dans votre fichier `.env.local` (dans le dossier `dashboard_web/`) :

```env
# Clé secrète Stripe (obtenue depuis le dashboard Stripe)
STRIPE_SECRET_KEY=sk_test_... ou sk_live_...

# Price IDs Stripe pour chaque plan (obtenus depuis le dashboard Stripe > Products)
STRIPE_PRICE_ID_PRO=price_...
STRIPE_PRICE_ID_ULTIME=price_...

# Secret du webhook Stripe (pour recevoir les événements de paiement)
STRIPE_WEBHOOK_SECRET=whsec_...

# URL de votre application (pour les redirections après paiement)
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

## Étapes de configuration

### 1. Créer un compte Stripe

1. Allez sur [https://stripe.com](https://stripe.com)
2. Créez un compte ou connectez-vous
3. Accédez au **Dashboard Stripe**

### 2. Récupérer la clé secrète (STRIPE_SECRET_KEY)

1. Dans le dashboard Stripe, allez dans **Developers** > **API keys**
2. Copiez la **Secret key** (commence par `sk_test_` en mode test ou `sk_live_` en production)
3. Ajoutez-la dans `.env.local` :
   ```env
   STRIPE_SECRET_KEY=sk_test_votre_cle_secrete
   ```

### 3. Créer les produits et prix dans Stripe

1. Allez dans **Products** dans le dashboard Stripe
2. Créez deux produits :
   - **Pro** : Plan Pro à 199,99$/mois
   - **Ultime** : Plan Ultime à 274,99$/mois
3. Pour chaque produit, créez un prix récurrent mensuel
4. Copiez les **Price IDs** (commencent par `price_`)
5. Ajoutez-les dans `.env.local` :
   ```env
   STRIPE_PRICE_ID_PRO=price_xxxxx
   STRIPE_PRICE_ID_ULTIME=price_xxxxx
   ```

### 4. Configurer le webhook Stripe

1. Dans le dashboard Stripe, allez dans **Developers** > **Webhooks**
2. Cliquez sur **Add endpoint**
3. Entrez l'URL de votre webhook : `https://votre-domaine.com/api/stripe/webhook`
4. Sélectionnez les événements à écouter :
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.paid`
   - `invoice.payment_failed`
5. Copiez le **Signing secret** (commence par `whsec_`)
6. Ajoutez-le dans `.env.local` :
   ```env
   STRIPE_WEBHOOK_SECRET=whsec_votre_secret
   ```

### 5. Mode test vs Production

- **Mode test** : Utilisez les clés commençant par `sk_test_` et `pk_test_`
- **Mode production** : Utilisez les clés commençant par `sk_live_` et `pk_live_`

⚠️ **Important** : Ne commitez jamais vos clés secrètes dans Git ! Le fichier `.env.local` doit être dans `.gitignore`.

## Vérification

Après avoir configuré les variables, redémarrez votre serveur de développement :

```bash
cd dashboard_web
npm run dev
```

L'erreur "Stripe is not configured" ne devrait plus apparaître.
