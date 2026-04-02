#!/usr/bin/env python3
"""
Script de gestion des mots de passe clients pour Go-Data.

Permet de :
  1. Sauvegarder le mot de passe actuel d'un client
  2. Le remplacer par un mot de passe temporaire
  3. Se connecter au compte pour le configurer
  4. Restaurer le mot de passe original du client

Pre-requis :
  - Deployer tools/manage_client_password.sql dans Supabase (une seule fois)
  - pip install requests python-dotenv
"""

import json
import os
import sys
import time
from pathlib import Path

try:
    import requests
except ImportError:
    print("Erreur: 'requests' n'est pas installe.")
    print("  pip install requests")
    sys.exit(1)

try:
    from dotenv import load_dotenv
except ImportError:
    load_dotenv = None

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

BACKUP_DIR = Path(__file__).parent / ".password_backups"
BACKUP_DIR.mkdir(exist_ok=True)

def load_config():
    if load_dotenv:
        env_path = Path(__file__).resolve().parent.parent / "dashboard_web" / ".env.local"
        if env_path.exists():
            load_dotenv(env_path)

    url = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

    if not url or not key:
        print("Erreur: Variables d'environnement manquantes.")
        print("  NEXT_PUBLIC_SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont requises.")
        print(f"  Fichier .env.local cherche dans : {Path(__file__).resolve().parent.parent / 'dashboard_web' / '.env.local'}")
        sys.exit(1)

    return url.rstrip("/"), key


SUPABASE_URL, SERVICE_ROLE_KEY = load_config()

HEADERS_ADMIN = {
    "apikey": SERVICE_ROLE_KEY,
    "Authorization": f"Bearer {SERVICE_ROLE_KEY}",
    "Content-Type": "application/json",
}

HEADERS_RPC = {
    "apikey": SERVICE_ROLE_KEY,
    "Authorization": f"Bearer {SERVICE_ROLE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=representation",
}

# ---------------------------------------------------------------------------
# API helpers
# ---------------------------------------------------------------------------

def api_get(path: str, params: dict | None = None) -> dict | list:
    r = requests.get(f"{SUPABASE_URL}{path}", headers=HEADERS_ADMIN, params=params)
    r.raise_for_status()
    return r.json()


def api_put(path: str, body: dict) -> dict:
    r = requests.put(f"{SUPABASE_URL}{path}", headers=HEADERS_ADMIN, json=body)
    r.raise_for_status()
    return r.json()


def rpc_call(fn_name: str, params: dict):
    r = requests.post(
        f"{SUPABASE_URL}/rest/v1/rpc/{fn_name}",
        headers=HEADERS_RPC,
        json=params,
    )
    if r.status_code >= 400:
        error = r.json() if r.headers.get("content-type", "").startswith("application/json") else r.text
        raise RuntimeError(f"RPC {fn_name} a echoue ({r.status_code}): {error}")
    try:
        return r.json()
    except Exception:
        return None

# ---------------------------------------------------------------------------
# Fonctions principales
# ---------------------------------------------------------------------------

def list_users() -> list[dict]:
    """Liste les utilisateurs depuis la table public.users via REST."""
    r = requests.get(
        f"{SUPABASE_URL}/rest/v1/users",
        headers=HEADERS_RPC,
        params={"select": "id,name,email,role,subscription_plan", "order": "name.asc"},
    )
    r.raise_for_status()
    return r.json()


def find_user_by_email(email: str) -> dict | None:
    r = requests.get(
        f"{SUPABASE_URL}/rest/v1/users",
        headers=HEADERS_RPC,
        params={"select": "id,name,email,role,subscription_plan", "email": f"eq.{email}"},
    )
    r.raise_for_status()
    data = r.json()
    return data[0] if data else None


def get_encrypted_password(user_id: str) -> str:
    return rpc_call("admin_get_encrypted_password", {"target_user_id": user_id})


def set_encrypted_password(user_id: str, encrypted_password: str):
    rpc_call("admin_set_encrypted_password", {
        "target_user_id": user_id,
        "new_encrypted_password": encrypted_password,
    })


