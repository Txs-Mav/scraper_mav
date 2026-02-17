# Vérifier que Vertex AI fonctionne avec le scraper

## 1. Test rapide du GeminiClient (recommandé)

Depuis la racine du projet :

```bash
source venv/bin/activate  # ou sans venv si python3 fonctionne
python3 -c "
from scraper_ai.gemini_client import GeminiClient
client = GeminiClient()
result = client.call('Réponds en JSON: {\"ok\": true, \"message\": \"Vertex AI scraper ready\"}', schema={'type': 'object', 'properties': {'ok': {'type': 'boolean'}, 'message': {'type': 'string'}}, 'required': ['ok', 'message']}, show_prompt=False)
print('✅ GeminiClient Vertex AI OK:', result)
"
```

---

## 2. Lancer le scraper AI (test complet)

```bash
cd /Users/maverickmenard/Desktop/project/go_data/scraper_mav
source venv/bin/activate
python3 -m scraper_ai.main --url "https://exemple.com"  # Remplace par une vraie URL
```

Ou via le dashboard web : crée un nouveau scraping et lance-le.

---

## 3. Vérifier sur Google Cloud Console

### a) Voir les requêtes Vertex AI

1. Va sur [console.cloud.google.com](https://console.cloud.google.com/)
2. Sélectionne le projet **go-data-485202**
3. Menu **Vertex AI** → **Generative AI** → **Modèles**
4. Tu peux tester des modèles directement dans la console

### b) Voir l’utilisation (billing)

1. Menu **Facturation** → **Rapports**
2. Filtre par produit : **Vertex AI**
3. Tu verras les requêtes et les coûts associés

### c) Voir les logs

1. Menu **Logging** → **Logs Explorer**
2. Requête exemple :
   ```
   resource.type="aiplatform.googleapis.com/Endpoint"
   ```
3. Ou filtre par :
   ```
   protoPayload.serviceName="aiplatform.googleapis.com"
   ```

### d) Vérifier que l’API est activée

1. Menu **APIs & Services** → **Bibliothèque**
2. Recherche **Vertex AI API**
3. Statut : **Activé** ✅

---

## 4. Checklist de vérification

| Étape | Commande / action | Résultat attendu |
|-------|-------------------|------------------|
| Test Vertex AI | `python3 test_vertex.py` | "Vertex AI est correctement configuré !" |
| Test GeminiClient | Script ci-dessus | `{'ok': True, 'message': '...'}` |
| Scraper complet | Lancer un scraping via dashboard | Données extraites |
| Console GCP | Vertex AI → Modèles | Page accessible |
| Facturation | Facturation → Rapports | Requêtes Vertex AI visibles |

---

## 5. En cas de problème

**Erreur 404 (modèle non trouvé)**  
→ Utilise `GCP_LOCATION=global` dans `.env`

**Erreur 403 (permission denied)**  
→ Vérifie le rôle **Vertex AI User** sur ton compte

**Erreur "Could not determine credentials"**  
→ Relance `gcloud auth application-default login`

**Pas de requêtes dans les rapports**  
→ Les premières requêtes peuvent mettre quelques minutes à apparaître
