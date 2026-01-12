# Configuration d'un Domaine GoDaddy avec Go-Data

Ce guide explique comment configurer votre domaine GoDaddy pour votre application Go-Data.

## 📋 Prérequis

- ✅ Domaine acheté sur GoDaddy
- ✅ Application Next.js déployée (sur Vercel, Netlify, ou autre)
- ✅ Compte Supabase configuré

---

## 🚀 Étapes de Configuration

### Étape 1 : Déployer votre Application

Avant de configurer le domaine, vous devez déployer votre application Next.js.

#### Option A : Vercel (Recommandé pour Next.js)

1. **Installer Vercel CLI** (si pas déjà fait)
   ```bash
   npm i -g vercel
   ```

2. **Déployer depuis le dossier dashboard_web**
   ```bash
   cd dashboard_web
   vercel
   ```
   - Suivez les instructions
   - Vercel vous donnera une URL temporaire (ex: `votre-app.vercel.app`)

3. **Notez l'URL de déploiement** - vous en aurez besoin pour le DNS

#### Option B : Netlify

1. **Installer Netlify CLI**
   ```bash
   npm i -g netlify-cli
   ```

2. **Déployer**
   ```bash
   cd dashboard_web
   netlify deploy --prod
   ```

#### Option C : Autre hébergement

Si vous utilisez un autre service, suivez leurs instructions de déploiement.

---

### Étape 2 : Configurer le DNS dans GoDaddy

Maintenant, vous devez pointer votre domaine GoDaddy vers votre application déployée.

#### 2.1. Accéder à la gestion DNS de GoDaddy

