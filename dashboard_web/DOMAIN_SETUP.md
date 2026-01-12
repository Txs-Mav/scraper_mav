# Configuration du Nom de Domaine

Ce guide explique comment configurer votre nom de domaine dans le projet Go-Data.

## 📍 Endroits à configurer

Il y a **2 endroits principaux** où vous devez configurer votre domaine :

1. **Variables d'environnement Next.js** (`.env.local`)
2. **Configuration Supabase** (Dashboard)

---

## 1. Configuration dans Next.js (`.env.local`)

### Créer/modifier le fichier `.env.local`

Créez un fichier `.env.local` à la racine du dossier `dashboard_web` (s'il n'existe pas déjà) :

```bash
cd dashboard_web
nano .env.local  # ou utilisez votre éditeur préféré
```

### Ajouter votre domaine

Ajoutez cette ligne avec votre nom de domaine :

```env
# URL de votre application (remplacez par votre domaine réel)
NEXT_PUBLIC_APP_URL=https://votre-domaine.com
```

**Exemples :**
```env
# Si votre domaine est go-data.com
NEXT_PUBLIC_APP_URL=https://go-data.com

# Si votre domaine est app.go-data.com
NEXT_PUBLIC_APP_URL=https://app.go-data.com

# Si vous utilisez un sous-domaine
NEXT_PUBLIC_APP_URL=https://dashboard.votre-domaine.com
```

⚠️ **Important :**
- Utilisez toujours `https://` (pas `http://`)
- N'ajoutez pas de slash (`/`) à la fin
- Cette variable est utilisée pour :
  - Les liens Stripe (redirections après paiement)
  - Les liens d'invitation d'organisation
  - Les callbacks d'authentification

### Redémarrer le serveur

Après avoir modifié `.env.local`, redémarrez le serveur de développement :

```bash
# Arrêtez le serveur (Ctrl+C)
# Puis redémarrez
npm run dev
```

---

## 2. Configuration dans Supabase

### 2.1. Configuration de l'URL du Site (Site URL)

Cette URL est utilisée dans les emails de confirmation pour le logo et les redirections.

1. **Accédez au Dashboard Supabase**
   - Allez sur [app.supabase.com](https://app.supabase.com)
   - Connectez-vous et sélectionnez votre projet

2. **Naviguez vers Authentication → URL Configuration**
   - Dans le menu de gauche : **Authentication** → **URL Configuration**
   - Ou directement : `https://app.supabase.com/project/[votre-projet]/auth/url-configuration`

3. **Configurez le Site URL**
   - Dans le champ **"Site URL"**, entrez votre domaine :
     ```
     https://votre-domaine.com
     ```
   - Cette URL sera utilisée comme `{{ .SiteURL }}` dans les templates d'email

4. **Configurez les Redirect URLs**
   - Dans **"Redirect URLs"**, ajoutez les URLs autorisées :
     ```
     https://votre-domaine.com/auth/callback
     https://votre-domaine.com/dashboard
     https://votre-domaine.com/login
     ```
   - Ces URLs sont nécessaires pour les redirections après authentification

5. **Sauvegardez**
   - Cliquez sur **"Save"** pour enregistrer les modifications

### 2.2. Configuration pour la production

Si vous êtes en production, vous devez aussi configurer :

1. **Email Templates** (optionnel mais recommandé)
   - Allez dans **Authentication** → **Email Templates**
   - Le template utilisera automatiquement le **Site URL** configuré ci-dessus

2. **Custom SMTP** (optionnel)
   - Si vous voulez utiliser votre propre serveur SMTP au lieu de celui de Supabase
   - Allez dans **Settings** → **Auth** → **SMTP Settings**

---

## 📝 Résumé des configurations

### Fichier `.env.local`

```env
# Domaine de votre application
NEXT_PUBLIC_APP_URL=https://votre-domaine.com

# Autres variables (si nécessaire)
NEXT_PUBLIC_SUPABASE_URL=https://votre-projet.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=votre_cle_anon
```

### Supabase Dashboard

- **Authentication → URL Configuration**
  - Site URL : `https://votre-domaine.com`
  - Redirect URLs : 
    - `https://votre-domaine.com/auth/callback`
    - `https://votre-domaine.com/dashboard`
    - `https://votre-domaine.com/login`

---

## ✅ Vérification

Pour vérifier que tout est bien configuré :

1. **Vérifier les variables d'environnement**
   ```bash
   # Dans le terminal, depuis dashboard_web/
   cat .env.local | grep NEXT_PUBLIC_APP_URL
   # Doit afficher : NEXT_PUBLIC_APP_URL=https://votre-domaine.com
   ```

2. **Tester l'authentification**
   - Créez un compte de test
   - Vérifiez que les emails de confirmation contiennent le bon domaine
   - Vérifiez que les redirections fonctionnent après connexion

3. **Tester Stripe** (si configuré)
   - Testez un paiement
   - Vérifiez que les redirections après paiement utilisent le bon domaine

---

## 🔧 Pour le développement local

Si vous développez en local, vous pouvez garder :

```env
# .env.local (pour le développement)
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

Et dans Supabase, ajoutez aussi `http://localhost:3000/auth/callback` dans les Redirect URLs.

**Pour la production**, créez un fichier `.env.production` ou configurez les variables d'environnement directement sur votre plateforme d'hébergement (Vercel, Netlify, etc.).

---

## 🚀 Déploiement

Si vous déployez sur Vercel, Netlify, ou une autre plateforme :

1. **Configurez les variables d'environnement** dans le dashboard de votre plateforme
2. **Ajoutez `NEXT_PUBLIC_APP_URL`** avec votre domaine de production
3. **Mettez à jour Supabase** avec le domaine de production
4. **Redéployez** votre application

---

## ❓ Problèmes courants

### Le logo ne s'affiche pas dans les emails
- Vérifiez que le **Site URL** dans Supabase est correct
- Vérifiez que votre domaine est accessible publiquement
- Vérifiez que le fichier `/Go-Data.png` est bien dans le dossier `public/`

### Les redirections ne fonctionnent pas
- Vérifiez que l'URL est dans la liste des **Redirect URLs** dans Supabase
- Vérifiez que `NEXT_PUBLIC_APP_URL` est correct dans `.env.local`
- Redémarrez le serveur après modification de `.env.local`

### Erreur "Invalid redirect URL"
- Vérifiez que l'URL est exactement la même dans Supabase et dans votre code
- N'oubliez pas le `https://` ou `http://`
- Vérifiez qu'il n'y a pas de slash à la fin

