# Configuration Google OAuth pour Supabase

Ce guide explique comment configurer Google OAuth pour l'authentification dans votre application avec Supabase.

## 📋 Prérequis

- ✅ Compte Google Cloud Platform (GCP)
- ✅ Projet Supabase configuré
- ✅ Application déployée (ou URL locale pour le développement)

---

## 🚀 Étapes de Configuration

### Étape 1 : Créer/Configurer un Projet dans Google Cloud Console

1. **Accédez à Google Cloud Console**
   - Allez sur [console.cloud.google.com](https://console.cloud.google.com)
   - Connectez-vous avec votre compte Google

2. **Sélectionner ou créer un projet**
   - Si vous avez déjà un projet, sélectionnez-le
   - Sinon, cliquez sur **"Sélectionner un projet"** → **"Nouveau projet"**
   - Nommez votre projet (ex: "Go-Data Auth")
   - Cliquez sur **"Créer"**

---

### Étape 2 : Activer l'API Google+ (si nécessaire)

1. Dans le menu de gauche, allez dans **"API et services"** → **"Bibliothèque"**
2. Recherchez **"Google+ API"** ou **"Google Identity Services API"**
3. Cliquez sur l'API et activez-la si elle n'est pas déjà activée

---

### Étape 3 : Configurer l'Écran de Consentement OAuth

1. Dans **"API et services"** → **"Écran de consentement OAuth"**
2. Sélectionnez le type d'utilisateur :
   - **Externe** : Pour tous les utilisateurs Google
   - **Interne** : Seulement pour les utilisateurs de votre organisation G Suite
3. Remplissez les informations requises :
   - **Nom de l'application** : Go-Data (ou votre nom d'application)
   - **Adresse e-mail de l'assistance utilisateur** : Votre email
   - **Logo de l'application** : (optionnel) Logo de 120x120px
   - **Domaine de l'application** : Votre domaine (ex: `go-data.com`)
   - **Domaine de la page d'accueil** : `https://votre-domaine.com`
   - **Politique de confidentialité** : `https://votre-domaine.com/privacy` (si vous en avez une)
   - **Conditions d'utilisation** : `https://votre-domaine.com/terms` (si vous en avez)
4. Cliquez sur **"Enregistrer et continuer"**
5. Pour **"Scopes"**, gardez les scopes par défaut (email, profile, openid)
6. Cliquez sur **"Enregistrer et continuer"**
7. Pour **"Utilisateurs de test"** (si externe) : Ajoutez votre email pour tester
8. Cliquez sur **"Retour au tableau de bord"**

---

### Étape 4 : Créer les Identifiants OAuth 2.0

1. Dans **"API et services"** → **"Identifiants"**
2. Cliquez sur **"+ CRÉER DES IDENTIFIANTS"** → **"ID client OAuth"**
3. Configurez l'ID client :

   **Type d'application** : Application Web

   **Nom** : Go-Data Web Client (ou un nom descriptif)

   **URI de redirection autorisés** : Ajoutez ces URLs :

   Pour le développement local :
   ```
   http://localhost:3000/auth/callback
   ```

   Pour la production (avec votre domaine Vercel) :
   ```
   https://votre-domaine.vercel.app/auth/callback
   https://votre-domaine.com/auth/callback
   ```

   Pour Supabase (si votre application utilise Supabase Auth) :
   ```
   https://[votre-projet].supabase.co/auth/v1/callback
   ```

   ⚠️ **Important** : Si vous utilisez Supabase pour l'authentification, vous devez utiliser l'URL de callback de Supabase (format: `https://[project-ref].supabase.co/auth/v1/callback`)

4. Cliquez sur **"Créer"**

5. **Copiez les identifiants** :
   - **ID client** : `xxxxx-xxxxx.apps.googleusercontent.com`
   - **Secret client** : `GOCSPX-xxxxxxxxxxxxxx`
   - ⚠️ Gardez ces informations en sécurité, vous en aurez besoin pour Supabase

---

### Étape 5 : Configurer Google OAuth dans Supabase

