# Configuration Supabase

Ce document explique comment configurer Supabase pour le système de gestion utilisateur.

## 1. Créer un projet Supabase

1. Allez sur [supabase.com](https://supabase.com)
2. Créez un nouveau projet
3. Notez votre **Project URL** et **anon key** (disponibles dans Settings > API)

## 2. Configurer les variables d'environnement

Ajoutez ces variables dans `.env.local` :

```env
NEXT_PUBLIC_SUPABASE_URL=votre_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=votre_anon_key
SUPABASE_SERVICE_ROLE_KEY=votre_service_role_key
```

## 3. Créer le schéma de base de données

1. Dans votre projet Supabase, allez dans **SQL Editor**
2. Exécutez le contenu du fichier `supabase/schema.sql`
3. Vérifiez que toutes les tables ont été créées :
   - `users`
   - `subscriptions`
   - `employees`
   - `scrapings`

## 4. Vérifier les politiques RLS

Les politiques Row Level Security (RLS) sont déjà définies dans le schéma SQL. Assurez-vous qu'elles sont actives :

- Les utilisateurs peuvent voir/modifier leur propre profil
- Les comptes principaux peuvent gérer leurs employés
- Les scrapings sont privés par utilisateur

## 5. Tester la configuration

1. Démarrez le serveur de développement : `npm run dev`
2. Créez un compte via `/create-account`
3. Vérifiez dans Supabase que :
   - Un utilisateur a été créé dans `auth.users`
   - Une entrée a été créée dans `users`
   - Une subscription a été créée

## 6. Migration des données existantes (optionnel)

Si vous avez des données existantes dans `scraped_data.json`, vous pouvez les migrer vers Supabase en utilisant le script de migration (à créer).

## Notes importantes

- Les mots de passe sont automatiquement hashés par Supabase Auth
- Les triggers créent automatiquement les entrées dans `users` et `subscriptions` lors de l'inscription
- Les politiques RLS garantissent que les utilisateurs ne peuvent accéder qu'à leurs propres données
- Les comptes principaux peuvent voir les données de leurs employés


