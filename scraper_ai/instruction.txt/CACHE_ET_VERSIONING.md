# Système de Cache et Versioning du Prompt

## 🔄 Comment ça fonctionne

Le système utilise un **cache** pour éviter de régénérer les scrapers à chaque fois. Cependant, si le **prompt** (instructions données à Gemini) change, les scrapers en cache deviennent obsolètes.

### ✅ Solution Automatique : Versioning du Prompt

Un système de **versioning automatique** a été ajouté :

1. **Version du prompt** : Définie dans `html_analyzer.py` comme `PROMPT_VERSION = "2.1"`
2. **Vérification automatique** : À chaque chargement du cache, la version est vérifiée
3. **Invalidation automatique** : Si la version ne correspond pas, le cache est supprimé et le scraper est régénéré

### 📋 Changer la Version

Quand vous modifiez le prompt dans `html_analyzer.py`, **incrémentez la version** :

```python
# Version du prompt - Incrémenter cette valeur quand le prompt change
PROMPT_VERSION = "2.2"  # Nouvelle version après vos modifications
```

**Exemple de versions :**
- `"2.1"` : Correction boucle infinie pagination + limite sécurité
- `"2.2"` : Ajout de nouvelles fonctionnalités
- `"2.3"` : Correction de bugs

---

## 🛠️ Forcer la Régénération Manuellement

Si vous voulez forcer la régénération sans changer la version, vous avez 3 options :

### Option 1 : Utiliser `--force-refresh` (Recommandé)

```bash
python -m scraper_ai.main --force-refresh https://example.com
```

Cela ignore le cache et régénère le scraper avec le prompt actuel.

### Option 2 : Invalider le cache spécifiquement

```bash
python -m scraper_ai.main --invalidate-cache https://example.com
```

Cela supprime le cache pour l'URL spécifiée, mais ne lance pas le scraping.

### Option 3 : Supprimer manuellement le cache

Les fichiers de cache sont dans le dossier `cache/` (défini dans `config.py`).

```bash
# Supprimer tous les caches
rm -rf cache/*.json

# Ou supprimer un cache spécifique
rm cache/[hash].json
```

---

## 🔍 Vérifier la Version du Cache

Quand un scraper est chargé depuis le cache, vous verrez :

```
✅ Scraper chargé depuis le cache: cache/abc123.json
   Version prompt: 2.1
```

Si la version ne correspond pas :

```
⚠️ Version du prompt différente (cache: 2.0, actuelle: 2.1)
   Le prompt a été modifié, invalidation du cache...
🔍 ANALYSE DU SITE AVEC GEMINI + OUTILS AI
```

---

## 📝 Checklist après Modification du Prompt

- [ ] Modifier le prompt dans `html_analyzer.py`
- [ ] **Incrémenter `PROMPT_VERSION`** (ex: `"2.1"` → `"2.2"`)
- [ ] Tester avec `--force-refresh` pour vérifier que ça fonctionne
- [ ] Les prochains scrapes utiliseront automatiquement le nouveau prompt

---

## ⚠️ Important

**Si vous modifiez le prompt mais oubliez d'incrémenter la version :**
- Les scrapers en cache continueront d'utiliser l'ancien prompt
- Les nouvelles fonctionnalités ne seront pas appliquées
- **Toujours incrémenter la version après modification du prompt !**

---

## 🎯 Exemple Complet

```python
# html_analyzer.py

# Avant modification
PROMPT_VERSION = "2.1"

# ... modifications du prompt ...

# Après modification
PROMPT_VERSION = "2.2"  # ← Incrémenter ici !
```

Ensuite, au prochain scrape :
- Les scrapers avec version `2.1` seront automatiquement invalidés
- Un nouveau scraper sera généré avec le prompt `2.2`

---

**Date de création :** $(date)
**Dernière mise à jour :** Version 2.1 (Correction boucle infinie)

