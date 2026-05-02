"""Génération automatique d'un workflow GitHub Action dédié pour un scraper.

Quand ``scraper_usine`` valide un nouveau scraper, on crée en plus du code Python
un workflow ``.github/workflows/scraper-<slug>.yml`` qui scrape le site
toutes les heures et upserte les résultats dans Supabase.

Le workflow utilise ``scripts/scrape_single_site.py --slug <slug>`` qui :
  - skip automatiquement si le cache est <55 min,
  - sauvegarde dans ``scraped_site_data`` (succès ou erreur),
  - tourne en mode ``--force`` si déclenché manuellement.

Pourquoi un workflow par scraper plutôt qu'un workflow global ?
  - Indépendance : un site qui plante ne bloque pas les autres.
  - Lisibilité : chaque site a son propre run history GitHub.
  - Décalage anti-collision : minute aléatoire dérivée du slug pour
    éviter que tous les workflows tapent Supabase en même temps.

Configuration des secrets GitHub (à définir une seule fois sur le repo) :
  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
"""
from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Optional


# Répertoire des workflows GitHub Action (relatif au repo root).
WORKFLOWS_DIR = ".github/workflows"

# Délai max d'exécution d'un workflow (minutes). Suffisant pour les plus gros
# sites du parc (motosillimitees.com ~ 16 min) avec marge de sécurité.
WORKFLOW_TIMEOUT_MINUTES = 30


@dataclass
class WorkflowGenerationResult:
    """Résultat de la génération du workflow."""
    file_path: Path
    relative_path: str
    written: bool          # True = fichier écrit/réécrit ; False = identique
    cron_schedule: str     # ex: "17 * * * *"
    skipped_reason: Optional[str] = None

    def to_dict(self) -> dict:
        return {
            "file_path": str(self.file_path),
            "relative_path": self.relative_path,
            "written": self.written,
            "cron_schedule": self.cron_schedule,
            "skipped_reason": self.skipped_reason,
        }


def generate_workflow_yaml(
    *,
    site_slug: str,
    site_name: str,
    cron_schedule: Optional[str] = None,
) -> str:
    """Retourne le contenu YAML du workflow pour un scraper donné.

    Args:
        site_slug: identifiant unique (ex: "morin-sports").
        site_name: nom lisible (ex: "Morin Sports & Marine"), utilisé dans
            le ``name:`` du workflow.
        cron_schedule: expression cron à 5 champs (ex: "30 * * * *"). Si
            None, on dérive une minute déterministe du slug pour étaler
            les exécutions sur l'heure (anti-collision Supabase).
    """
    if not cron_schedule:
        cron_schedule = derive_cron_schedule(site_slug)

    # Échappement du nom : on retire les retours ligne et on encadre de
    # guillemets simples uniquement si nécessaire (présence de : ou #).
    safe_name = site_name.replace("\n", " ").strip()
    needs_quote = any(c in safe_name for c in ":#&*!|>'\"%@`")
    if needs_quote:
        # YAML : on échappe les ' en '' à l'intérieur de quotes simples.
        escaped = safe_name.replace("'", "''")
        name_field = f"'Scraping {escaped} (horaire)'"
    else:
        name_field = f"Scraping {safe_name} (horaire)"

    # On évite les f-strings imbriquées avec ${{ }} en les construisant
    # à part — sinon Python interprète les accolades.
    secret_url = "${{ secrets.SUPABASE_URL }}"
    secret_key = "${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}"
    force_expr = "${{ inputs.force && '--force' || '' }}"

    yaml = f"""name: {name_field}

# Cron horaire DÉDIÉ à {safe_name}.
#
# Auto-généré par scraper_usine.workflow_generator. Ne pas éditer à la main :
# régénérer via `python -m scraper_ai.scraper_usine.main <url>` ou via
# l'API d'approbation `/api/admin/scrapers/{site_slug}/approve` du dashboard.
#
# Le script `scrape_single_site.py` skip automatiquement si le cache Supabase
# est < 55 min — donc aucun risque de doublon avec le cron orchestrateur
# global qui tourne à HH:00.

on:
  schedule:
    - cron: '{cron_schedule}'
  workflow_dispatch:
    inputs:
      force:
        description: "Ignorer le cache de fraîcheur (--force)"
        type: boolean
        default: false

concurrency:
  group: scraper-{site_slug}
  cancel-in-progress: false

jobs:
  scrape:
    runs-on: ubuntu-latest
    timeout-minutes: {WORKFLOW_TIMEOUT_MINUTES}

    steps:
      - name: Checkout du repo
        uses: actions/checkout@v5

      - name: Setup Python
        uses: actions/setup-python@v6
        with:
          python-version: '3.11'
          cache: 'pip'
          cache-dependency-path: scraper_ai/requirements.txt

      - name: Installer les dépendances Python
        run: |
          pip install -r scraper_ai/requirements.txt
          pip install requests supabase

      - name: Scraping {safe_name}
        env:
          SUPABASE_URL: {secret_url}
          SUPABASE_SERVICE_ROLE_KEY: {secret_key}
          NEXT_PUBLIC_SUPABASE_URL: {secret_url}
        run: |
          python scripts/scrape_single_site.py \\
            --slug {site_slug} \\
            {force_expr}
"""
    return yaml


