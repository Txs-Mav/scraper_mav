"""Crée un compte utilisateur Go-Data directement (bypass email de confirmation).

Utilise l'API Admin Supabase (service_role) pour créer un compte sans passer
par le flow de signup web (donc pas d'email de confirmation à valider).

Usage :
    # Compte 'user' standard avec plan 'free'
    python scripts/create_user.py --email yan@example.com --password 'Pwd2026!' --name "Yan Morin"

    # Compte 'user' avec plan 'ultime' débloqué (équivalent à un compte premium offert)
    python scripts/create_user.py \
        --email yan@example.com \
        --password 'Pwd2026!' \
        --name "Yan Morin" \
        --plan ultime \
        --source promo

    # Compte 'main' (super-admin) avec plan ultime
    python scripts/create_user.py \
        --email owner@go-data.ca \
        --password 'StrongPwd!' \
        --name "Owner" \
        --role main \
        --plan ultime \
        --source promo

Requiert (dans .env racine ou dashboard_web/.env.local) :
    SUPABASE_URL (ou NEXT_PUBLIC_SUPABASE_URL)
    SUPABASE_SERVICE_ROLE_KEY
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path
from typing import Optional

from supabase import create_client


def _load_env_file(path: Path) -> None:
    if not path.exists():
        return
    try:
        for raw in path.read_text(encoding="utf-8").splitlines():
            line = raw.strip()
            if not line or line.startswith("#"):
                continue
            if line.startswith("export "):
                line = line[len("export "):].strip()
            if "=" not in line:
                continue
            key, _, val = line.partition("=")
            key = key.strip()
            val = val.strip()
            if (val.startswith('"') and val.endswith('"')) or (val.startswith("'") and val.endswith("'")):
                val = val[1:-1]
            os.environ.setdefault(key, val)
    except OSError:
        pass


_PROJECT_ROOT = Path(__file__).resolve().parent.parent
for _candidate in (
    _PROJECT_ROOT / ".env",
    _PROJECT_ROOT / "dashboard_web" / ".env.local",
    _PROJECT_ROOT / "dashboard_web" / ".env",
):
    _load_env_file(_candidate)


VALID_ROLES = {"main", "developer", "employee", "user", "owner", "member"}
VALID_PLANS = {"free", "standard", "pro", "ultime", "premium"}
VALID_SOURCES = {"stripe", "promo"}


def _get_user_by_email(supabase, email: str) -> Optional[dict]:
    result = supabase.table("users").select("*").eq("email", email).execute()
    rows = result.data or []
    return rows[0] if rows else None


def _create_auth_user(supabase, *, email: str, password: str, name: str) -> str:
    """Crée un user dans Supabase Auth avec email auto-confirmé."""
    response = supabase.auth.admin.create_user(
        {
            "email": email,
            "password": password,
            "email_confirm": True,
            "user_metadata": {"name": name},
        }
    )
    auth_user = getattr(response, "user", None) or response.get("user")  # type: ignore[union-attr]
    if not auth_user:
        raise RuntimeError(f"Impossible de créer l'utilisateur auth pour {email}")
    return auth_user.id  # type: ignore[union-attr]


def _upsert_user_row(
    supabase,
    *,
    user_id: str,
    email: str,
    name: str,
    role: str,
    plan: str,
    source: Optional[str],
) -> None:
    payload = {
        "id": user_id,
        "email": email,
        "name": name,
        "role": role,
        "subscription_plan": plan,
    }
    if source is not None:
        payload["subscription_source"] = source
    supabase.table("users").upsert(payload, on_conflict="id").execute()


def _upsert_subscription(supabase, *, user_id: str, plan: str) -> None:
    """Crée/maj la ligne dans subscriptions (status='active')."""
    supabase.table("subscriptions").upsert(
        {
            "user_id": user_id,
            "plan": plan,
            "status": "active",
        },
        on_conflict="user_id",
    ).execute()


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Crée un compte utilisateur Go-Data directement (sans email de confirmation).",
    )
    parser.add_argument("--email", required=True, help="Email du compte à créer")
    parser.add_argument("--password", required=True, help="Mot de passe initial")
    parser.add_argument("--name", required=True, help="Nom complet affiché")
    parser.add_argument(
        "--role",
        default="user",
        choices=sorted(VALID_ROLES),
        help="Rôle applicatif (défaut: user)",
    )
    parser.add_argument(
        "--plan",
        default="free",
        choices=sorted(VALID_PLANS),
        help="subscription_plan (défaut: free)",
    )
    parser.add_argument(
        "--source",
        default=None,
        choices=sorted(VALID_SOURCES),
        help="subscription_source — requis pour qu'un plan pro/ultime soit considéré actif",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Si l'email existe déjà, met simplement à jour le profil (pas de re-create auth).",
    )
    args = parser.parse_args()

    if args.role in {"main", "developer"}:
        print(f"⚠️  Rôle '{args.role}' demandé : préfère scripts/create_developer.py pour 'developer'.")
        print("   On continue, mais sois sûr de ce que tu fais.")

    if args.plan in {"pro", "ultime", "premium"} and args.source is None:
        print(f"⚠️  Plan '{args.plan}' sans --source : le système ne le considérera PAS")
        print("    comme un abonnement actif. Utilise --source promo (ou stripe).")

    supabase_url = (
        os.environ.get("SUPABASE_URL")
        or os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    )
    service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not supabase_url or not service_key:
        print("❌ SUPABASE_URL (ou NEXT_PUBLIC_SUPABASE_URL) et SUPABASE_SERVICE_ROLE_KEY")
        print("   sont requis. Place-les dans .env (racine) ou dashboard_web/.env.local.")
        return 1

    supabase = create_client(supabase_url, service_key)

    existing = _get_user_by_email(supabase, args.email)
    if existing and not args.force:
        print(f"⚠️  L'utilisateur {args.email} existe déjà.")
        print("    → Utilise --force pour mettre à jour son profil (rôle/plan/source).")
        return 2

    if existing and args.force:
        user_id = existing["id"]
        print(f"🔧 Mise à jour du profil existant pour {args.email} (id={user_id})...")
    else:
        print(f"🔧 Création du compte auth pour {args.email}...")
        user_id = _create_auth_user(
            supabase, email=args.email, password=args.password, name=args.name
        )
        print(f"   ✅ Auth user créé : {user_id}")

    _upsert_user_row(
        supabase,
        user_id=user_id,
        email=args.email,
        name=args.name,
        role=args.role,
        plan=args.plan,
        source=args.source,
    )
    print(f"   ✅ public.users : role={args.role}, plan={args.plan}, source={args.source or '∅'}")

    _upsert_subscription(supabase, user_id=user_id, plan=args.plan)
    print(f"   ✅ public.subscriptions : plan={args.plan}, status=active")

    print()
    print("─" * 60)
    print("  Compte prêt à utiliser :")
    print(f"    email    : {args.email}")
    print(f"    nom      : {args.name}")
    print(f"    rôle     : {args.role}")
    print(f"    plan     : {args.plan}")
    print(f"    source   : {args.source or '∅'}")
    print(f"    user_id  : {user_id}")
    print("─" * 60)
    print()
    print("  Connecte-toi sur /login avec ces credentials.")
    print("  L'email est déjà confirmé : pas de validation à faire.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
