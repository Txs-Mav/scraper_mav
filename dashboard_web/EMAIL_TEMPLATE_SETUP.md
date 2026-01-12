# Configuration du Template d'Email de Confirmation

Ce guide explique comment configurer le template d'email de confirmation moderne dans Supabase.

## 📧 Template HTML Moderne

Le template `public/email-templates/confirmation-email.html` est un design moderne et professionnel style SaaS avec :
- ✅ Logo Go-Data intégré
- ✅ Design responsive (mobile-friendly)
- ✅ Style moderne avec dégradés et ombres
- ✅ Bouton CTA bien visible
- ✅ Compatible avec tous les clients email (y compris Outlook)

## 🔧 Configuration dans Supabase

### Méthode 1 : Configuration via le Dashboard Supabase (Recommandé)

1. **Accédez au Dashboard Supabase**
   - Connectez-vous à [app.supabase.com](https://app.supabase.com)
   - Sélectionnez votre projet

2. **Naviguez vers les Templates d'Email**
   - Allez dans **Authentication** → **Email Templates**
   - Ou directement : `https://app.supabase.com/project/[votre-projet]/auth/templates`

3. **Sélectionnez le Template de Confirmation**
   - Cliquez sur **"Confirm signup"** (ou "Confirmer l'inscription" si en français)

4. **Copiez le Contenu du Template**
   - Ouvrez le fichier `public/email-templates/confirmation-email.html`
   - Copiez tout le contenu HTML

5. **Configurez l'URL du Site dans Supabase**
   - Allez dans **Authentication** → **URL Configuration**
   - Dans **Site URL**, entrez votre URL de production (ex: `https://votre-domaine.com`)
   - Cette URL sera utilisée comme `{{ .SiteURL }}` dans le template pour le logo
   - ⚠️ **Important** : Utilisez l'URL publique complète (avec https://)

6. **Collez dans Supabase**
   - Remplacez le contenu existant par le nouveau template
   - Les variables Supabase disponibles sont :
     - `{{ .ConfirmationURL }}` - Lien de confirmation (automatique)
     - `{{ .SiteURL }}` - URL de base de votre site (configurée dans URL Configuration)
     - `{{ .Email }}` - Adresse email de l'utilisateur (automatique)

6. **Sauvegardez**
   - Cliquez sur **"Save"** pour enregistrer le template

### Méthode 2 : Configuration via API/Edge Function (Avancé)

Si vous préférez gérer les emails via une fonction edge ou une API externe :

1. **Créez une Edge Function** pour envoyer des emails personnalisés
2. **Utilisez Resend ou un autre service d'email** pour envoyer les emails
3. **Désactivez les emails Supabase** et gérez-les manuellement

## 🎨 Personnalisation du Template

### Variables Disponibles dans Supabase

- `{{ .ConfirmationURL }}` - Le lien de confirmation unique
- `{{ .SiteURL }}` - L'URL de base de votre application
- `{{ .Email }}` - L'adresse email de l'utilisateur
- `{{ .Token }}` - Le token de confirmation (généralement dans l'URL)
- `{{ .TokenHash }}` - Hash du token

### Modifier les Couleurs

Le template utilise un gradient violet/bleu (`#667eea` → `#764ba2`). Pour changer :

```html
<!-- Cherchez et remplacez -->
background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);

<!-- Par exemple, pour un gradient bleu/vert -->
background: linear-gradient(135deg, #3b82f6 0%, #10b981 100%);
```

### Modifier le Logo

Le logo utilise `{{ .SiteURL }}` qui doit être configuré dans Supabase :

1. **Dans Supabase Dashboard** :
   - Allez dans **Authentication** → **URL Configuration**
   - Définissez **Site URL** à votre domaine public (ex: `https://votre-domaine.com`)

2. **Le logo doit être accessible publiquement** :
   ```html
   <img src="{{ .SiteURL }}/Go-Data.png" alt="Go-Data" width="120">
   ```
   - Le logo doit être dans le dossier `public/` de votre application Next.js
   - L'URL complète sera : `https://votre-domaine.com/Go-Data.png`

3. **Alternative avec URL absolue** (si SiteURL n'est pas configuré) :
   Si vous préférez utiliser une URL absolue directement, remplacez :
   ```html
   <img src="{{ .SiteURL }}/Go-Data.png" alt="Go-Data" width="120">
   ```
   Par (remplacez par votre URL réelle) :
   ```html
   <img src="https://votre-domaine.com/Go-Data.png" alt="Go-Data" width="120">
   ```

## ✅ Vérification

Après avoir configuré le template :

1. **Testez l'envoi d'email**
   - Créez un compte de test via `/create-account`
   - Vérifiez votre boîte mail (y compris les spams)
   - Vérifiez que le logo s'affiche correctement
   - Vérifiez que le bouton de confirmation fonctionne

2. **Vérifiez la Responsive**
   - Testez sur différents clients email (Gmail, Outlook, Apple Mail)
   - Testez sur mobile

## 🔐 Configuration de l'Expiration du Lien de Confirmation

Par défaut, Supabase permet de configurer l'expiration du lien de confirmation email. Pour définir l'expiration à 24 heures :

### Méthode 1 : Via le Dashboard Supabase

1. **Accédez à la Configuration d'Authentification**
   - Allez dans **Authentication** → **Settings** → **Email Auth**
   - Ou directement : `https://app.supabase.com/project/[votre-projet]/auth/settings`

2. **Configurez le JWT Expiry**
   - Cherchez la section **"JWT expiry"** ou **"Email confirmation token expiry"**
   - Définissez la durée d'expiration à **24 heures** ou **86400 secondes**
   - Par défaut, Supabase utilise 3600 secondes (1 heure)

3. **Alternative : Configuration via SQL**
   - Si l'option n'est pas disponible dans l'interface, vous pouvez la configurer via SQL :
   ```sql
   -- Mettre à jour la configuration Auth pour expiration de 24h (86400 secondes)
   UPDATE auth.config 
   SET email_confirmation_token_expiry = 86400 
   WHERE id = 1;
   ```

### Méthode 2 : Via SQL (Si la table auth.config existe)

1. **Accédez à l'éditeur SQL de Supabase**
   - Allez dans **SQL Editor** dans votre dashboard Supabase

2. **Exécutez le script de configuration**
   - Ouvrez le fichier `supabase/configure_email_expiry.sql`
   - Copiez et exécutez le contenu dans l'éditeur SQL
   - Ce script définit l'expiration à 24 heures (86400 secondes)

**Note** : Si la table `auth.config` n'existe pas dans votre version de Supabase, utilisez la Méthode 1 (Dashboard).

### Méthode 3 : Via les Options lors de signUp

L'expiration est généralement gérée au niveau du projet Supabase, pas au niveau de chaque inscription. Cependant, vous pouvez vérifier la configuration dans `src/contexts/auth-context.tsx` :

```typescript
const { data: authData, error: authError } = await supabase.auth.signUp({
  email: data.email,
  password: data.password,
  options: {
    emailRedirectTo: `${window.location.origin}/auth/callback`,
    // L'expiration est gérée par Supabase selon la configuration du projet
  }
})
```

### Vérification de l'Expiration

Pour vérifier que l'expiration fonctionne :

1. Créez un compte de test
2. Attendez plus de 24h (ou modifiez temporairement l'expiration à 1 minute pour tester)
3. Essayez de cliquer sur le lien de confirmation
4. Vous devriez recevoir une erreur indiquant que le lien a expiré

## 🔐 Notes de Sécurité

- Le lien de confirmation expire après la durée configurée (recommandé : 24 heures)
- Le template inclut une note de sécurité pour informer l'utilisateur de l'expiration
- Après expiration, l'utilisateur doit demander un nouveau lien de confirmation

## 🐛 Dépannage

### Le logo ne s'affiche pas
- Vérifiez que le logo est dans `/public/Go-Data.png`
- Vérifiez que `{{ .SiteURL }}` pointe vers votre domaine public
- Certains clients email bloquent les images : c'est normal, l'utilisateur peut les activer

### Le bouton ne fonctionne pas
- Vérifiez que `{{ .ConfirmationURL }}` est correctement formaté
- Testez le lien dans différents clients email
- Vérifiez que le domaine est configuré dans Supabase

### Le design s'affiche mal
- Testez dans différents clients email
- Certains clients (comme Outlook) ont des limitations CSS
- Le template est optimisé pour la compatibilité maximale

## 📚 Ressources

- [Documentation Supabase Email Templates](https://supabase.com/docs/guides/auth/auth-email-templates)
- [Guide de compatibilité email HTML](https://www.campaignmonitor.com/dev-resources/guides/coding/)
- [Testeur d'emails HTML](https://www.emailonacid.com/)

