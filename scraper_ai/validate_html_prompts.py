"""
Script pour valider les prompts HTML générés par l'agent IA
Vérifie les problèmes potentiels:
1. Accolades non échappées dans les f-strings
2. Triple backticks qui peuvent casser le formatage
3. Caractères Unicode invalides (surrogates)
4. Taille excessive des prompts
"""
import re
from typing import List, Dict, Tuple


def validate_html_in_prompt(html: str, prompt_template: str) -> Dict[str, any]:
    """
    Valide le HTML inséré dans un prompt

    Returns:
        Dict avec les résultats de validation
    """
    issues = []
    warnings = []

    # 1. Vérifier les accolades non échappées (problème avec f-strings)
    # Compter les accolades simples { et } qui ne sont pas échappées {{ ou }}
    unescaped_braces = re.findall(r'(?<!\{)\{(?!\{)|(?<!\})\}(?!\})', html)
    if unescaped_braces:
        count = len(unescaped_braces)
        issues.append({
            'type': 'unescaped_braces',
            'severity': 'error',
            'message': f'Le HTML contient {count} accolades non échappées qui causeront des erreurs dans les f-strings',
            'count': count,
            'example': unescaped_braces[:5]
        })

    # 2. Vérifier les triple backticks (peuvent casser le formatage)
    if '```' in html:
        count = html.count('```')
        warnings.append({
            'type': 'triple_backticks',
            'severity': 'warning',
            'message': f'Le HTML contient {count} triple backticks qui peuvent casser le formatage du prompt',
            'count': count
        })

    # 3. Vérifier les caractères Unicode invalides (surrogates)
    # Les surrogates sont dans la plage U+D800 à U+DFFF
    surrogate_pattern = re.compile(r'[\ud800-\udfff]')
    surrogates = surrogate_pattern.findall(html)
    if surrogates:
        count = len(surrogates)
        issues.append({
            'type': 'unicode_surrogates',
            'severity': 'error',
            'message': f'Le HTML contient {count} caractères Unicode invalides (surrogates) qui causeront UnicodeEncodeError',
            'count': count
        })

    # 4. Vérifier la taille
    html_size = len(html)
    if html_size > 1000000:  # 1MB
        warnings.append({
            'type': 'large_size',
            'severity': 'warning',
            'message': f'Le HTML est très volumineux ({html_size:,} caractères), peut causer des problèmes avec Gemini',
            'size': html_size
        })

    # 5. Vérifier les caractères de contrôle
    control_chars = re.findall(r'[\x00-\x1f\x7f-\x9f]', html)
    if control_chars:
        count = len(control_chars)
        warnings.append({
            'type': 'control_characters',
            'severity': 'warning',
            'message': f'Le HTML contient {count} caractères de contrôle qui peuvent causer des problèmes',
            'count': count
        })

    return {
        'is_valid': len(issues) == 0,
        'issues': issues,
        'warnings': warnings,
        'html_size': html_size
    }


def check_prompt_templates() -> List[Dict]:
    """
    Vérifie les templates de prompts dans le code pour identifier les problèmes potentiels
    """
    problems = []

    # Lire le fichier html_analyzer.py
    try:
        with open('html_analyzer.py', 'r', encoding='utf-8') as f:
            content = f.read()
    except FileNotFoundError:
        return [{'error': 'Fichier html_analyzer.py non trouvé'}]

    # Chercher les endroits où le HTML est inséré dans des f-strings
    # Pattern: pages_html += f"...{html}..." ou prompt = f"...{pages_html}..."
    patterns = [
        (r'pages_html\s*\+=\s*f["\']([^"\']*\{[^}]*html[^}]*\}[^"\']*)["\']',
         'pages_html += f'),
        (r'batch_html\s*\+=\s*f["\']([^"\']*\{[^}]*html[^}]*\}[^"\']*)["\']',
         'batch_html += f'),
        (r'prompt\s*=\s*f["\']{3}([^"\']*\{[^}]*pages_html[^}]*\}[^"\']*)["\']{3}', 'prompt = f"""'),
        (r'prompt\s*=\s*rf["\']{3}([^"\']*\{[^}]*html[^}]*\}[^"\']*)["\']{3}',
         'prompt = rf"""'),
    ]

    for pattern, context in patterns:
        matches = re.finditer(pattern, content, re.MULTILINE | re.DOTALL)
        for match in matches:
            line_num = content[:match.start()].count('\n') + 1
            code_snippet = match.group(0)

            # Vérifier si le HTML est inséré directement sans échappement
            if '{html}' in code_snippet or '{pages_html}' in code_snippet or '{page_data[\'html\']}' in code_snippet:
                problems.append({
                    'line': line_num,
                    'context': context,
                    'code': code_snippet[:200],
                    'issue': 'HTML inséré directement dans f-string - risque d\'erreur si HTML contient des accolades',
                    'severity': 'error'
                })

    return problems


