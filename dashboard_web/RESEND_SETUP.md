# Configuration Resend pour emails Go-Data

Ce guide explique comment configurer Resend pour que les emails soient envoyés depuis le domaine Go-Data (ex: `noreply@go-data.co`).

---

## 1. Créer un compte Resend

1. Aller sur [resend.com](https://resend.com)
2. Créer un compte
3. Récupérer la clé API dans **API Keys** → **Create API Key**

---

## 2. Ajouter et vérifier ton domaine Go-Data

### a) Ajouter le domaine

1. Dans Resend : **Domains** → **Add Domain**
2. Entrer ton domaine (ex: `go-data.co` ou `go-data.com`)
3. Cliquer **Add**

### b) Configurer les enregistrements DNS

Resend affiche des enregistrements à ajouter chez ton registrar DNS (Cloudflare, OVH, etc.) :

#### Enregistrement SPF (Recommandé)
```
Type: TXT
Name: @ (ou go-data.co)
Value: v=spf1 include:amazonses.com ~all
```

#### Enregistrements DKIM (obligatoires)
Resend fournit 3 enregistrements CNAME à ajouter. Exemple :
```
Type: CNAME
Name: resend._domainkey
Value: [valeur fournie par Resend]
```

**Important :** Copie les valeurs exactes fournies par Resend — elles sont propres à ton compte.

### c) Vérifier le domaine

1. Ajoute tous les enregistrements DNS
2. Attendre la propagation (5 min à 48 h)
3. Dans Resend, cliquer **Verify**
4. Une fois vérifié, le statut passe à **Verified**

---

## 3. Configurer les variables d'environnement

Dans `.env.local` :

```env
# Resend - Emails Go-Data
RESEND_API_KEY=re_xxxxxxxxxxxxxxxxxxxxxxxxxx
RESEND_FROM_EMAIL=Go-Data <noreply@go-data.co>
```

### Valeurs possibles pour `RESEND_FROM_EMAIL`

| Format | Exemple |
|--------|---------|
| Nom + email | `Go-Data <noreply@go-data.co>` |
| Email seul | `noreply@go-data.co` |
| Sous-domaine | `analytics@go-data.co` |

**Règle :** L’adresse doit utiliser un domaine vérifié dans Resend.

---

## 4. Emails concernés

| Fonctionnalité | Source actuelle | Avec Resend |
|----------------|-----------------|-------------|
| Analytics par email | Resend (domaine Go-Data) | `noreply@go-data.co` |
| Confirmation compte | Supabase (par défaut) | Voir section 5 |
| Reset mot de passe | Supabase (par défaut) | Voir section 5 |

---

## 5. Emails Supabase (optionnel)

Les emails d’inscription et de réinitialisation de mot de passe passent par Supabase.

Pour les envoyer aussi depuis Go-Data :

1. Aller dans **Supabase Dashboard** → **Project Settings** → **Auth**
2. Section **SMTP Settings** → activer **Custom SMTP**
3. Resend fournit des paramètres SMTP :
   - Host: `smtp.resend.com`
   - Port: `465` (SSL) ou `587` (TLS)
   - User: `resend`
   - Password: ta clé API Resend

4. **Sender email** : `noreply@go-data.co` (domaine vérifié)
5. **Sender name** : `Go-Data`

---

## 6. Tester

### Envoi d’un email test

```bash
curl -X POST http://localhost:3000/api/analytics/email \
  -H "Content-Type: application/json" \
  -H "Cookie: [ton cookie de session]" \
  -d '{"email": "ton@email.com"}'
```

Ou via le dashboard : **Paramètres** → **Analytics** → **Envoyer par email**.

### Vérifier dans Resend

1. **Resend** → **Emails** → **Logs**
2. Vérifier que les envois apparaissent avec le bon domaine

---

## 7. Dépannage

### "Resend non configuré"
- Vérifier que `RESEND_API_KEY` est défini dans `.env.local`

### "Domain not verified"
- Vérifier que le domaine est bien vérifié dans Resend
- Vérifier que `RESEND_FROM_EMAIL` utilise ce domaine

### "Invalid API key"
- Régénérer une clé API dans Resend
- Mettre à jour `RESEND_API_KEY` dans `.env.local`

---

## Checklist

- [ ] Compte Resend créé
- [ ] Domaine ajouté dans Resend
- [ ] Enregistrements DNS ajoutés (SPF, DKIM)
- [ ] Domaine vérifié
- [ ] `RESEND_API_KEY` dans `.env.local`
- [ ] `RESEND_FROM_EMAIL` avec le domaine Go-Data
- [ ] Test d’envoi réussi
