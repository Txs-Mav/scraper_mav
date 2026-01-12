# Configuration Supabase Storage pour les avatars

## Étapes à suivre dans Supabase

### 1. Créer le bucket "avatars"

1. Allez dans votre projet Supabase
2. Cliquez sur **Storage** dans le menu de gauche
3. Cliquez sur **New bucket**
4. Nommez le bucket : `avatars`
5. Cochez **Public bucket** (pour que les images soient accessibles publiquement)
6. Cliquez sur **Create bucket**

### 2. Configurer les policies RLS pour le bucket

Allez dans **Storage** > **Policies** (ou dans l'éditeur SQL) et exécutez ce script :

```sql
-- Policy pour permettre aux utilisateurs d'uploader leur propre avatar
-- Le chemin est formaté comme : {user_id}/{filename}
CREATE POLICY "Users can upload their own avatar"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'avatars' AND
  auth.uid()::text = (storage.foldername(name))[1]
);

-- Policy pour permettre à tous de lire les avatars (bucket public)
CREATE POLICY "Avatars are publicly readable"
ON storage.objects FOR SELECT
USING (bucket_id = 'avatars');

-- Policy pour permettre aux utilisateurs de mettre à jour leur propre avatar
CREATE POLICY "Users can update their own avatar"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'avatars' AND
  auth.uid()::text = (storage.foldername(name))[1]
);

-- Policy pour permettre aux utilisateurs de supprimer leur propre avatar
CREATE POLICY "Users can delete their own avatar"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'avatars' AND
  auth.uid()::text = (storage.foldername(name))[1]
);
```

### 3. Vérification

Pour vérifier que tout fonctionne :

1. Le bucket `avatars` doit être visible dans Storage
2. Le bucket doit être marqué comme **Public**
3. Les policies doivent être actives dans l'onglet **Policies** du bucket

### Notes importantes

- Les fichiers seront stockés dans le format : `{user_id}/{timestamp}.{extension}`
- Chaque utilisateur a son propre dossier dans le bucket `avatars`
- La taille maximale d'un fichier est de 5MB (configurée dans le code)
- Seuls les fichiers images sont acceptés
- Tous les anciens avatars de l'utilisateur sont automatiquement supprimés lors de l'upload d'un nouveau

### Test

Une fois configuré, vous pouvez tester l'upload depuis la page Settings > Profil.

