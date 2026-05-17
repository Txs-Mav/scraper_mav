# Mini-bench scraper_usine — Phase 3 du plan optimisation coûts Claude

Ce dossier contient l'outillage pour le **bench A/B** entre :
- mode actuel (Opus 100 % sur supervisor + agent)
- mode hybride (Opus diagnose + Sonnet write, agent hybride)

## Prérequis (à faire UNE fois avant la Phase 3)

### 1. Phase 1.3 — Capture de la baseline v0 (config actuelle, Opus partout)

```bash
# Mode actuel : CLAUDE_HYBRID_ENABLED=0 (defaut), Opus partout
CLAUDE_HYBRID_ENABLED=0 python scripts/usine_bench.py \
    --sites scripts/usine_bench_mini.yaml \
    --output scraper_cache/bench/baseline_v0.json
```

Sortie attendue : `scraper_cache/bench/baseline_v0.json` avec score, couverture, **cout total $**
(la Phase 1.1 a enrichi `usine_bench.py` pour extraire automatiquement les coûts depuis
`scraper_cache/supervision/{slug}_audit.json`).

### 2. Phase 1.4 — Enregistrer les golden records (référence qualité)

Pour chacun des 3 sites du mini-bench, enregistrer un échantillon de référence :

```bash
# Après chaque run du baseline (le fichier dedicated_scrapers/{slug}.py existe)
python -m scraper_ai.scraper_usine.main --golden-record sportplusmoto
python -m scraper_ai.scraper_usine.main --golden-record bmwlaval
python -m scraper_ai.scraper_usine.main --golden-record machinexperts
```

Sortie : `scraper_cache/golden/{slug}.json` avec 5-10 produits de référence par site.

## Phase 3 — Bench A/B (à lancer après implémentation Phase 2)

### Phase 3.1 — Bench avec hybride OFF (validation que rien n'a régressé)

```bash
CLAUDE_HYBRID_ENABLED=0 python scripts/usine_bench.py \
    --sites scripts/usine_bench_mini.yaml \
    --output scraper_cache/bench/bench_hybrid_off.json
```

Doit être quasi-identique à `baseline_v0.json` (les optimisations Phase 0 acquises ne
changent pas les décisions Claude).

### Phase 3.2 — Bench avec hybride ON

```bash
CLAUDE_HYBRID_ENABLED=1 python scripts/usine_bench.py \
    --sites scripts/usine_bench_mini.yaml \
    --output scraper_cache/bench/bench_hybrid_on.json
```

### Phase 3.3 — Comparaison automatique (critères GO/NO-GO)

```bash
python scripts/compare_bench_runs.py \
    scraper_cache/bench/bench_hybrid_off.json \
    scraper_cache/bench/bench_hybrid_on.json
```

Critères GO (tous obligatoires) :
- Score moyen ON >= score moyen OFF (à +- 2 points)
- **Aucun site** ne passe de score >= 80 a score < 80
- Couverture par champ : aucune régression > 5 pts sur `name`, `prix`, `sourceUrl`, `image`
- `golden_diff` sur les 3 sites : 0 régression
- Coût total ON < 50 % du coût total OFF
- Smoke test post-patch (Phase 2.4) : 0 faux positif
- Sur le site qui passe par Phase 4.5 : Sonnet a accompli la mission en <= 8 tours

Si NO-GO : rester en hybride OFF, investiguer le diagnostic Opus ou le PlanDeMission de
l'agent. Phase 0 reste acquise.

## Estimation budgétaire des bench (avant lancement)

Sur 3 sites du mini-bench :

| Bench | Coût estimé | Modèles utilisés |
|-------|-------------|------------------|
| baseline_v0 (Opus) | ~3-5 $ | Opus partout |
| bench_hybrid_off | ~2-3 $ | Opus partout (Phase 0 acquise réduit déjà) |
| bench_hybrid_on | ~0.50-1 $ | Opus diagnose + Sonnet write |

Total prérequis Phase 1 + Phase 3 : **~5-9 $**.

## Comparaison post-bench dans /admin/usine

Phase 5.3 ajoutera un dashboard de coût mais en attendant :

```bash
# Dump rapide des coûts par phase pour un site
python -c "
import json
audit = json.load(open('scraper_cache/supervision/sportplusmoto_audit.json'))
print(f\"Total : \${audit.get('total_cost_usd', 0):.4f}\")
for ev in audit.get('events', []):
    print(f\"  {ev['phase']:25s} \${ev.get('cost_usd', 0):.4f}  ({ev.get('model', '?')})\")
"
```
