#!/usr/bin/env python3
"""Tests du regroupement multi-unités (scraper_ai/grouping.py).

Usage : python3 scripts/test_grouping.py
Issue : https://github.com/Txs-Mav/scraper_mav/issues/1
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scraper_ai.grouping import compute_unit_key, group_identical_products  # noqa: E402

FAILURES = []


def check(label, cond, extra=None):
    if cond:
        print(f"  ✅ {label}")
    else:
        FAILURES.append(label)
        print(f"  ❌ {label} — {extra}")


def him(inv, prix):
    return {
        'name': 'Royal Enfield Himalayan 450 2025', 'prix': prix, 'inventaire': inv,
        'sourceUrl': f'https://x.com/fr/i/royal-enfield-himalayan-450-2025-a-vendre-{inv}/',
        'marque': 'Royal Enfield', 'modele': 'Himalayan 450', 'annee': 2025, 'etat': 'neuf',
    }


# 1. Mono-unité : sortie identique à l'ancien comportement
out = group_identical_products([him('84565', 8495)])
check("mono-unité : pas de units/multi_unit", len(out) == 1
      and 'units' not in out[0] and 'multi_unit' not in out[0]
      and out[0]['quantity'] == 1, out)

# 2. Trois unités : units[] complet, prix = min, quantity = 3
out = group_identical_products([him('84565', 8495), him('ins52090', 7099), him('ins52093', 6995)])
g = out[0]
check("3 unités : multi_unit + prix min", len(out) == 1 and g['multi_unit'] is True
      and g['prix'] == 6995 and g['quantity'] == 3, g)
check("3 unités : units[] porte les 3 prix",
      [u['prix'] for u in g['units']] == [8495, 7099, 6995]
      and [u['unit_key'] for u in g['units']] == ['84565', 'ins52090', 'ins52093'], g.get('units'))

# 3. Cascade unit_key : vin → inventaire → ID URL → URL → md5
check("cascade : vin prioritaire",
      compute_unit_key({'vin': 'SN1TLC9B5SC629648', 'inventaire': '86987'}) == 'SN1TLC9B5SC629648')
check("cascade : inventaire",
      compute_unit_key({'inventaire': '86987', 'sourceUrl': 'https://x/a-vendre-99999/'}) == '86987')
check("cascade : ID de fin d'URL (alphanumérique)",
      compute_unit_key({'sourceUrl': 'https://x/triumph-scrambler-1200-x-2026-a-vendre-inst4/'}) == 'inst4')
check("cascade : ID de fin d'URL (numérique)",
      compute_unit_key({'sourceUrl': 'https://x/re-bear-650-2025-a-vendre-84568/'}) == '84568')
check("cascade : URL sans ID → URL complète",
      compute_unit_key({'sourceUrl': 'https://kijiji.ca/v-moto/annonce-abc'}) == 'https://kijiji.ca/v-moto/annonce-abc')
k1 = compute_unit_key({'name': 'Yamaha MT-07 2026', 'couleur': 'Bleu'})
check("cascade : repli md5 stable 12 car.",
      k1 == compute_unit_key({'name': 'Yamaha MT-07 2026', 'couleur': 'Bleu'}) and len(k1) == 12, k1)
# Parité inter-langages (même valeur codée en dur côté TS : test-detect-changes.ts)
check("parité md5 avec TS/SQL", k1 == '389ba0e9c24a', k1)

# 4. Dédup par URL : même page crawlée deux fois = une seule unité
out = group_identical_products([him('84565', 8495), him('84565', 8495)])
check("dédup URL : pas de fausse 2e unité", out[0]['quantity'] == 1 and 'units' not in out[0], out)

# 5. vin_split (St-Onge Ford) : deux VIN identiques de modèle → jamais fusionnés
vp = lambda vin: {'name': 'Ford F-150 2026', 'prix': 65000, 'vin': vin, 'marque': 'Ford',
                  'modele': 'F-150', 'annee': 2026, 'etat': 'neuf', 'sourceUrl': '',
                  'quantity': 1, 'groupedUrls': ['']}
out = group_identical_products([vp('1FTFW1E50PFA00001'), vp('1FTFW1E50PFA00002')],
                               dedupe_by_url=False, vin_split=True)
check("vin_split : 2 VIN = 2 groupes", len(out) == 2, [o.get('quantity') for o in out])

# 6. Prix manquant sur le leader, présent sur une jumelle → complété
a = him('84565', None)
a['prix'] = None
out = group_identical_products([a, him('ins52093', 6995)])
check("prix manquant complété par la jumelle", out[0]['prix'] == 6995, out[0].get('prix'))

print()
if FAILURES:
    print(f"{len(FAILURES)} ÉCHEC(S) : {FAILURES}")
    sys.exit(1)
print("TOUS LES TESTS PASSENT")