def derive_cron_schedule(site_slug: str) -> str:
    """Retourne une expression cron horaire avec une minute déterministe
    dérivée du slug.

    Objectif : étaler les workflows sur l'heure pour éviter que tous les
    sites tapent Supabase en même temps (et créent une queue de runs).
    On évite les minutes 0 et 30 qui sont déjà utilisées par le cron
    Vercel principal et le workflow Morin Sports historique.
    """
    h = hashlib.sha1(site_slug.encode("utf-8")).hexdigest()
    minute = int(h[:8], 16) % 60
    if minute in (0, 30):
        minute = (minute + 13) % 60
    return f"{minute} * * * *"


def workflow_path_for_slug(repo_root: Path, site_slug: str) -> Path:
    """Retourne le chemin absolu du fichier workflow pour un slug."""
    safe_slug = re.sub(r"[^a-z0-9-]", "-", site_slug.lower()).strip("-")
    return repo_root / WORKFLOWS_DIR / f"scraper-{safe_slug}.yml"


def write_workflow_for_scraper(
    *,
    repo_root: Path,
    site_slug: str,
    site_name: str,
    cron_schedule: Optional[str] = None,
    overwrite: bool = True,
    verbose: bool = True,
) -> WorkflowGenerationResult:
    """Génère et écrit le fichier workflow pour un scraper.

    Args:
        repo_root: racine du repo (où vit ``.github/workflows``).
        site_slug: slug unique du scraper.
        site_name: nom lisible du site.
        cron_schedule: expression cron à 5 champs (None = dérivé du slug).
        overwrite: si False et le fichier existe déjà, on n'écrit pas.
        verbose: log les actions.

    Returns:
        WorkflowGenerationResult décrivant l'opération.
    """
    if cron_schedule is None:
        cron_schedule = derive_cron_schedule(site_slug)

    target = workflow_path_for_slug(repo_root, site_slug)
    target.parent.mkdir(parents=True, exist_ok=True)

    rel_path = str(target.relative_to(repo_root))

    new_content = generate_workflow_yaml(
        site_slug=site_slug,
        site_name=site_name,
        cron_schedule=cron_schedule,
    )

    if target.exists():
        existing = target.read_text(encoding="utf-8")
        if existing == new_content:
            if verbose:
                print(f"  [workflow_generator] {rel_path} déjà à jour — skip")
            return WorkflowGenerationResult(
                file_path=target,
                relative_path=rel_path,
                written=False,
                cron_schedule=cron_schedule,
                skipped_reason="identical",
            )
        if not overwrite:
            if verbose:
                print(f"  [workflow_generator] {rel_path} existe déjà (overwrite=False) — skip")
            return WorkflowGenerationResult(
                file_path=target,
                relative_path=rel_path,
                written=False,
                cron_schedule=cron_schedule,
                skipped_reason="exists_no_overwrite",
            )

    target.write_text(new_content, encoding="utf-8")
    if verbose:
        print(f"  [workflow_generator] ✅ Workflow écrit: {rel_path} (cron='{cron_schedule}')")

    return WorkflowGenerationResult(
        file_path=target,
        relative_path=rel_path,
        written=True,
        cron_schedule=cron_schedule,
    )


__all__ = [
    "WorkflowGenerationResult",
    "WORKFLOWS_DIR",
    "WORKFLOW_TIMEOUT_MINUTES",
    "generate_workflow_yaml",
    "derive_cron_schedule",
    "workflow_path_for_slug",
    "write_workflow_for_scraper",
]
