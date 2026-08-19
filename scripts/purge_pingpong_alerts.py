#!/usr/bin/env python3
"""Purge des fausses alertes « ping-pong » dans alert_changes.

Contexte (issue Txs-Mav/scraper_mav#1) : avant la détection par unité,
plusieurs unités du même modèle étaient fusionnées par nom, produisant des
paires d'alertes exactement inverses (baisse 8 495 → 6 995 $ puis hausse
6 995 → 8 495 $) sans changement réel. Ce script les identifie et les
supprime.

Critère chirurgical : deux alertes price_increase/price_decrease sur le même
(product_name, source_site, user_id) dont old/new sont EXACTEMENT inversés,
détectées à moins de WINDOW_DAYS d'écart. Les DEUX membres de chaque paire
sont supprimés (aucun des deux n'est un vrai changement), ainsi que les
répétitions à l'identique d'un membre déjà apparié.

Usage :
    python3 scripts/purge_pingpong_alerts.py            # dry-run (défaut)
    python3 scripts/purge_pingpong_alerts.py --apply    # backup + DELETE

Le DELETE passe par PostgREST avec la clé service de dashboard_web/.env.local.
Un backup JSON des lignes supprimées est écrit à côté du script.
"""
import argparse
import json
import os
import sys
import urllib.parse
import urllib.request
from collections import defaultdict
from datetime import datetime, timedelta
from pathlib import Path

WINDOW_DAYS = 7
REPO_ROOT = Path(__file__).resolve().parent.parent
ENV_LOCAL = REPO_ROOT / "dashboard_web" / ".env.local"


def load_env():
    url = key = None
    for line in ENV_LOCAL.read_text().splitlines():
        if line.startswith("NEXT_PUBLIC_SUPABASE_URL="):
            url = line.split("=", 1)[1].strip()
        elif line.startswith("SUPABASE_SERVICE_ROLE_KEY="):
            key = line.split("=", 1)[1].strip()
    if not url or not key:
        sys.exit(f"URL/clé service introuvables dans {ENV_LOCAL}")
    return url, key


def rest(base, key, method, path, params=None, body=None):
    qs = f"?{urllib.parse.urlencode(params)}" if params else ""
    req = urllib.request.Request(
        f"{base}/rest/v1/{path}{qs}",
        method=method,
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "Prefer": "return=representation",
        },
        data=json.dumps(body).encode() if body is not None else None,
    )
    with urllib.request.urlopen(req) as resp:
        raw = resp.read()
        return json.loads(raw) if raw else []


def fetch_price_alerts(base, key):
    """Toutes les alertes de prix, paginées (PostgREST plafonne à 1000)."""
    rows, offset = [], 0
    while True:
        page = rest(base, key, "GET", "alert_changes", {
            "select": "id,user_id,product_name,source_site,change_type,old_value,new_value,detected_at,created_at",
            "change_type": "in.(price_increase,price_decrease)",
            "order": "created_at.asc",
            "limit": "1000",
            "offset": str(offset),
        })
        rows.extend(page)
        if len(page) < 1000:
            return rows
        offset += 1000


def find_pingpong(rows):
    """Repère les paires inverses puis les répétitions de leurs membres."""
    by_product = defaultdict(list)
    for r in rows:
        by_product[(r["user_id"], r["source_site"], (r["product_name"] or "").strip().lower())].append(r)

    doomed = {}  # id -> (raison, ligne)
    for group in by_product.values():
        group.sort(key=lambda r: r["created_at"])
        paired = set()
        # Passe 1 : paires exactement inverses dans la fenêtre
        for i, a in enumerate(group):
            if a["id"] in paired:
                continue
            for b in group[i + 1:]:
                if b["id"] in paired:
                    continue
                if a["old_value"] == b["new_value"] and a["new_value"] == b["old_value"]:
                    ta = datetime.fromisoformat(a["created_at"].replace("Z", "+00:00"))
                    tb = datetime.fromisoformat(b["created_at"].replace("Z", "+00:00"))
                    if abs(tb - ta) <= timedelta(days=WINDOW_DAYS):
                        paired.update({a["id"], b["id"]})
                        doomed[a["id"]] = ("paire inverse", a)
                        doomed[b["id"]] = ("paire inverse", b)
                        break
        # Passe 2 : répétitions à l'identique d'un membre déjà condamné
        # (la même « baisse » re-détectée plusieurs jours de suite)
        signatures = {(r["old_value"], r["new_value"]) for rid, (_, r) in doomed.items()
                      if r["id"] in {g["id"] for g in group}}
        for r in group:
            if r["id"] not in doomed and (r["old_value"], r["new_value"]) in signatures:
                doomed[r["id"]] = ("répétition d'un membre de paire", r)

    return doomed


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="Backup + DELETE (défaut : dry-run)")
    args = parser.parse_args()

    base, key = load_env()
    rows = fetch_price_alerts(base, key)
    print(f"{len(rows)} alertes de prix dans alert_changes")

    doomed = find_pingpong(rows)
    if not doomed:
        print("Aucune paire inverse détectée — rien à purger.")
        return

    by_site = defaultdict(int)
    for _, (reason, r) in doomed.items():
        by_site[r["source_site"]] += 1

    print(f"\n{len(doomed)} lignes à purger :")
    for site, n in sorted(by_site.items(), key=lambda kv: -kv[1]):
        print(f"  {site:35} {n}")

    print("\nÉchantillon (20 premières) :")
    for rid, (reason, r) in list(doomed.items())[:20]:
        print(f"  [{reason}] {r['created_at'][:10]} {r['product_name'][:45]:45} "
              f"{r['change_type']:15} {r['old_value']} → {r['new_value']}")

    if not args.apply:
        print("\nDRY-RUN — rien n'a été supprimé. Relancer avec --apply pour purger.")
        return

    backup_path = Path(__file__).parent / f"alert_changes_pingpong_backup_{datetime.now():%Y%m%d_%H%M%S}.json"
    backup_path.write_text(json.dumps([r for _, (_, r) in doomed.items()], indent=2, ensure_ascii=False))
    print(f"\nBackup écrit : {backup_path}")

    ids = list(doomed.keys())
    for i in range(0, len(ids), 100):
        chunk = ids[i:i + 100]
        rest(base, key, "DELETE", "alert_changes", {"id": f"in.({','.join(chunk)})"})
    print(f"{len(ids)} lignes supprimées de alert_changes.")

    # Requête de contrôle post-déploiement (critère d'acceptation n° 10)
    print("\nContrôle : refaire tourner ce script en dry-run dans 7 jours — "
          "il doit afficher « Aucune paire inverse détectée ».")


if __name__ == "__main__":
    main()