def change_password_via_admin(user_id: str, new_password: str):
    return api_put(f"/auth/v1/admin/users/{user_id}", {"password": new_password})


def save_backup(user_id: str, email: str, encrypted_password: str):
    backup_file = BACKUP_DIR / f"{user_id}.json"
    data = {
        "user_id": user_id,
        "email": email,
        "encrypted_password": encrypted_password,
        "saved_at": time.strftime("%Y-%m-%d %H:%M:%S"),
    }
    backup_file.write_text(json.dumps(data, indent=2))
    return backup_file


def load_backup(user_id: str) -> dict | None:
    backup_file = BACKUP_DIR / f"{user_id}.json"
    if not backup_file.exists():
        return None
    return json.loads(backup_file.read_text())


def delete_backup(user_id: str):
    backup_file = BACKUP_DIR / f"{user_id}.json"
    if backup_file.exists():
        backup_file.unlink()


def list_backups() -> list[dict]:
    backups = []
    for f in BACKUP_DIR.glob("*.json"):
        try:
            backups.append(json.loads(f.read_text()))
        except Exception:
            pass
    return backups

# ---------------------------------------------------------------------------
# Interface interactive
# ---------------------------------------------------------------------------

def print_header(title: str):
    width = 60
    print()
    print("=" * width)
    print(f"  {title}")
    print("=" * width)


def print_users(users: list[dict]):
    if not users:
        print("  Aucun utilisateur trouve.")
        return
    print(f"\n  {'#':<4} {'Nom':<25} {'Email':<35} {'Plan':<10}")
    print(f"  {'-'*4} {'-'*25} {'-'*35} {'-'*10}")
    for i, u in enumerate(users, 1):
        name = (u.get("name") or "—")[:24]
        email = (u.get("email") or "—")[:34]
        plan = (u.get("subscription_plan") or "—")[:9]
        print(f"  {i:<4} {name:<25} {email:<35} {plan:<10}")


def select_user() -> dict | None:
    """Permet de chercher un utilisateur par email ou lister tous."""
    print("\n  [1] Chercher par email")
    print("  [2] Lister tous les utilisateurs")
    print("  [0] Retour")

    choice = input("\n  Choix: ").strip()

    if choice == "1":
        email = input("  Email du client: ").strip()
        if not email:
            return None
        user = find_user_by_email(email)
        if not user:
            print(f"\n  Aucun utilisateur trouve avec l'email: {email}")
            return None
        print(f"\n  Trouve: {user['name']} ({user['email']}) - Plan: {user.get('subscription_plan', '?')}")
        return user

    elif choice == "2":
        print("\n  Chargement des utilisateurs...")
        users = list_users()
        print_users(users)
        if not users:
            return None
        try:
            idx = int(input("\n  Numero de l'utilisateur (0 = annuler): ").strip())
            if idx == 0 or idx > len(users):
                return None
            return users[idx - 1]
        except (ValueError, IndexError):
            return None

    return None


def action_save_and_change():
    """Sauvegarde le mdp actuel et le remplace par un temporaire."""
    print_header("SAUVEGARDER & CHANGER LE MOT DE PASSE")

    user = select_user()
    if not user:
        return

    user_id = user["id"]
    email = user["email"]

    existing_backup = load_backup(user_id)
    if existing_backup:
        print(f"\n  ATTENTION: Un backup existe deja pour {email}")
        print(f"  Sauvegarde du: {existing_backup['saved_at']}")
        confirm = input("  Ecraser le backup existant? (o/n): ").strip().lower()
        if confirm != "o":
            print("  Annule.")
            return

    print(f"\n  Sauvegarde du mot de passe actuel de {email}...")
    try:
        encrypted_pwd = get_encrypted_password(user_id)
    except Exception as e:
        print(f"\n  ERREUR lors de la lecture du mot de passe: {e}")
        print("  As-tu bien deploye le fichier manage_client_password.sql dans Supabase?")
        return

    backup_path = save_backup(user_id, email, encrypted_pwd)
    print(f"  Backup sauvegarde: {backup_path}")

    temp_password = input("\n  Mot de passe temporaire a definir (min 6 car.): ").strip()
    if len(temp_password) < 6:
        print("  Le mot de passe doit faire au moins 6 caracteres. Annule.")
        return

    print(f"  Changement du mot de passe de {email}...")
    try:
        change_password_via_admin(user_id, temp_password)
    except Exception as e:
        print(f"\n  ERREUR lors du changement: {e}")
        return

    print(f"\n  Mot de passe change avec succes!")
    print(f"  Tu peux maintenant te connecter avec:")
    print(f"    Email:    {email}")
    print(f"    Mot de passe: {temp_password}")
    print(f"\n  N'oublie pas de restaurer le mot de passe original quand tu as fini!")