def suggest_fixes() -> Dict[str, str]:
    """
    Suggère des corrections pour les problèmes identifiés
    """
    return {
        'unescaped_braces': """
SOLUTION: Échapper les accolades dans le HTML avant insertion:
```python
# Avant (PROBLÉMATIQUE):
pages_html += f"\\nPAGE: {url}\\n{html}\\n"

# Après (CORRECT):
# Option 1: Utiliser .format() ou % au lieu de f-string
pages_html += "\\nPAGE: {}\\n{}\\n".format(url, html)

# Option 2: Échapper les accolades dans le HTML
html_escaped = html.replace('{', '{{').replace('}', '}}')
pages_html += f"\\nPAGE: {url}\\n{html_escaped}\\n"

# Option 3: Utiliser des raw strings avec .format()
pages_html += "\\nPAGE: {url}\\n{html}\\n".format(url=url, html=html)
```
""",
        'triple_backticks': """
SOLUTION: Remplacer ou échapper les triple backticks:
```python
# Remplacer les triple backticks par des doubles
html = html.replace('```', '``')
```
""",
        'unicode_surrogates': """
SOLUTION: Utiliser clean_html() avant insertion:
```python
from ai_tools import AITools
tools = AITools(base_url)
html = tools.clean_html(html)  # Nettoie les surrogates
pages_html += f"\\nPAGE: {url}\\n{html}\\n"
```
""",
        'large_size': """
SOLUTION: Traiter par lots (déjà implémenté dans le code):
```python
if len(pages_html) > 500000:
    # Traiter par lots de 50 URLs
    batch_size = 50
    # ...
```
"""
    }


if __name__ == '__main__':
    print("=" * 60)
    print("VALIDATION DES PROMPTS HTML")
    print("=" * 60)

    # 1. Vérifier les templates de prompts
    print("\n1. Vérification des templates de prompts...")
    problems = check_prompt_templates()

    if problems:
        print(f"   ❌ {len(problems)} problèmes trouvés dans les templates:")
        for problem in problems:
            print(f"      Ligne {problem['line']}: {problem['issue']}")
            print(f"         Code: {problem['code'][:100]}...")
    else:
        print("   ✅ Aucun problème évident dans les templates")

    # 2. Afficher les suggestions
    print("\n2. Suggestions de corrections:")
    fixes = suggest_fixes()
    for issue_type, fix in fixes.items():
        print(f"\n   {issue_type.upper()}:")
        print(fix)

    print("\n" + "=" * 60)
    print("RECOMMANDATIONS:")
    print("=" * 60)
    print("""
1. TOUJOURS utiliser clean_html() avant d'insérer le HTML dans un prompt
2. ÉVITER les f-strings directes avec {html} - utiliser .format() ou échapper
3. VÉRIFIER la taille du HTML avant envoi à Gemini
4. REMPLACER les triple backticks dans le HTML
5. UTILISER des raw strings (r"...") pour les templates avec beaucoup de backslashes
    """)

