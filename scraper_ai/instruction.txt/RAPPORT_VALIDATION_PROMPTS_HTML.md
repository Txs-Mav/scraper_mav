# Rapport de Validation des Prompts HTML

## Résumé Exécutif

**Statut**: ⚠️ **PROBLÈMES IDENTIFIÉS**

Les prompts HTML générés par l'agent IA présentent plusieurs problèmes potentiels qui peuvent causer des erreurs lors de l'exécution.

## Problèmes Identifiés

### 1. ❌ Accolades non échappées dans les f-strings (CRITIQUE)

**Localisation**: 
- `html_analyzer.py` ligne 1109, 1121, 1341 (dans le prompt généré)
- Code généré par Gemini (dans les scrapers)

**Problème**: 
Le HTML est inséré directement dans des f-strings avec `{html}`. Si le HTML contient des accolades `{}`, Python essaiera de les interpréter comme des placeholders, causant une `KeyError` ou `ValueError`.

**Exemple problématique**:
```python
pages_html += f"\nPAGE: {url}\n{html}\n"  # ❌ Erreur si html contient { ou }
```

**Impact**: 
- Erreurs lors de l'exécution des scrapers générés
- Échec silencieux si le HTML contient des accolades

### 2. ⚠️ Triple backticks dans le HTML (MOYEN)

**Problème**: 
Si le HTML contient des triple backticks ```, cela peut casser le formatage du prompt et causer des problèmes de parsing.

**Impact**: 
- Prompt mal formaté
- Erreurs de parsing par Gemini

### 3. ⚠️ Caractères Unicode invalides (SURROGATES) (CRITIQUE)

**Problème**: 
Le HTML peut contenir des caractères Unicode invalides (surrogates U+D800 à U+DFFF) qui causent `UnicodeEncodeError` lors de l'envoi à Gemini.

**Solution actuelle**: 
La fonction `clean_html()` existe dans `ai_tools.py` mais n'est pas toujours utilisée avant l'insertion dans les prompts.

**Impact**: 
- `UnicodeEncodeError` lors de l'envoi à Gemini
- Échec complet du scraping

### 4. ⚠️ Taille excessive des prompts (MOYEN)

**Problème**: 
Les prompts peuvent devenir très volumineux (>1MB) si beaucoup de pages HTML sont incluses.

**Solution actuelle**: 
Le code traite déjà par lots si >500KB, mais la limite pourrait être ajustée.

## Solutions Recommandées

### Solution 1: Fonction utilitaire pour sécuriser l'insertion HTML

Créer une fonction qui:
1. Nettoie le HTML (surrogates)
2. Échappe les accolades
3. Remplace les triple backticks
4. Valide la taille

```python
def prepare_html_for_prompt(html: str) -> str:
    """
    Prépare le HTML pour insertion sécurisée dans un prompt
    
    - Nettoie les surrogates Unicode
    - Échappe les accolades pour éviter les erreurs dans f-strings
    - Remplace les triple backticks
    """
    # 1. Nettoyer les surrogates
    html = clean_html(html)
    
    # 2. Échapper les accolades (pour éviter erreurs dans f-strings)
    html = html.replace('{', '{{').replace('}', '}}')
    
    # 3. Remplacer triple backticks
    html = html.replace('```', '``')
    
    return html
```

### Solution 2: Utiliser .format() au lieu de f-strings

Pour les templates dans les prompts générés, utiliser `.format()` au lieu de f-strings:

```python
# ❌ PROBLÉMATIQUE:
pages_html += f"\nPAGE: {url}\n{html}\n"

# ✅ CORRECT:
pages_html += "\nPAGE: {}\n{}\n".format(url, html)
```

### Solution 3: S'assurer que clean_html() est toujours appelé

Vérifier que `clean_html()` est appelé partout où le HTML est inséré dans un prompt.

## Actions Correctives

### Priorité 1 (CRITIQUE)
1. ✅ Créer une fonction `prepare_html_for_prompt()` dans `ai_tools.py`
2. ✅ Modifier le prompt généré pour utiliser cette fonction
3. ✅ S'assurer que tous les scrapers générés utilisent cette fonction

### Priorité 2 (IMPORTANT)
1. ⚠️ Vérifier que `clean_html()` est appelé partout
2. ⚠️ Ajouter validation de la taille des prompts

### Priorité 3 (AMÉLIORATION)
1. 📝 Améliorer la gestion des lots pour les très gros sites
2. 📝 Ajouter des logs pour détecter les problèmes

## Tests Recommandés

1. Tester avec un HTML contenant des accolades `{}`
2. Tester avec un HTML contenant des triple backticks ```
3. Tester avec un HTML contenant des surrogates Unicode
4. Tester avec un très gros HTML (>1MB)

## Conclusion

Les prompts HTML ne sont **pas complètement valides** dans l'état actuel. Des corrections sont nécessaires pour éviter les erreurs lors de l'exécution des scrapers générés.