def action_restore():
    """Restaure le mot de passe original depuis le backup."""
    print_header("RESTAURER LE MOT DE PASSE ORIGINAL")

    backups = list_backups()
    if not backups:
        print("\n  Aucun backup trouve. Rien a restaurer.")
        return

    print("\n  Backups disponibles:")
    print(f"  {'#':<4} {'Email':<35} {'Sauvegarde le':<25}")
    print(f"  {'-'*4} {'-'*35} {'-'*25}")
    for i, b in enumerate(backups, 1):
        print(f"  {i:<4} {b['email']:<35} {b['saved_at']:<25}")

    try:
        idx = int(input("\n  Numero du backup a restaurer (0 = annuler): ").strip())
        if idx == 0 or idx > len(backups):
            return
        backup = backups[idx - 1]
    except (ValueError, IndexError):
        return

    user_id = backup["user_id"]
    email = backup["email"]

    print(f"\n  Restauration du mot de passe original de {email}...")
    confirm = input(f"  Confirmer la restauration? (o/n): ").strip().lower()
    if confirm != "o":
        print("  Annule.")
        return

    try:
        set_encrypted_password(user_id, backup["encrypted_password"])
    except Exception as e:
        print(f"\n  ERREUR lors de la restauration: {e}")
        return

    delete_backup(user_id)
    print(f"\n  Mot de passe original de {email} restaure avec succes!")
    print(f"  Backup supprime.")


def action_list_backups():
    """Affiche les backups en cours."""
    print_header("BACKUPS EN COURS")

    backups = list_backups()
    if not backups:
        print("\n  Aucun backup en cours. Tous les mots de passe sont originaux.")
        return

    print(f"\n  {'#':<4} {'Email':<35} {'Sauvegarde le':<25} {'User ID'}")
    print(f"  {'-'*4} {'-'*35} {'-'*25} {'-'*36}")
    for i, b in enumerate(backups, 1):
        print(f"  {i:<4} {b['email']:<35} {b['saved_at']:<25} {b['user_id']}")


def main():
    print_header("GO-DATA - GESTION DES MOTS DE PASSE CLIENTS")
    print(f"  Supabase: {SUPABASE_URL}")

    while True:
        print("\n  ----------------------------------------")
        print("  [1] Sauvegarder & changer un mot de passe")
        print("  [2] Restaurer le mot de passe original")
        print("  [3] Voir les backups en cours")
        print("  [0] Quitter")

        choice = input("\n  Choix: ").strip()

        if choice == "1":
            action_save_and_change()
        elif choice == "2":
            action_restore()
        elif choice == "3":
            action_list_backups()
        elif choice == "0":
            backups = list_backups()
            if backups:
                print(f"\n  ATTENTION: {len(backups)} backup(s) non restaure(s)!")
                for b in backups:
                    print(f"    - {b['email']} (depuis {b['saved_at']})")
                print("  Pense a les restaurer avant de quitter!")
                confirm = input("  Quitter quand meme? (o/n): ").strip().lower()
                if confirm != "o":
                    continue
            print("\n  Au revoir!")
            break
        else:
            print("  Choix invalide.")


if __name__ == "__main__":
    main()
