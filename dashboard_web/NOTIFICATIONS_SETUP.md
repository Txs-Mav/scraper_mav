# Notifications multi-canal (Email · SMS · Slack)

Les alertes Go-Data peuvent être envoyées sur trois canaux configurables par utilisateur :

| Canal | Fournisseur | Configuration serveur | Configuration utilisateur |
|-------|-------------|-----------------------|---------------------------|
| Email | Resend | `RESEND_API_KEY`, `RESEND_FROM_EMAIL` | Adresse dans _Paramètres → Canaux d'alertes_ |
| SMS   | Twilio | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` | Numéro au format E.164 |
| Slack | Incoming Webhook | — (aucune clé côté serveur) | URL de webhook Slack |

## 1. Migration base de données

Exécutez dans le SQL Editor Supabase :

```sh
supabase/migration_notification_channels.sql
```

Cette migration crée :

- la table `user_notification_channels` (une ligne par utilisateur)
- les colonnes `sms_notification` et `slack_notification` sur `scraper_alerts` (default `true`)
- les policies RLS associées
- un backfill initial de toutes les lignes `users` existantes

## 2. Variables d'environnement

Ajoutez dans `.env.local` / environnement Vercel :

```dotenv
# Email (existant)
RESEND_API_KEY=re_xxxxxxxxxxxxxxxxxxxx
RESEND_FROM_EMAIL="Go-Data <gestion@go-data.co>"

# SMS (Twilio) — optionnel
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_FROM_NUMBER=+15550001234
```

Sans ces variables Twilio, le canal SMS s'affiche dans l'UI mais est désactivé
avec un message explicatif. Les canaux email/Slack continuent de fonctionner
indépendamment.

## 3. Configuration côté utilisateur

- L'utilisateur accède à **Paramètres → Canaux d'alertes**.
- Chaque canal peut être activé/désactivé et dispose d'un bouton _Envoyer un test_
  qui déclenche un message réel via `/api/users/notification-channels/test`.
- Les préférences sont persistées dans `user_notification_channels`.

## 4. Slack — création d'un webhook

1. Ouvrir <https://api.slack.com/apps> → _Create New App_ → _From scratch_
2. Activer **Incoming Webhooks**
3. _Add New Webhook to Workspace_ → choisir le canal
4. Copier l'URL `https://hooks.slack.com/services/T…/B…/…` dans le champ prévu

Le champ _Canal_ est optionnel : il écrase le canal par défaut du webhook.

## 5. Endpoints exposés

| Méthode | URL | Description |
|---------|-----|-------------|
| `GET`   | `/api/users/notification-channels` | Récupère la config utilisateur |
| `PUT`   | `/api/users/notification-channels` | Met à jour la config (upsert) |
| `POST`  | `/api/users/notification-channels/test` | Envoie un message de test (`{ channel: 'email' \| 'sms' \| 'slack' }`) |

## 6. Intégration dans le flux d'alertes

Le dispatcher `@/lib/notifications/dispatcher` est appelé par
`/api/alerts/check` pour chaque changement détecté. Il :

1. lit `user_notification_channels` (via service client côté serveur)
2. combine les flags canal par canal : `alert.email_notification && user.email_enabled`, etc.
3. envoie en parallèle indépendant : une erreur sur un canal n'empêche pas les autres
4. logue le résumé (`email:OK · sms:FAIL · slack:OK`)

Pour désactiver un canal sur une alerte précise : `PATCH /api/alerts/:id`
avec `{ sms_notification: false }` (ou `email_notification`, `slack_notification`).
