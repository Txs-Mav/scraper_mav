# URLs Stripe pour votre site

## URL de votre site
**Production :** `https://go-data-dashboard.vercel.app`

## URLs à configurer dans Stripe

### 1. Webhook Stripe
```
https://go-data-dashboard.vercel.app/api/stripe/webhook
```

### 2. URLs de redirection après paiement

**Succès :**
```
https://go-data-dashboard.vercel.app/dashboard?payment=success
```

**Annulation :**
```
https://go-data-dashboard.vercel.app/create-account?payment=canceled
```

**Succès avec code promo :**
```
https://go-data-dashboard.vercel.app/dashboard?payment=success&promo=true
```

## Configuration dans Stripe Dashboard

### Pour le Webhook :
1. Allez dans **Developers** > **Webhooks**
2. Cliquez sur **Add endpoint**
3. Entrez l'URL : `https://go-data-dashboard.vercel.app/api/stripe/webhook`
4. Sélectionnez les événements :
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.paid`
   - `invoice.payment_failed`

### Variables d'environnement

**Pour la production (Vercel) :**
```env
NEXT_PUBLIC_APP_URL=https://go-data-dashboard.vercel.app
STRIPE_SECRET_KEY=sk_live_...
STRIPE_PRICE_ID_PRO=price_...
STRIPE_PRICE_ID_ULTIME=price_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

**Pour le développement local :**
```env
NEXT_PUBLIC_APP_URL=http://localhost:3000
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PRICE_ID_PRO=price_test_...
STRIPE_PRICE_ID_ULTIME=price_test_...
STRIPE_WEBHOOK_SECRET=whsec_test_...
```

## Note importante

L'URL `https://go-data.co` est différente de `https://go-data-dashboard.vercel.app`. 
Assurez-vous d'utiliser `go-data-dashboard.vercel.app` pour toutes les configurations Stripe.
