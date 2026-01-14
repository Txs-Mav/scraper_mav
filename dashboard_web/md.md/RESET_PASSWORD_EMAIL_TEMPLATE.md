# Template d'email pour réinitialisation de mot de passe

## 📋 Instructions pour Supabase

### Étape 1 : Accéder au template
1. Allez dans votre projet Supabase
2. Ouvrez **Authentication** > **Email Templates**
3. Sélectionnez le template **"Reset Password"**

### Étape 2 : Copier le template
1. Ouvrez le fichier `SUPABASE_EMAIL_TEMPLATE_COPY_PASTE.html` dans ce projet
2. **Copiez TOUT le contenu** du fichier (Ctrl+A puis Ctrl+C ou Cmd+A puis Cmd+C)
3. **Collez-le** dans le champ "Body" du template Supabase

### Étape 3 : Vérifier l'URL de redirection
Le template utilise `{{ .ConfirmationURL }}&type=recovery` pour s'assurer que la redirection se fait vers la page de réinitialisation et non vers le dashboard.

### Étape 4 : Sauvegarder
Cliquez sur **"Save"** pour enregistrer le template.

## ✅ Vérifications importantes

1. **URLs autorisées** : Assurez-vous que ces URLs sont dans **Authentication** > **URL Configuration** > **Redirect URLs** :
   - `http://localhost:3000/auth/callback`
   - `http://localhost:3000/reset-password`
   - (Pour la production, ajoutez les mêmes avec votre domaine)

2. **Site URL** : Vérifiez que **Site URL** est définie (ex: `http://localhost:3000`)

## 🎨 Caractéristiques du template

- ✅ Design moderne et professionnel avec gradient violet
- ✅ Responsive (s'adapte aux mobiles)
- ✅ Bouton CTA clair et visible
- ✅ Lien alternatif si le bouton ne fonctionne pas
- ✅ Avertissement de sécurité (lien valide 1h)
- ✅ Footer professionnel
- ✅ Compatible avec tous les clients email

## 🔧 Variables Supabase utilisées

- `{{ .ConfirmationURL }}` : L'URL complète générée par Supabase avec le token
- Le paramètre `&type=recovery` est ajouté pour identifier la réinitialisation

## 📝 Note

Le template est en français et suit le même style que les emails de confirmation de compte pour une expérience utilisateur cohérente.

