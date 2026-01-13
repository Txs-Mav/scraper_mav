# Configuration des Variables d'Environnement sur Vercel

Ce guide explique étape par étape comment configurer les variables d'environnement nécessaires pour déployer votre application Go-Data sur Vercel.

## 📋 Prérequis

- ✅ Compte Vercel configuré
- ✅ Projet Supabase créé
- ✅ Compte Stripe (optionnel, seulement si vous utilisez les paiements)

---

## 🎯 Plan d'Action Complet

### Étape 1 : Récupérer les Variables Supabase

1. **Accédez au Dashboard Supabase**
   - Allez sur [app.supabase.com](https://app.supabase.com)
   - Connectez-vous et sélectionnez votre projet

2. **Récupérer les clés API**
   - Allez dans **Settings** → **API**
   - Vous verrez :
     - **Project URL** : `https://xxxxx.supabase.co`
     - **anon public** key : `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...`
     - **service_role** key : `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...` (⚠️ Secret, ne partagez jamais)

3. **Notez ces valeurs** (vous en aurez besoin pour Vercel)

---

### Étape 2 : Récupérer la Clé Stripe (Optionnel)

Si vous utilisez Stripe pour les paiements :

1. **Accédez au Dashboard Stripe**
   - Allez sur [dashboard.stripe.com](https://dashboard.stripe.com)
   - Connectez-vous

2. **Récupérer la clé secrète**
   - Allez dans **Developers** → **API keys**
   - Copiez la **Secret key** (commence par `sk_test_` ou `sk_live_`)
   - ⚠️ Ne partagez jamais cette clé publiquement

---

### Étape 3 : Accéder au Dashboard Vercel

1. **Ouvrez votre navigateur**
   - Allez sur [vercel.com](https://vercel.com)
   - Connectez-vous avec votre compte

2. **Sélectionnez votre projet**
   - Cliquez sur **"Dashboard"**
   - Trouvez et cliquez sur le projet **"go-data-dashboard"**

---

### Étape 4 : Configurer les Variables d'Environnement

1. **Accédez aux paramètres**
   - Dans votre projet Vercel, cliquez sur l'onglet **"Settings"** (en haut)
   - Dans le menu de gauche, cliquez sur **"Environment Variables"**

2. **Ajouter les variables une par une**

   Pour chaque variable, cliquez sur **"Add New"** et remplissez :

   #### Variable 1 : NEXT_PUBLIC_SUPABASE_URL
   - **Key** : `NEXT_PUBLIC_SUPABASE_URL`
   - **Value** : Votre Project URL Supabase (ex: `https://xxxxx.supabase.co`)
   - **Environments** : Cochez ✅ **Production**, ✅ **Preview**, ✅ **Development**
   - Cliquez sur **"Save"**

   #### Variable 2 : NEXT_PUBLIC_SUPABASE_ANON_KEY
   - **Key** : `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - **Value** : Votre clé "anon public" de Supabase
   - **Environments** : Cochez ✅ **Production**, ✅ **Preview**, ✅ **Development**
   - Cliquez sur **"Save"**

   #### Variable 3 : SUPABASE_SERVICE_ROLE_KEY
   - **Key** : `SUPABASE_SERVICE_ROLE_KEY`
   - **Value** : Votre clé "service_role" de Supabase (⚠️ Secret)
   - **Environments** : Cochez ✅ **Production**, ✅ **Preview**, ✅ **Development**
   - Cliquez sur **"Save"**

   #### Variable 4 : NEXT_PUBLIC_APP_URL
   - **Key** : `NEXT_PUBLIC_APP_URL`
   - **Value** : L'URL de votre application Vercel (ex: `https://go-data-dashboard-xxxxx.vercel.app`)
     - Vous pouvez trouver cette URL dans l'onglet **"Deployments"** → premier déploiement
     - Ou utilisez votre domaine personnalisé si configuré (ex: `https://app.go-data.com`)
   - **Environments** : Cochez ✅ **Production**, ✅ **Preview**, ✅ **Development**
   - Cliquez sur **"Save"**

   #### Variable 5 : STRIPE_SECRET_KEY (Optionnel)
   - **Key** : `STRIPE_SECRET_KEY`
   - **Value** : Votre clé secrète Stripe (commence par `sk_test_` ou `sk_live_`)
   - **Environments** : Cochez ✅ **Production**, ✅ **Preview**, ✅ **Development**
   - Cliquez sur **"Save"**
   - ⚠️ **Note** : Si vous n'utilisez pas Stripe, vous pouvez ignorer cette variable

---

### Étape 5 : Vérifier les Variables Configurées

1. **Vérifiez la liste**
   - Dans **Settings** → **Environment Variables**
   - Vous devriez voir toutes les variables que vous avez ajoutées
   - Vérifiez que chaque variable a les bonnes coches (Production, Preview, Development)

2. **Variables requises minimales :**
   - ✅ `NEXT_PUBLIC_SUPABASE_URL`
   - ✅ `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - ✅ `SUPABASE_SERVICE_ROLE_KEY`
   - ✅ `NEXT_PUBLIC_APP_URL`
   - ⚠️ `STRIPE_SECRET_KEY` (optionnel)

---

### Étape 6 : Redéployer l'Application

1. **Méthode 1 : Via le Dashboard**
   - Allez dans l'onglet **"Deployments"**
   - Trouvez le dernier déploiement (celui qui a échoué)
   - Cliquez sur les **trois points** (⋯) à droite
   - Cliquez sur **"Redeploy"**
   - Confirmez le redéploiement

2. **Méthode 2 : Via la CLI**
   ```bash
   cd dashboard_web
   vercel --prod
   ```

3. **Attendre le déploiement**
   - Le build peut prendre 1-3 minutes
   - Surveillez les logs en temps réel dans le dashboard

---

### Étape 7 : Vérifier le Déploiement

1. **Vérifier le statut**
   - Dans **Deployments**, le dernier déploiement devrait avoir le statut **"Ready"** (✓)
   - Si c'est **"Error"** (●), cliquez dessus pour voir les logs

2. **Tester l'application**
   - Cliquez sur l'URL du déploiement (ex: `https://go-data-dashboard-xxxxx.vercel.app`)
   - L'application devrait se charger
   - Testez la connexion/inscription

3. **Vérifier les logs**
   - Si l'application ne fonctionne pas, allez dans **Deployments** → dernier déploiement → **"Runtime Logs"**
   - Vérifiez s'il y a des erreurs

---

## 📝 Checklist Complète

- [ ] Variables Supabase récupérées (URL, anon key, service role key)
- [ ] Clé Stripe récupérée (si nécessaire)
- [ ] Dashboard Vercel ouvert
- [ ] Projet `go-data-dashboard` sélectionné
- [ ] Section "Environment Variables" ouverte
- [ ] `NEXT_PUBLIC_SUPABASE_URL` ajoutée
- [ ] `NEXT_PUBLIC_SUPABASE_ANON_KEY` ajoutée
- [ ] `SUPABASE_SERVICE_ROLE_KEY` ajoutée
- [ ] `NEXT_PUBLIC_APP_URL` ajoutée
- [ ] `STRIPE_SECRET_KEY` ajoutée (si nécessaire)
- [ ] Toutes les variables configurées pour Production, Preview et Development
- [ ] Application redéployée
- [ ] Déploiement réussi (statut "Ready")
- [ ] Application testée et fonctionnelle

---

## 🐛 Dépannage

### Le déploiement échoue toujours

1. **Vérifiez les variables**
   - Allez dans **Settings** → **Environment Variables**
   - Vérifiez qu'il n'y a pas d'espaces avant/après les valeurs
   - Vérifiez que les URLs commencent par `https://`

2. **Vérifiez les logs de build**
   - Dans **Deployments** → dernier déploiement → **"Build Logs"**
   - Cherchez les erreurs spécifiques

3. **Vérifiez les logs runtime**
   - Dans **Deployments** → dernier déploiement → **"Runtime Logs"**
   - Vérifiez les erreurs au démarrage

### L'application se charge mais l'authentification ne fonctionne pas

1. **Vérifiez Supabase**
   - Allez dans Supabase → **Authentication** → **URL Configuration**
   - Vérifiez que le **Site URL** correspond à votre URL Vercel
   - Vérifiez que les **Redirect URLs** incluent votre URL Vercel

2. **Vérifiez NEXT_PUBLIC_APP_URL**
   - Dans Vercel, vérifiez que `NEXT_PUBLIC_APP_URL` est correcte
   - Elle doit correspondre à l'URL de votre déploiement Vercel

---

## 📚 Ressources

- [Documentation Vercel - Environment Variables](https://vercel.com/docs/concepts/projects/environment-variables)
- [Documentation Supabase - Getting Started](https://supabase.com/docs/guides/getting-started)
- [Dashboard Vercel](https://vercel.com/dashboard)
- [Dashboard Supabase](https://app.supabase.com)

---

## 🔐 Sécurité

- ⚠️ **Ne partagez jamais** vos clés secrètes (`SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY`)
- ✅ Les variables `NEXT_PUBLIC_*` sont publiques (visibles côté client)
- ✅ Les autres variables sont privées (côté serveur uniquement)
- ✅ Vercel chiffre automatiquement les variables d'environnement

---

## ✅ Une fois terminé

Votre application devrait être :
- ✅ Déployée avec succès sur Vercel
- ✅ Accessible via l'URL de production
- ✅ Fonctionnelle avec authentification Supabase
- ✅ Prête pour la configuration du domaine personnalisé (voir `GODADDY_DOMAIN_SETUP.md`)
