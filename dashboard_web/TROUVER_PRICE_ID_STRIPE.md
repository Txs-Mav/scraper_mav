# Comment trouver le Price ID dans Stripe

## Problème
Vous avez le **Product ID** (`prod_...`) mais vous avez besoin du **Price ID** (`price_...`).

## Solution : Trouver le Price ID

### Méthode 1 : Dans la section "Tarifs" (Prices)

1. Dans le dashboard Stripe, allez dans **Products**
2. Cliquez sur votre produit (Pro ou Ultime)
3. Dans la section **"Tarifs"** (Prices) à gauche :
   - Vous voyez le prix (ex: "275,00 $CA")
   - **Cliquez sur le prix** ou sur les **trois points** (⋯) à droite du prix
   - Sélectionnez **"View details"** ou **"Voir les détails"**
4. Dans les détails du prix, vous verrez :
   - **Price ID** : `price_XXXXX...` ← **C'est celui-ci qu'il vous faut !**

### Méthode 2 : Via l'API ou l'URL

Quand vous êtes sur la page du prix, l'URL contient le Price ID :
```
https://dashboard.stripe.com/prices/price_XXXXX
                                    ^^^^^^^^^^^^
                                    C'est le Price ID !
```

### Méthode 3 : Dans la liste des prix

1. Allez dans **Products** > Votre produit
2. Dans la section **"Tarifs"**, passez la souris sur le prix
3. Le Price ID peut apparaître dans un tooltip ou dans les détails

## Exemple de ce que vous devriez voir

**Product ID** (ce que vous avez actuellement) :
```
prod_Ts3x8VE3wHynNR  ❌ Ne pas utiliser
```

**Price ID** (ce dont vous avez besoin) :
```
price_1AbC123...      ✅ À utiliser
```

## Configuration correcte

Une fois que vous avez les Price IDs, votre `.env.local` devrait ressembler à :

```env
STRIPE_SECRET_KEY=sk_live_...
STRIPE_PRICE_ID_PRO=price_XXXXX          # Price ID du plan Pro
STRIPE_PRICE_ID_ULTIME=price_YYYYY      # Price ID du plan Ultime
STRIPE_WEBHOOK_SECRET=whsec_...
NEXT_PUBLIC_APP_URL=https://go-data-dashboard.vercel.app
```

## Astuce

Si vous ne voyez pas le Price ID directement :
1. Cliquez sur le prix dans la liste
2. Regardez l'URL de la page - elle contient le Price ID
3. Ou utilisez l'inspecteur de navigateur (F12) pour voir les données

## Vérification

Pour vérifier que vous avez le bon ID :
- ✅ Price ID commence par `price_`
- ❌ Product ID commence par `prod_`
