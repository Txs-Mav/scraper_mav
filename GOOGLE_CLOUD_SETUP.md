# Configuration Google Cloud & Vertex AI

Ce guide explique comment configurer Google Cloud pour utiliser Vertex AI avec le scraper.

## Pourquoi Vertex AI ?

| Aspect | Google AI API (clé) | Vertex AI |
|--------|---------------------|-----------|
| Sécurité | Clé API exposée | Service Account (IAM) |
| SLA | Aucun | 99.9% garanti |
| Rate limits | Restrictifs | Généreux (quotas élevés) |
| Compliance | Basique | SOC2, HIPAA, ISO 27001 |
| Prix | Pay-as-you-go | Potentiellement moins cher à l'échelle |
| Support | Communauté | Support Google Enterprise |

---

## Étape 1 : Créer un projet Google Cloud

1. Aller sur [Google Cloud Console](https://console.cloud.google.com/)
2. Cliquer sur **"Sélectionner un projet"** → **"Nouveau projet"**
3. Nom suggéré : `go-data-production`
4. Noter l'**ID du projet** (ex: `go-data-production-123456`)

---

## Étape 2 : Activer les APIs nécessaires

Dans la console Google Cloud :

1. Aller dans **APIs & Services** → **Bibliothèque**
2. Rechercher et activer ces APIs :
   - **Vertex AI API**
   - **Cloud Resource Manager API**

Ou via la ligne de commande :

```bash
# Installer gcloud CLI si pas déjà fait
# https://cloud.google.com/sdk/docs/install

# Se connecter
gcloud auth login

# Définir le projet
gcloud config set project YOUR_PROJECT_ID

# Activer les APIs
gcloud services enable aiplatform.googleapis.com
gcloud services enable cloudresourcemanager.googleapis.com
```

---

## Étape 3 : Créer un Service Account

### Via la Console

1. Aller dans **IAM & Admin** → **Service Accounts**
2. Cliquer **"Créer un compte de service"**
3. Nom : `go-data-scraper`
4. Description : `Service account pour le scraper AI Go-Data`
5. Cliquer **"Créer et continuer"**

### Attribuer les rôles

Ajouter ces rôles au service account :
- **Vertex AI User** (`roles/aiplatform.user`)

### Créer une clé JSON

1. Cliquer sur le service account créé
2. Aller dans l'onglet **"Clés"**
3. Cliquer **"Ajouter une clé"** → **"Créer une clé"**
4. Choisir **JSON**
5. Télécharger et sauvegarder le fichier (ex: `go-data-service-account.json`)

⚠️ **IMPORTANT** : Ne jamais commiter ce fichier dans Git !

### Via la ligne de commande

```bash
# Créer le service account
gcloud iam service-accounts create go-data-scraper \
    --display-name="Go-Data Scraper AI"

# Attribuer le rôle Vertex AI User
gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
    --member="serviceAccount:go-data-scraper@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
    --role="roles/aiplatform.user"

# Créer et télécharger la clé
gcloud iam service-accounts keys create ./go-data-service-account.json \
    --iam-account=go-data-scraper@YOUR_PROJECT_ID.iam.gserviceaccount.com
```

---

## Étape 4 : Configurer l'authentification

### Option A : Variable d'environnement (Recommandé pour dev local)

```bash
# Dans votre terminal ou .bashrc/.zshrc
export GOOGLE_APPLICATION_CREDENTIALS="/chemin/vers/go-data-service-account.json"
```

Ou dans le fichier `.env` :

```env
GOOGLE_APPLICATION_CREDENTIALS=/chemin/vers/go-data-service-account.json
```

### Option B : Application Default Credentials (Recommandé pour production)

```bash
# Se connecter avec gcloud
gcloud auth application-default login

# Définir le quota project
gcloud auth application-default set-quota-project YOUR_PROJECT_ID
```

Cette méthode ne nécessite pas de fichier de clé.

---

## Étape 5 : Configurer le fichier .env

```env
# Provider AI
AI_PROVIDER=vertex

# Configuration Vertex AI
GCP_PROJECT_ID=go-data-production-123456
GCP_LOCATION=northamerica-northeast1

# Optionnel : chemin vers le fichier de credentials
# GOOGLE_APPLICATION_CREDENTIALS=/chemin/vers/go-data-service-account.json
```

### Régions disponibles

| Région | Localisation | Latence depuis Montréal |
|--------|--------------|-------------------------|
| `northamerica-northeast1` | Montréal | ~5ms (Recommandé) |
| `northamerica-northeast2` | Toronto | ~15ms |
| `us-central1` | Iowa | ~30ms |
| `us-east4` | Virginie | ~20ms |

---

## Étape 6 : Installer les dépendances Python

```bash
# Activer l'environnement virtuel
source venv/bin/activate

# Installer le SDK Vertex AI
pip install google-cloud-aiplatform

# Optionnel : mettre à jour les dépendances
pip install --upgrade google-cloud-aiplatform
```

---

## Étape 7 : Tester la configuration

```python
# test_vertex.py
import vertexai
from vertexai.generative_models import GenerativeModel

# Initialiser Vertex AI
vertexai.init(project="YOUR_PROJECT_ID", location="northamerica-northeast1")

# Créer le modèle
model = GenerativeModel("gemini-2.0-flash-001")

# Test simple
response = model.generate_content("Dis 'Bonjour Go-Data!' en une phrase.")
print(response.text)
```

Exécuter :

```bash
python test_vertex.py
```

Si tout est bien configuré, vous devriez voir une réponse du modèle.

---

## Dépannage

### Erreur : "Permission denied"

```
google.api_core.exceptions.PermissionDenied: 403 Permission 'aiplatform.endpoints.predict' denied
```

**Solution** : Vérifier que le service account a le rôle `Vertex AI User`.

### Erreur : "Project not found"

```
google.api_core.exceptions.NotFound: 404 Project 'xxx' not found
```

**Solution** : Vérifier l'ID du projet dans `GCP_PROJECT_ID`.

### Erreur : "Could not automatically determine credentials"

```
google.auth.exceptions.DefaultCredentialsError: Could not automatically determine credentials
```

**Solution** : 
1. Définir `GOOGLE_APPLICATION_CREDENTIALS` vers le fichier JSON
2. Ou exécuter `gcloud auth application-default login`

### Erreur : "Quota exceeded"

```
google.api_core.exceptions.ResourceExhausted: 429 Quota exceeded
```

**Solution** : Demander une augmentation de quota dans la console GCP → IAM & Admin → Quotas.

---

## Coûts estimés

### Gemini 2.0 Flash (Vertex AI)

| Type | Prix par 1M tokens |
|------|-------------------|
| Input | $0.075 |
| Output | $0.30 |

### Exemple de coût mensuel

Pour 1000 scrapings/mois avec ~50K tokens par scraping :
- Input : 50M tokens × $0.075 = **$3.75**
- Output : 10M tokens × $0.30 = **$3.00**
- **Total estimé : ~$7/mois**

---

## Checklist de déploiement

- [ ] Projet Google Cloud créé
- [ ] Vertex AI API activée
- [ ] Service Account créé avec rôle `Vertex AI User`
- [ ] Clé JSON téléchargée (ou ADC configuré)
- [ ] `GCP_PROJECT_ID` configuré dans `.env`
- [ ] `AI_PROVIDER=vertex` dans `.env`
- [ ] `google-cloud-aiplatform` installé
- [ ] Test de connexion réussi

---

## Ressources

- [Documentation Vertex AI](https://cloud.google.com/vertex-ai/docs)
- [Modèles Gemini disponibles](https://cloud.google.com/vertex-ai/generative-ai/docs/model-reference/overview)
- [Pricing Vertex AI](https://cloud.google.com/vertex-ai/pricing)
- [Console Google Cloud](https://console.cloud.google.com/)
