# Système de Gestion Utilisateur avec Supabase

## Vue d'ensemble

Le système de gestion utilisateur est maintenant entièrement intégré avec Supabase pour stocker :
- ✅ Utilisateurs et authentification
- ✅ Mots de passe (hashés automatiquement par Supabase Auth)
- ✅ Scrapings
- ✅ Plans d'abonnement
- ✅ Membres/Employés

## Pages créées

### 1. `/login`
- Formulaire de connexion
- Lien vers la création de compte

### 2. `/create-account`
- Formulaire d'inscription
- Sélection d'un plan d'abonnement (Gratuit, Standard, Premium)
- Création automatique du compte et de l'abonnement dans Supabase

### 3. `/dashboard/profile`
- Affichage du profil utilisateur
- Informations : nom, email, rôle, plan d'abonnement, date d'inscription
- Liens vers Settings et Subscription

### 4. `/dashboard/subscription`
- Affichage des 3 plans d'abonnement
- Plan actuel mis en évidence
- Message indiquant que seul le compte principal peut gérer

### 5. `/dashboard/settings`
- **Section 1** : Gestion des membres (compte principal uniquement)
  - Liste des membres avec badge "Compte principal"
  - Ajout/suppression de membres
- **Section 2** : Formulaire de création d'employé
  - Nom, email, rôle, permissions
- **Section 3** : Paramètres du compte
  - (À venir : modification profil, changement mot de passe)

## Fonctionnalités

### Authentification
- Connexion/Déconnexion via Supabase Auth
- Session persistante
- Protection des routes `/dashboard/*` via middleware

### Gestion des membres
- Seul le compte principal peut ajouter/supprimer des membres
- Les employés sont liés au compte principal
- Permissions par employé (à implémenter)

### Stockage des scrapings
- Tous les scrapings sont sauvegardés dans Supabase
- Association automatique à l'utilisateur connecté
- Les comptes principaux peuvent voir les scrapings de leurs employés

## Configuration requise

1. **Installer les dépendances** :
   ```bash
   npm install @supabase/supabase-js @supabase/ssr
   ```

2. **Configurer Supabase** :
   - Suivre les instructions dans `SUPABASE_SETUP.md`
   - Exécuter le schéma SQL dans `supabase/schema.sql`

3. **Variables d'environnement** :
   ```env
   NEXT_PUBLIC_SUPABASE_URL=votre_url
   NEXT_PUBLIC_SUPABASE_ANON_KEY=votre_anon_key
   SUPABASE_SERVICE_ROLE_KEY=votre_service_role_key
   ```

## Structure des données

### Table `users`
- Informations utilisateur (nom, email, rôle)
- Lien vers le compte principal (pour les employés)

### Table `subscriptions`
- Plan d'abonnement par utilisateur
- Statut (active, cancelled, expired)

### Table `employees`
- Relation entre compte principal et employés
- Rôle et permissions par employé

### Table `scrapings`
- Tous les scrapings avec produits et métadonnées
- Association à l'utilisateur

## Sécurité

- **Row Level Security (RLS)** : Les utilisateurs ne peuvent accéder qu'à leurs propres données
- **Mots de passe** : Hashés automatiquement par Supabase Auth
- **Middleware** : Protection des routes nécessitant une authentification
- **Permissions** : Vérification du rôle (principal vs employé) pour les actions sensibles

## Prochaines étapes

- [ ] Implémenter la modification du profil
- [ ] Implémenter le changement de mot de passe
- [ ] Ajouter la gestion des permissions par employé
- [ ] Migrer les scrapings existants depuis `scraped_data.json`
- [ ] Ajouter les webhooks Supabase pour les événements d'abonnement


