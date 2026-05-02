"""Crée ou promeut un compte Go-Data au rôle ``developer``.

Le rôle ``developer`` donne accès à la console développeur ``/admin`` qui
permet de tester et valider les scrapers générés par scraper_usine, voir
l'état du cron horaire, l'activité des clients, etc.

Usage rapide (utilise les credentials par défaut du .env) :
    python scripts/create_developer.py --seed

    # ou avec une commande explicite :
    python scripts/create_developer.py --email dev@go-data.ca --name "Dev Go-Data" --password 'GoData-Dev-2026!'

    # Promouvoir un utilisateur existant
    python scripts/create_developer.py --email dev@go-data.ca --promote

    # Rétrograder un développeur en utilisateur normal
    python scripts/create_developer.py --email dev@go-data.ca --demote

Requiert les variables d'environnement :
    SUPABASE_URL
    SUPABASE_SERVICE_ROLE_KEY

Optionnels (utilisés par --seed) :
    DEV_ADMIN_EMAIL    (défaut : dev@go-data.ca)
    DEV_ADMIN_PASSWORD (défaut : GoData-Dev-2026!)
    DEV_ADMIN_NAME     (défaut : Dev Go-Data)
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path
from typing import Optional

from supabase import create_client

# Charge automatiquement les fichiers .env du projet (root + dashboard_web)
# sans dépendance externe : permet de lancer le script même dans un venv
# minimal qui n'a pas python-dotenv.
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


def _get_user_by_email(supabase, email: str) -> Optional[dict]:
    """Cherche un utilisateur dans la table public.users par email."""
    result = supabase.table("users").select("*").eq("email", email).execute()
    rows = result.data or []
    return rows[0] if rows else None


def _create_auth_user(supabase, email: str, password: str, name: str) -> str:
    """Crée un utilisateur dans Supabase Auth via l'API Admin (service role)."""
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


def _upsert_user_row(supabase, *, user_id: str, email: str, name: str, role: str) -> None:
    """Insère ou met à jour la ligne dans public.users."""
    supabase.table("users").upsert(
        {
            "id": user_id,
            "email": email,
            "name": name,
            "role": role,
        },
        on_conflict="id",
    ).execute()


def cmd_create(supabase, *, email: str, name: str, password: str) -> int:
    existing = _get_user_by_email(supabase, email)
    if existing:
        print(f"⚠️  L'utilisateur {email} existe déjà.")
        print("    → Utilise --promote pour le passer en rôle developer.")
        return 2

    print(f"🔧 Création du compte auth pour {email}...")
    user_id = _create_auth_user(supabase, email=email, password=password, name=name)
    print(f"   ✅ Auth user créé : {user_id}")

    _upsert_user_row(supabase, user_id=user_id, email=email, name=name, role="developer")
    print(f"   ✅ Profil public.users créé avec role='developer'")

    print()
    print("─" * 60)
    print(f"  Compte développeur prêt :")
    print(f"    email    : {email}")
    print(f"    nom      : {name}")
    print(f"    rôle     : developer")
    print(f"    user_id  : {user_id}")
    print("─" * 60)
    print()
    print("  Connecte-toi sur /login avec ce compte ; tu seras redirigé(e)")
    print("  automatiquement vers /admin (console développeur).")
    return 0


def cmd_promote(supabase, *, email: str) -> int:
    existing = _get_user_by_email(supabase, email)
    if not existing:
        print(f"❌ Aucun utilisateur trouvé avec l'email {email}.")
        print("   → Utilise sans --promote pour créer un nouveau compte.")
        return 1

    if existing.get("role") == "developer":
        print(f"ℹ️  {email} est déjà au rôle 'developer'.")
        return 0

    previous = existing.get("role", "?")
    supabase.table("users").update({"role": "developer"}).eq("id", existing["id"]).execute()
    print(f"✅ {email} : rôle '{previous}' → 'developer'")
    return 0


def cmd_demote(supabase, *, email: str) -> int:
    existing = _get_user_by_email(supabase, email)
    if not existing:
        print(f"❌ Aucun utilisateur trouvé avec l'email {email}.")
        return 1

    if existing.get("role") != "developer":
        print(f"ℹ️  {email} n'est pas au rôle 'developer' (rôle actuel : {existing.get('role')}).")
        return 0

    supabase.table("users").update({"role": "user"}).eq("id", existing["id"]).execute()
    print(f"✅ {email} : rôle 'developer' → 'user'")
    return 0


DEFAULT_DEV_EMAIL = "dev@go-data.ca"
DEFAULT_DEV_PASSWORD = "GoData-Dev-2026!"
DEFAULT_DEV_NAME = "Dev Go-Data"


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Crée ou promeut un compte Go-Data au rôle developer."
    )
    parser.add_argument("--email", help="Email du compte (sinon $DEV_ADMIN_EMAIL)")
    parser.add_argument("--name", help="Nom complet (création seulement)")
    parser.add_argument("--password", help="Mot de passe (création seulement)")
    parser.add_argument(
        "--seed", action="store_true",
        help="Crée le compte dev par défaut (utilise les variables DEV_ADMIN_*).",
    )
    parser.add_argument(
        "--promote", action="store_true",
        help="Promouvoir un compte existant au rôle developer.",
    )
    parser.add_argument(
        "--demote", action="store_true",
        help="Rétrograder un compte developer au rôle user.",
    )
    args = parser.parse_args()

    supabase_url = (
        os.environ.get("SUPABASE_URL")
        or os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    )
    service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not supabase_url or not service_key:
        print("❌ SUPABASE_URL (ou NEXT_PUBLIC_SUPABASE_URL) et SUPABASE_SERVICE_ROLE_KEY")
        print("   sont requis. Place-les dans :")
        print("     - .env (à la racine du projet), ou")
        print("     - dashboard_web/.env.local")
        print("   ou exporte-les manuellement dans le shell.")
        return 1

    supabase = create_client(supabase_url, service_key)

    # Mode --seed : credentials par défaut prêts à l'emploi
    if args.seed:
        email = os.environ.get("DEV_ADMIN_EMAIL") or DEFAULT_DEV_EMAIL
        password = os.environ.get("DEV_ADMIN_PASSWORD") or DEFAULT_DEV_PASSWORD
        name = os.environ.get("DEV_ADMIN_NAME") or DEFAULT_DEV_NAME
        existing = _get_user_by_email(supabase, email)
        if existing:
            print(f"ℹ️  {email} existe déjà — promotion en developer.")
            return cmd_promote(supabase, email=email)
        return cmd_create(supabase, email=email, name=name, password=password)

    email = args.email or os.environ.get("DEV_ADMIN_EMAIL")
    if not email:
        print("❌ --email requis (ou variable DEV_ADMIN_EMAIL, ou utilise --seed).")
        return 1

    if args.demote:
        return cmd_demote(supabase, email=email)

    if args.promote:
        return cmd_promote(supabase, email=email)

    name = args.name or os.environ.get("DEV_ADMIN_NAME") or DEFAULT_DEV_NAME
    password = args.password or os.environ.get("DEV_ADMIN_PASSWORD")
    if not password:
        print("❌ --password requis (ou variable DEV_ADMIN_PASSWORD, ou utilise --seed).")
        return 1

    return cmd_create(supabase, email=email, name=name, password=password)


if __name__ == "__main__":
    sys.exit(main())
