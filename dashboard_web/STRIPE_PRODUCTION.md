# Configuration Stripe pour la Production

## Différences entre Test et Production

### Mode Test (Développement)
- Clés commencent par `sk_test_` et `pk_test_`
- Paiements simulés (cartes de test)
- Pas de vrais paiements
- Utilisé pour le développement local

### Mode Production
- Clés commencent par `sk_live_` et `pk_live_`
- **VRAIS paiements** - attention !
- Transactions réelles avec de l'argent réel
- Utilisé pour l'application en production

## Configuration pour la Production

### 1. Activer le mode Live dans Stripe

1. Connectez-vous au [Dashboard Stripe](https://dashboard.stripe.com)
2. En haut à droite, basculez de **Test mode** à **Live mode** (toggle)
3. ⚠️ **Attention** : Vous êtes maintenant en mode production !

### 2. Récupérer les clés de production

#### STRIPE_SECRET_KEY (Production)
1. Dans le dashboard Stripe (mode Live), allez dans **Developers** > **API keys**
2. Copiez la **Secret key** (commence par `sk_live_...`)
3. ⚠️ **Ne la partagez JAMAIS** - c'est comme un mot de passe bancaire

#### STRIPE_PRICE_ID_PRO et STRIPE_PRICE_ID_ULTIME
1. En mode **Live**, allez dans **Products**
2. Créez les mêmes produits que en test (ou utilisez les existants)
3. Créez les prix récurrents mensuels
4. Copiez les **Price IDs** (commencent par `price_...`)
5. ⚠️ **Important** : Les Price IDs de test sont différents de ceux de production

#### STRIPE_WEBHOOK_SECRET (Production)
1. En mode **Live**, allez dans **Developers** > **Webhooks**
2. Créez un nouveau endpoint avec l'URL de production : `https://votre-domaine.com/api/stripe/webhook`
3. Sélectionnez les mêmes événements :
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.paid`
   - `invoice.payment_failed`
4. Copiez le **Signing secret** (commence par `whsec_...`)

#### NEXT_PUBLIC_APP_URL
Utilisez l'URL de votre domaine de production :
```env
NEXT_PUBLIC_APP_URL=https://votre-domaine.com
```

### 3. Où configurer les variables en production

#### Option A : Variables d'environnement du serveur (Recommandé)

**Vercel :**
1. Allez dans votre projet Vercel
2. **Settings** > **Environment Variables**
3. Ajoutez chaque variable :
   - `STRIPE_SECRET_KEY` = `sk_live_...`
   - `STRIPE_PRICE_ID_PRO` = `price_...`
   - `STRIPE_PRICE_ID_ULTIME` = `price_...`
   - `STRIPE_WEBHOOK_SECRET` = `whsec_...`
   - `NEXT_PUBLIC_APP_URL` = `https://votre-domaine.com`

**Netlify :**
1. **Site settings** > **Environment variables**
2. Ajoutez les mêmes variables

**Autres hébergeurs :**
- Configurez les variables d'environnement selon la documentation de votre hébergeur
- Ne les mettez JAMAIS dans le code source

#### Option B : Fichier .env.production (si hébergé vous-même)

Créez un fichier `.env.production` (ne le commitez JAMAIS) :

```env
# ⚠️ PRODUCTION - VRAIS PAIEMENTS
STRIPE_SECRET_KEY=sk_live_votre_cle_secrete_production
STRIPE_PRICE_ID_PRO=price_xxxxx_production
STRIPE_PRICE_ID_ULTIME=price_xxxxx_production
STRIPE_WEBHOOK_SECRET=whsec_votre_secret_production
NEXT_PUBLIC_APP_URL=https://votre-domaine.com
```

## Checklist de Production

- [ ] Mode Live activé dans Stripe
- [ ] Clés de production récupérées (`sk_live_...`)
- [ ] Produits et prix créés en mode Live
- [ ] Price IDs de production copiés
- [ ] Webhook de production configuré avec l'URL correcte
- [ ] Variables d'environnement configurées sur l'hébergeur
- [ ] `NEXT_PUBLIC_APP_URL` pointe vers le domaine de production
- [ ] Testé avec une vraie carte (petit montant) avant le lancement

## Sécurité en Production

### ⚠️ RÈGLES D'OR

1. **Ne commitez JAMAIS les clés de production**
   - Vérifiez que `.env.local` et `.env.production` sont dans `.gitignore`

2. **Utilisez des variables d'environnement**
   - Ne mettez jamais les clés directement dans le code

3. **Limitez l'accès aux clés**
   - Seules les personnes autorisées doivent avoir accès
   - Utilisez un gestionnaire de secrets (Vercel, AWS Secrets Manager, etc.)

4. **Surveillez les transactions**
   - Activez les alertes Stripe pour les transactions suspectes
   - Vérifiez régulièrement le dashboard Stripe

5. **Testez d'abord en mode test**
   - Testez complètement en mode test avant de passer en production
   - Utilisez les [cartes de test Stripe](https://stripe.com/docs/testing)

## Exemple de configuration complète

### Développement (.env.local)
```env
STRIPE_SECRET_KEY=sk_test_51AbC123...
STRIPE_PRICE_ID_PRO=price_test_123...
STRIPE_PRICE_ID_ULTIME=price_test_456...
STRIPE_WEBHOOK_SECRET=whsec_test_789...
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

### Production (Variables d'environnement du serveur)
```env
STRIPE_SECRET_KEY=sk_live_51XyZ789...
STRIPE_PRICE_ID_PRO=price_live_abc...
STRIPE_PRICE_ID_ULTIME=price_live_def...
STRIPE_WEBHOOK_SECRET=whsec_live_ghi...
NEXT_PUBLIC_APP_URL=https://votre-domaine.com
```

## Vérification

Après configuration, testez avec une vraie carte (petit montant) :
1. Créez un compte de test
2. Sélectionnez un plan payant
3. Utilisez une vraie carte de test Stripe
4. Vérifiez que le paiement fonctionne
5. Vérifiez que le webhook reçoit les événements

## Support

- [Documentation Stripe](https://stripe.com/docs)
- [Dashboard Stripe](https://dashboard.stripe.com)
- [Support Stripe](https://support.stripe.com)