1. Connectez-vous à [GoDaddy.com](https://www.godaddy.com)
2. Allez dans **Mes Produits** → **Domaines**
3. Cliquez sur votre domaine
4. Cliquez sur **DNS** ou **Gérer le DNS**

#### 2.2. Configurer les enregistrements DNS

Selon votre plateforme d'hébergement :

##### Si vous utilisez Vercel :

1. **Dans Vercel** :
   - Allez dans votre projet
   - Cliquez sur **Settings** → **Domains**
   - Ajoutez votre domaine (ex: `go-data.com` ou `app.go-data.com`)
   - Vercel vous donnera les enregistrements DNS à ajouter

2. **Dans GoDaddy DNS**, ajoutez/modifiez :

   **Pour un domaine racine** (ex: `go-data.com`) :
   ```
   Type: A
   Nom: @
   Valeur: 76.76.21.21
   TTL: 600 (ou Automatique)
   
   Type: CNAME
   Nom: www
   Valeur: cname.vercel-dns.com
   TTL: 600 (ou Automatique)
   ```

   **Pour un sous-domaine** (ex: `app.go-data.com`) :
   ```
   Type: CNAME
   Nom: app
   Valeur: cname.vercel-dns.com
   TTL: 600 (ou Automatique)
   ```

##### Si vous utilisez Netlify :

1. **Dans Netlify** :
   - Allez dans votre site
   - Cliquez sur **Domain settings** → **Add custom domain**
   - Ajoutez votre domaine
   - Netlify vous donnera les enregistrements DNS

2. **Dans GoDaddy DNS**, ajoutez :
   ```
   Type: A
   Nom: @
   Valeur: (l'adresse IP fournie par Netlify)
   TTL: 600
   
   Type: CNAME
   Nom: www
   Valeur: (le CNAME fourni par Netlify)
   TTL: 600
   ```

##### Si vous utilisez un autre hébergeur :

Consultez la documentation de votre hébergeur pour les enregistrements DNS.

#### 2.3. Attendre la propagation DNS

- ⏱️ **Temps d'attente** : 15 minutes à 48 heures (généralement 1-2 heures)
- 🔍 **Vérifier** : Utilisez [whatsmydns.net](https://www.whatsmydns.net) pour vérifier la propagation

---

### Étape 3 : Configurer SSL/HTTPS

#### Vercel
- ✅ SSL est automatique et gratuit
- Vercel configure automatiquement le certificat SSL une fois le domaine connecté

#### Netlify
- ✅ SSL est automatique et gratuit
- Netlify configure automatiquement le certificat SSL

#### Autre hébergeur
- Configurez un certificat SSL (Let's Encrypt, Cloudflare, etc.)

---

### Étape 4 : Configurer les Variables d'Environnement

#### 4.1. Dans votre plateforme d'hébergement

**Vercel** :
1. Allez dans votre projet → **Settings** → **Environment Variables**
2. Ajoutez/modifiez :
   ```
   NEXT_PUBLIC_APP_URL=https://votre-domaine.com
   ```

**Netlify** :
1. Allez dans votre site → **Site settings** → **Environment variables**
2. Ajoutez/modifiez :
   ```
   NEXT_PUBLIC_APP_URL=https://votre-domaine.com
   ```

#### 4.2. Redéployer après modification

Après avoir ajouté la variable, redéployez votre application.

---

### Étape 5 : Configurer Supabase

#### 5.1. Configurer l'URL du Site dans Supabase

1. Allez sur [app.supabase.com](https://app.supabase.com)
2. Sélectionnez votre projet
3. Allez dans **Authentication** → **URL Configuration**
4. Configurez :
   - **Site URL** : `https://votre-domaine.com`
   - **Redirect URLs** : Ajoutez :
     ```
     https://votre-domaine.com/auth/callback
     https://votre-domaine.com/dashboard
     https://votre-domaine.com/login
     https://votre-domaine.com/create-account
     ```

#### 5.2. Sauvegarder

Cliquez sur **"Save"** pour enregistrer.

---

### Étape 6 : Mettre à jour le Template d'Email

Le template d'email utilisera automatiquement le **Site URL** configuré dans Supabase, donc votre logo devrait s'afficher correctement.

---

## ✅ Vérification

### 1. Vérifier que le domaine fonctionne

1. Ouvrez votre navigateur
2. Allez sur `https://votre-domaine.com`
3. Vérifiez que votre application s'affiche

### 2. Vérifier l'authentification

1. Allez sur `https://votre-domaine.com/login`
2. Créez un compte de test
3. Vérifiez que l'email de confirmation contient le bon domaine
4. Cliquez sur le lien de confirmation
5. Vérifiez que vous êtes redirigé vers votre domaine

### 3. Vérifier les redirections

- Testez la connexion
- Testez la création de compte
- Vérifiez que les redirections fonctionnent correctement

---

## 🔧 Configuration Avancée

### Utiliser un sous-domaine

Si vous voulez utiliser `app.votre-domaine.com` au lieu de `votre-domaine.com` :

1. **Dans GoDaddy DNS** :
   ```
   Type: CNAME
   Nom: app
   Valeur: cname.vercel-dns.com (ou celui de votre hébergeur)
   TTL: 600
   ```

2. **Dans Vercel/Netlify** :
   - Ajoutez `app.votre-domaine.com` comme domaine personnalisé

3. **Dans Supabase** :
   - Utilisez `https://app.votre-domaine.com` comme Site URL

4. **Dans les variables d'environnement** :
   - `NEXT_PUBLIC_APP_URL=https://app.votre-domaine.com`

---

## 🐛 Dépannage

### Le domaine ne fonctionne pas

1. **Vérifier la propagation DNS** :
   - Allez sur [whatsmydns.net](https://www.whatsmydns.net)
   - Tapez votre domaine
   - Vérifiez que les enregistrements correspondent

2. **Vérifier les enregistrements DNS dans GoDaddy** :
   - Vérifiez que les valeurs sont correctes
   - Vérifiez qu'il n'y a pas de fautes de frappe

3. **Attendre plus longtemps** :
   - La propagation DNS peut prendre jusqu'à 48h
   - Attendez au moins 2 heures

### SSL ne fonctionne pas

1. **Vercel/Netlify** : Attendez 5-10 minutes après avoir connecté le domaine
2. **Vérifier** : Utilisez [SSL Labs](https://www.ssllabs.com/ssltest/) pour vérifier le certificat

### Les redirections ne fonctionnent pas

1. Vérifiez que `NEXT_PUBLIC_APP_URL` est correct dans votre plateforme
2. Vérifiez les Redirect URLs dans Supabase
3. Redéployez votre application après modification des variables

### Erreur "Invalid redirect URL" dans Supabase

- Vérifiez que l'URL est exactement la même dans Supabase et dans votre code
- Vérifiez qu'il n'y a pas de slash à la fin
- Vérifiez que vous utilisez `https://` (pas `http://`)

---

## 📚 Ressources

- [Documentation GoDaddy DNS](https://fr.godaddy.com/help/gerer-les-enregistrements-dns-19238)
- [Documentation Vercel - Domaines personnalisés](https://vercel.com/docs/concepts/projects/domains)
- [Documentation Netlify - Domaines personnalisés](https://docs.netlify.com/domains-https/custom-domains/)
- [Vérification DNS - whatsmydns.net](https://www.whatsmydns.net)

---

## 📝 Checklist Complète

- [ ] Application déployée sur Vercel/Netlify
- [ ] Enregistrements DNS configurés dans GoDaddy
- [ ] Propagation DNS vérifiée (whatsmydns.net)
- [ ] SSL configuré (automatique sur Vercel/Netlify)
- [ ] Variable `NEXT_PUBLIC_APP_URL` configurée dans l'hébergeur
- [ ] Site URL configuré dans Supabase
- [ ] Redirect URLs ajoutées dans Supabase
- [ ] Application redéployée après modifications
- [ ] Domaine testé dans le navigateur
- [ ] Authentification testée
- [ ] Emails de confirmation testés

