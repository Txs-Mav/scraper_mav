# Configuration Stripe en Production - Guide Complet

Ce guide explique étape par étape comment configurer Stripe en mode production pour votre application Go-Data.

## 📋 Prérequis

- ✅ Compte Stripe (ou créer un compte si nécessaire)
- ✅ Application déployée sur Vercel
- ✅ Accès au Dashboard Vercel pour les variables d'environnement

---

## 🎯 Plan d'Action Complet

### Étape 1 : Créer/Accéder à votre Compte Stripe

1. **Allez sur Stripe**
   - Ouvrez [stripe.com](https://stripe.com)
   - Cliquez sur **"Sign in"** (si vous avez un compte)
   - Ou cliquez sur **"Start now"** pour créer un compte

2. **Si vous créez un nouveau compte** :
   - Remplissez le formulaire (email, mot de passe, etc.)
   - Vérifiez votre email
   - Complétez les informations de votre entreprise/activité
   - ⚠️ Stripe demandera des informations légales (nom, adresse, etc.)

---

### Étape 2 : Activer le Mode Production

**Important** : Par défaut, Stripe démarre en mode **Test**. Pour la production :

1. **Dans le Dashboard Stripe**
   - En haut à droite, vous verrez un toggle **"Test mode"** / **"Live mode"**
   - Cliquez sur le toggle pour passer en **"Live mode"**
   - ⚠️ **Note** : Pour activer le mode Live, vous devrez peut-être compléter la vérification de votre compte

2. **Vérification du compte (si nécessaire)**
   - Stripe peut demander des informations supplémentaires :
     - Informations sur votre entreprise
     - Informations bancaires (pour recevoir les paiements)
     - Vérification d'identité
   - Suivez les instructions de Stripe pour compléter la vérification

---

### Étape 3 : Récupérer les Clés API de Production

1. **Dans le Dashboard Stripe**
   - Assurez-vous d'être en **"Live mode"** (pas "Test mode")
   - Allez dans **"Developers"** (dans le menu de gauche)
   - Cliquez sur **"API keys"**

2. **Récupérer les clés**
   - Vous verrez deux sections :
     - **Publishable key** (clé publique) : Commence par `pk_live_...`
     - **Secret key** (clé secrète) : Commence par `sk_live_...`
     - ⚠️ **Important** : En mode Live, les clés commencent par `pk_live_` et `sk_live_` (pas `pk_test_` ou `sk_test_`)

3. **Copier les clés**
   - **Secret key** : Cliquez sur **"Reveal test key"** ou **"Reveal live key"** pour voir la clé
   - Copiez la **Secret key** (commence par `sk_live_...`)
   - ⚠️ **Sécurité** : Cette clé est SECRÈTE, ne la partagez jamais publiquement
   - Vous pouvez aussi copier la **Publishable key** si nécessaire (commence par `pk_live_...`)

---

### Étape 4 : Configurer Stripe dans Vercel

1. **Accédez au Dashboard Vercel**
   - Allez sur [vercel.com](https://vercel.com)
   - Connectez-vous
   - Ouvrez votre projet **"go-data-dashboard"**

2. **Ajouter la variable d'environnement**
   - Allez dans **"Settings"** → **"Environment Variables"**
   - Cliquez sur **"Add New"**
   - Remplissez :
     - **Key** : `STRIPE_SECRET_KEY`
     - **Value** : Collez votre clé secrète Stripe (ex: `sk_live_51AbCdEf...`)
     - **Environments** : Cochez ✅ **Production**, ✅ **Preview**, ✅ **Development**
   - Cliquez sur **"Save"**

3. **Vérification**
   - Vérifiez que la variable `STRIPE_SECRET_KEY` apparaît dans la liste
   - Vérifiez qu'elle est cochée pour Production, Preview et Development

---

### Étape 5 : Configurer les Webhooks Stripe (Optionnel mais Recommandé)

Les webhooks permettent à Stripe de notifier votre application des événements (paiements, abonnements, etc.).

1. **Dans le Dashboard Stripe**
   - Allez dans **"Developers"** → **"Webhooks"**
   - Cliquez sur **"Add endpoint"**

2. **Configurer l'endpoint**
   - **Endpoint URL** : `https://go-data-dashboard.vercel.app/api/stripe/webhook`
     - Ou votre domaine personnalisé : `https://votre-domaine.com/api/stripe/webhook`
   - **Description** : "Go-Data Webhooks" (ou autre description)
   - **Events to send** : Sélectionnez les événements :
     - ✅ `customer.subscription.created`
     - ✅ `customer.subscription.updated`
     - ✅ `customer.subscription.deleted`
     - ✅ `invoice.paid`
     - ✅ `invoice.payment_failed`
   - Cliquez sur **"Add endpoint"**

3. **Récupérer le secret du webhook**
   - Une fois l'endpoint créé, cliquez dessus
   - Dans la section **"Signing secret"**, cliquez sur **"Reveal"**
   - Copiez le secret (commence par `whsec_...`)

4. **Ajouter le secret dans Vercel**
   - Retournez dans Vercel → **Settings** → **Environment Variables**
   - Cliquez sur **"Add New"**
   - Remplissez :
     - **Key** : `STRIPE_WEBHOOK_SECRET`
     - **Value** : Collez le secret du webhook (ex: `whsec_...`)
     - **Environments** : Cochez ✅ **Production**, ✅ **Preview**, ✅ **Development**
   - Cliquez sur **"Save"**

---

### Étape 6 : Créer les Produits et Prix dans Stripe

1. **Dans le Dashboard Stripe**
   - Allez dans **"Products"** (dans le menu de gauche)
   - Cliquez sur **"Add product"**

2. **Créer le produit "Standard Plan"**
   - **Name** : "Standard Plan" (ou "Go-Data Standard")
   - **Description** : Description de votre plan standard
   - **Pricing** :
     - **Pricing model** : Standard pricing
     - **Price** : Entrez le montant (ex: 29.99)
     - **Billing period** : Recurring → Monthly (ou Annual)
   - Cliquez sur **"Save product"**
   - ⚠️ **Notez l'ID du prix** : Il commence par `price_...` (vous en aurez besoin)

3. **Créer le produit "Premium Plan"**
   - Répétez les mêmes étapes
   - **Name** : "Premium Plan" (ou "Go-Data Premium")
   - **Price** : Montant du plan premium (ex: 99.99)
   - ⚠️ **Notez l'ID du prix** : Il commence par `price_...`

4. **Notez les IDs de prix**
   - Pour chaque produit, copiez l'**ID du prix** (commence par `price_...`)
   - Vous en aurez besoin pour mettre à jour votre code

---

### Étape 7 : Mettre à jour le Code avec les IDs de Prix (Optionnel)

Si vous voulez utiliser les vrais IDs de prix Stripe dans votre application :

1. **Trouver où les prix sont utilisés**
   - Ouvrez `src/app/dashboard/settings/page.tsx`
   - Cherchez les appels à `handleStripeCheckout`

2. **Mettre à jour les IDs**
   - Remplacez les placeholders par les vrais IDs de prix Stripe
   - Exemple :
     ```typescript
     // Avant
     onClick={() => handleStripeCheckout("price_standard")}
     
     // Après (avec le vrai ID)
     onClick={() => handleStripeCheckout("price_1AbCdEfGhIjKlMn")}
     ```

---

### Étape 8 : Redéployer l'Application

1. **Dans Vercel**
   - Allez dans **"Deployments"**
   - Trouvez le dernier déploiement
   - Cliquez sur les **trois points** (⋯) → **"Redeploy"**
   - Ou utilisez la CLI : `vercel --prod`

2. **Vérifier le déploiement**
   - Attendez que le build se termine
   - Vérifiez que le statut est **"Ready"** (✓)
   - Vérifiez les logs pour confirmer qu'il n'y a plus d'erreurs Stripe

---

### Étape 9 : Tester Stripe

1. **Tester un paiement**
   - Allez sur votre application
   - Essayez de créer une session de paiement (selon votre interface)
   - Vous devriez être redirigé vers Stripe Checkout

2. **Utiliser les cartes de test Stripe**
   - Même en mode Live, vous pouvez tester avec des cartes spécifiques
   - Consultez la [documentation Stripe sur les cartes de test](https://stripe.com/docs/testing)

3. **Vérifier les webhooks**
   - Dans Stripe → **Developers** → **Webhooks**
   - Vérifiez que les événements sont reçus
   - Vérifiez les logs pour confirmer que les webhooks fonctionnent

---

## 📝 Checklist Complète

- [ ] Compte Stripe créé/accédé
- [ ] Mode Live activé dans Stripe
- [ ] Compte Stripe vérifié (si nécessaire)
- [ ] Clé secrète Live récupérée (`sk_live_...`)
- [ ] `STRIPE_SECRET_KEY` ajoutée dans Vercel (mode Production)
- [ ] Webhook endpoint créé dans Stripe (optionnel)
- [ ] `STRIPE_WEBHOOK_SECRET` ajoutée dans Vercel (si webhook configuré)
- [ ] Produits créés dans Stripe (Standard, Premium)
- [ ] IDs de prix notés (`price_...`)
- [ ] Code mis à jour avec les IDs de prix (optionnel)
- [ ] Application redéployée sur Vercel
- [ ] Déploiement réussi (statut "Ready")
- [ ] Test de paiement effectué
- [ ] Webhooks testés (si configurés)

---

## 🔐 Sécurité et Bonnes Pratiques

### Clés API
- ⚠️ **Ne partagez JAMAIS** votre clé secrète (`sk_live_...`) publiquement
- ✅ Stockez-la uniquement dans les variables d'environnement Vercel
- ✅ Ne la commitez jamais dans Git
- ✅ Utilisez des clés différentes pour Test et Production

### Webhooks
- ✅ Utilisez toujours HTTPS pour les webhooks
- ✅ Vérifiez la signature du webhook (déjà fait dans le code)
- ✅ Ne traitez que les événements que vous avez configurés

### Mode Test vs Production
- 🔵 **Mode Test** : Pour développer et tester
  - Clés commencent par `pk_test_` et `sk_test_`
  - Les paiements ne sont pas réels
- 🟢 **Mode Production** : Pour les vrais paiements
  - Clés commencent par `pk_live_` et `sk_live_`
  - Les paiements sont réels et vous recevez de l'argent

---

## 🐛 Dépannage

### L'erreur Stripe persiste après configuration

1. **Vérifiez la clé**
   - Allez dans Vercel → Settings → Environment Variables
   - Vérifiez que `STRIPE_SECRET_KEY` est présente
   - Vérifiez qu'il n'y a pas d'espaces avant/après
   - Vérifiez que la clé commence par `sk_live_` (ou `sk_test_`)

2. **Redéployez**
   - Après avoir ajouté la variable, vous DEVEZ redéployer
   - Les variables ne sont pas appliquées aux déploiements existants

3. **Vérifiez les logs**
   - Dans Vercel → Deployments → dernier déploiement → Build Logs
   - Cherchez les erreurs Stripe

### Les paiements ne fonctionnent pas

1. **Vérifiez le mode Stripe**
   - Assurez-vous d'utiliser les bonnes clés (Live pour production, Test pour développement)

2. **Vérifiez les IDs de prix**
   - Vérifiez que les IDs de prix dans votre code correspondent aux vrais IDs Stripe
   - Les IDs doivent commencer par `price_`

3. **Vérifiez les logs Stripe**
   - Dans Stripe → Developers → Logs
   - Cherchez les erreurs de requêtes

### Les webhooks ne fonctionnent pas

1. **Vérifiez l'URL du webhook**
   - Dans Stripe → Developers → Webhooks
   - Vérifiez que l'URL est correcte
   - Vérifiez que l'URL est accessible (HTTPS)

2. **Vérifiez le secret**
   - Vérifiez que `STRIPE_WEBHOOK_SECRET` est configurée dans Vercel
   - Vérifiez que le secret correspond à celui dans Stripe

3. **Vérifiez les événements**
   - Dans Stripe → Developers → Webhooks → votre endpoint
   - Vérifiez que les événements sont envoyés
   - Vérifiez les logs pour voir les erreurs

---

## 📚 Ressources

- [Documentation Stripe - Getting Started](https://stripe.com/docs/payments/quickstart)
- [Documentation Stripe - Webhooks](https://stripe.com/docs/webhooks)
- [Dashboard Stripe](https://dashboard.stripe.com)
- [Stripe Testing Cards](https://stripe.com/docs/testing)
- [Vercel Environment Variables](https://vercel.com/docs/concepts/projects/environment-variables)

---

## ✅ Une fois terminé

Votre application devrait avoir :
- ✅ Stripe configuré en mode Production
- ✅ Clés API configurées dans Vercel
- ✅ Webhooks configurés (si nécessaire)
- ✅ Produits créés dans Stripe
- ✅ Application capable de recevoir des paiements réels

---

## 💡 Note sur le Mode Test

Si vous voulez d'abord tester avant de passer en production :

1. Utilisez le **mode Test** de Stripe
2. Utilisez les clés qui commencent par `pk_test_` et `sk_test_`
3. Testez tous les flux de paiement
4. Une fois satisfait, passez en mode **Live** et utilisez les clés `pk_live_` et `sk_live_`