1. **Accédez au Dashboard Supabase**
   - Allez sur [app.supabase.com](https://app.supabase.com)
   - Sélectionnez votre projet

2. **Configurer le Provider Google**
   - Allez dans **"Authentication"** → **"Providers"**
   - Trouvez **"Google"** dans la liste
   - Activez le toggle **"Enable Google provider"**

3. **Ajouter les identifiants Google**
   - **Client ID (for OAuth)** : Collez votre **ID client** de Google Cloud
   - **Client Secret (for OAuth)** : Collez votre **Secret client** de Google Cloud
   - Cliquez sur **"Save"**

---

### Étape 6 : Vérifier les URLs de Redirection dans Google Cloud

Assurez-vous que l'URL de callback de Supabase est bien dans vos **URI de redirection autorisés** :

1. Retournez dans Google Cloud Console
2. Allez dans **"API et services"** → **"Identifiants"**
3. Cliquez sur votre ID client OAuth
4. Dans **"URI de redirection autorisés"**, ajoutez :
   ```
   https://[votre-project-ref].supabase.co/auth/v1/callback
   ```
   (Remplacez `[votre-project-ref]` par la référence de votre projet Supabase)

5. Cliquez sur **"Enregistrer"**

---

### Étape 7 : Tester la Configuration

1. **Dans votre application** :
   - Allez sur la page de connexion
   - Cliquez sur le bouton **"Se connecter avec Google"**
   - Vous devriez être redirigé vers Google pour l'authentification
   - Après connexion, vous serez redirigé vers votre application

2. **Vérifier dans Supabase** :
   - Allez dans **"Authentication"** → **"Users"**
   - Vous devriez voir votre utilisateur Google créé

---

## 🔧 Configuration Avancée

### Pour un domaine personnalisé

Si vous utilisez un domaine personnalisé (ex: `app.go-data.com`) :

1. Dans Google Cloud Console, ajoutez toutes les URLs possibles :
   ```
   https://app.go-data.com/auth/callback
   https://go-data.com/auth/callback
   https://[votre-project-ref].supabase.co/auth/v1/callback
   ```

2. Dans Supabase, assurez-vous que le **Site URL** est configuré correctement :
   - **Authentication** → **URL Configuration**
   - **Site URL** : `https://app.go-data.com`
   - **Redirect URLs** : Ajoutez toutes vos URLs de redirection

---

## 📝 Checklist Complète

- [ ] Projet créé dans Google Cloud Console
- [ ] API Google+ activée (si nécessaire)
- [ ] Écran de consentement OAuth configuré
- [ ] ID client OAuth créé dans Google Cloud
- [ ] URLs de redirection ajoutées (localhost + production + Supabase)
- [ ] Google OAuth activé dans Supabase
- [ ] Client ID et Secret Client ajoutés dans Supabase
- [ ] URL de callback Supabase ajoutée dans Google Cloud
- [ ] Test de connexion Google réussi

---

## 🐛 Dépannage

### Erreur "redirect_uri_mismatch"

- Vérifiez que l'URL de callback dans Google Cloud correspond exactement à celle de Supabase
- L'URL doit être exactement : `https://[project-ref].supabase.co/auth/v1/callback`
- Vérifiez qu'il n'y a pas d'espace ou de caractère supplémentaire

### Le bouton "Se connecter avec Google" ne fonctionne pas

- Vérifiez que Google OAuth est activé dans Supabase
- Vérifiez que les identifiants (Client ID et Secret) sont corrects
- Vérifiez la console du navigateur pour les erreurs

### Erreur "access_denied"

- Vérifiez que l'écran de consentement OAuth est publié (pour la production)
- Pour les tests, ajoutez votre email dans "Utilisateurs de test"

### L'authentification fonctionne en local mais pas en production

- Vérifiez que l'URL de production est bien ajoutée dans Google Cloud
- Vérifiez que le domaine est autorisé dans l'écran de consentement OAuth
- Vérifiez que Supabase est configuré avec les bonnes URLs

---

## 📚 Ressources

- [Documentation Google OAuth 2.0](https://developers.google.com/identity/protocols/oauth2)
- [Documentation Supabase Auth - Google](https://supabase.com/docs/guides/auth/social-login/auth-google)
- [Google Cloud Console](https://console.cloud.google.com)
- [Dashboard Supabase](https://app.supabase.com)

---

## 🔐 Sécurité

- ⚠️ **Ne partagez jamais votre Secret Client publiquement**
- ✅ Gardez vos identifiants OAuth en sécurité
- ✅ Utilisez des variables d'environnement pour stocker les secrets
- ✅ Limitez les URLs de redirection uniquement à vos domaines
- ✅ Activez la vérification en deux étapes sur votre compte Google Cloud
