# Plan GoDaddy – Étapes restantes (post-DNS validé)

Le domaine est validé dans Vercel. Il reste à terminer : Vercel (vars), Supabase, Stripe.

---

## Étape 6 : Configurer les variables d'environnement dans Vercel

1) Mettre à jour `NEXT_PUBLIC_APP_URL`
- Vercel : `Settings → Environment Variables`
- Si elle existe : **Edit** ; sinon : **Add New**
- Key : `NEXT_PUBLIC_APP_URL`
- Value : `https://www.go-data.co` (avec www) ou `https://go-data.co` (sans www)
- Important : utilisez `https://` (pas `http://`)
- Important : pas de slash à la fin
- Environments : cochez **Production**, **Preview**, **Development**
- Cliquez sur **Save**

2) Vérifier les autres variables d'environnement
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `STRIPE_SECRET_KEY` (si vous utilisez Stripe)
- `STRIPE_WEBHOOK_SECRET` (si vous utilisez Stripe)

3) Redéployer
- `Deployments → … → Redeploy` (du dernier déploiement)
- Ou faites un commit pour déclencher un nouveau déploiement

---

## Étape 7 : Configurer Supabase

1) Configurer l'URL du site
- `app.supabase.com` → projet → `Authentication → URL Configuration`
- Site URL : `https://www.go-data.co` (ou `https://go-data.co` si sans www)
- Important : utilisez `https://` (pas `http://`)
- Important : pas de slash à la fin

2) Ajouter les Redirect URLs (pour `www.go-data.co`)
```
https://go-data.co/auth/callback
https://go-data.co/auth/callback?*
https://go-data.co/dashboard
https://go-data.co/dashboard/*
https://go-data.co/login
https://go-data.co/create-account
https://go-data.co/reset-password
https://go-data.co/reset-password?*
```
Si vous utilisez le domaine sans www, remplacez par `go-data.co`.

3) Sauvegarder
- Cliquez sur **Save** en bas de page.

---

## Étape 8 : Configurer Stripe (production)

- `dashboard.stripe.com` → Live mode → `Developers → Webhooks`
- Modifier l'endpoint existant :
  - Endpoint URL : `https://www.go-data.co/api/stripe/webhook` (ou `https://go-data.co/api/stripe/webhook` si sans www)
  - Cliquez sur **Save changes**
- Si vous créez un nouvel endpoint :
  - Copiez le **Signing secret**
  - Mettez à jour `STRIPE_WEBHOOK_SECRET` dans Vercel (Environment Variables → `STRIPE_WEBHOOK_SECRET`)
- Vérifiez que `STRIPE_SECRET_KEY` est bien présent dans Vercel.

---

## Résumé des prochaines étapes
- Vercel : mettre à jour `NEXT_PUBLIC_APP_URL` + vérifier les autres vars, puis redeployer.
- Supabase : définir `Site URL` + ajouter les `Redirect URLs`, puis sauvegarder.
- Stripe : mettre à jour l'URL du webhook (et le secret si nouvel endpoint).

---

## Checklist rapide
- [x] DNS configuré et validé dans Vercel
- [ ] `NEXT_PUBLIC_APP_URL` configuré dans Vercel
- [ ] Application redéployée sur Vercel
- [ ] Site URL configuré dans Supabase
- [ ] Redirect URLs ajoutées dans Supabase
- [ ] Webhook Stripe mis à jour (URL + secret si nouveau)
