"""Auto-push d'un scraper généré vers le repo Git (déploiement Railway).

Quand scraper_usine est lancé via le backend Railway (/admin/usine), le fichier
Python généré atterrit sur le **disque éphémère** de l'instance Railway. Au
prochain redéploiement (push, recyclage, etc.), le fichier disparaît, et le
cron horaire échoue avec ImportError.

Ce module commite + pousse automatiquement les fichiers sur la branche `main`
(ou autre branche configurée) pour que :
  1. Le code Python survive aux redéploiements Railway
  2. Railway redéploie automatiquement (CI/CD existant) → le scraper est actif
  3. Tu gardes l'historique Git (review possible, revert possible)

Configuration via variables d'environnement :
    GITHUB_PAT       — Personal Access Token avec scope `contents:write`
    GITHUB_REPO      — `owner/repo` (ex: "mavmenard/scraper-mav")
    GITHUB_BRANCH    — branche cible (défaut: 'main')
    GIT_AUTHOR_NAME  — nom de l'auteur des commits (défaut: 'scraper_usine')
    GIT_AUTHOR_EMAIL — email de l'auteur (défaut: 'scraper-usine@go-data.ca')

Si l'une des 2 premières variables n'est pas définie, la fonction retourne
None sans erreur (utile en dev local où l'auteur commite manuellement).
"""
from __future__ import annotations

import os
import shlex
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional

from .models import GeneratedScraper
from .workflow_generator import workflow_path_for_slug

DEFAULT_BRANCH = "main"
DEFAULT_AUTHOR_NAME = "scraper_usine"
DEFAULT_AUTHOR_EMAIL = "scraper-usine@go-data.ca"

# Fichiers tracés à inclure dans chaque commit auto.
def _files_to_stage(generated: GeneratedScraper) -> List[Path]:
    """Liste des fichiers à committer pour un scraper généré."""
    project_root = Path(generated.file_path).resolve().parent.parent.parent
    slug = generated.slug
    module = generated.module_name

    return [
        # Fichier Python généré
        Path(generated.file_path).resolve(),
        # Registry mis à jour
        project_root / "scraper_ai" / "dedicated_scrapers" / "_generated_registry.py",
        # Stratégie persistée (pour le validator)
        project_root / "scraper_cache" / "strategies" / f"{slug}_strategy.json",
        # Workflow GitHub Action dédié (auto-généré par workflow_generator)
        workflow_path_for_slug(project_root, slug),
    ]


@dataclass
class GitPushResult:
    """Résultat du push Git."""
    pushed: bool
    commit_sha: Optional[str] = None
    branch: Optional[str] = None
    repo: Optional[str] = None
    files_committed: List[str] = None  # type: ignore[assignment]
    skipped_reason: Optional[str] = None
    error: Optional[str] = None

    def to_dict(self) -> dict:
        return {
            "pushed": self.pushed,
            "commit_sha": self.commit_sha,
            "branch": self.branch,
            "repo": self.repo,
            "files_committed": self.files_committed or [],
            "skipped_reason": self.skipped_reason,
            "error": self.error,
        }


def commit_and_push_scraper(
    generated: GeneratedScraper,
    *,
    score: int = 0,
    message_extra: str = "",
    verbose: bool = True,
) -> GitPushResult:
    """Commit + push les fichiers d'un scraper généré.

    Si GITHUB_PAT/GITHUB_REPO ne sont pas configurés (dev local), la fonction
    retourne `pushed=False, skipped_reason='env_missing'` sans erreur — l'auteur
    commitera lui-même.
    """
    pat = os.environ.get("GITHUB_PAT", "").strip()
    repo = os.environ.get("GITHUB_REPO", "").strip()
    branch = os.environ.get("GITHUB_BRANCH", DEFAULT_BRANCH).strip() or DEFAULT_BRANCH

    if not pat or not repo:
        if verbose:
            print(
                "  [git_push] GITHUB_PAT / GITHUB_REPO non configurés — "
                "push automatique ignoré. Commite + push manuellement les "
                "fichiers générés."
            )
        return GitPushResult(
            pushed=False,
            skipped_reason="env_missing",
            files_committed=[],
        )

    project_root = Path(generated.file_path).resolve().parent.parent.parent

    # 1) Vérifier qu'on est dans un repo git
    if not (project_root / ".git").exists():
        return GitPushResult(
            pushed=False,
            skipped_reason="not_a_git_repo",
            error=f"{project_root} n'est pas un repo git (.git absent)",
        )

    # 2) Stage les fichiers existants
    files = [f for f in _files_to_stage(generated) if f.exists()]
    if not files:
        return GitPushResult(
            pushed=False,
            skipped_reason="no_files",
            error="Aucun fichier à committer (générateur a-t-il bien tourné ?)",
        )

    relative_files = [str(f.relative_to(project_root)) for f in files]

    try:
        # 3) Configure auteur (idempotent, ne touche pas la config globale)
        author_name = os.environ.get("GIT_AUTHOR_NAME", DEFAULT_AUTHOR_NAME)
        author_email = os.environ.get("GIT_AUTHOR_EMAIL", DEFAULT_AUTHOR_EMAIL)
        env = {
            **os.environ,
            "GIT_AUTHOR_NAME": author_name,
            "GIT_AUTHOR_EMAIL": author_email,
            "GIT_COMMITTER_NAME": author_name,
            "GIT_COMMITTER_EMAIL": author_email,
        }

        # 4) Pull rebase pour réduire les conflits si plusieurs runs
        _run(["git", "fetch", "origin", branch], cwd=project_root, env=env, verbose=verbose)
        _run(["git", "checkout", branch], cwd=project_root, env=env, verbose=verbose,
             allow_failure=True)
        _run(["git", "pull", "--rebase", "origin", branch], cwd=project_root,
             env=env, verbose=verbose, allow_failure=True)

        # 5) Stage
        _run(["git", "add"] + relative_files, cwd=project_root, env=env, verbose=verbose)

        # 6) Vérifie qu'il y a vraiment quelque chose à committer (sinon
        # `git commit` retourne 1 et on aurait un faux échec).
        diff_proc = subprocess.run(
            ["git", "diff", "--cached", "--quiet"],
            cwd=str(project_root), env=env,
        )
        if diff_proc.returncode == 0:
            return GitPushResult(
                pushed=False,
                skipped_reason="no_changes_to_commit",
                branch=branch,
                repo=repo,
                files_committed=relative_files,
            )

        # 7) Commit
        msg = f"feat(scraper): auto-add {generated.slug} (score {score}/100)"
        if message_extra:
            msg += f"\n\n{message_extra}"
        msg += "\n\nAuto-généré par scraper_usine."
        _run(["git", "commit", "-m", msg], cwd=project_root, env=env, verbose=verbose)

        # 8) SHA du commit qu'on vient de créer
        sha_proc = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=str(project_root), env=env,
            capture_output=True, text=True,
        )
        commit_sha = (sha_proc.stdout or "").strip() or None

        # 9) Push avec PAT (URL temporaire pour ne pas écrire le PAT dans
        # la config persistée)
        push_url = f"https://x-access-token:{pat}@github.com/{repo}.git"
        _run(["git", "push", push_url, f"HEAD:{branch}"],
             cwd=project_root, env=env, verbose=verbose, mask=pat)

        if verbose:
            short_sha = (commit_sha or "")[:8]
            print(f"  [git_push] ✅ {generated.slug} pushé sur {repo}@{branch} "
                  f"(commit {short_sha})")

        return GitPushResult(
            pushed=True,
            commit_sha=commit_sha,
            branch=branch,
            repo=repo,
            files_committed=relative_files,
        )

    except subprocess.CalledProcessError as e:
        err = (e.stderr or e.stdout or str(e)).strip()
        # Masque le PAT si jamais il est dans le message d'erreur
        if pat:
            err = err.replace(pat, "***")
        if verbose:
            print(f"  [git_push] ❌ Échec : {err[:300]}")
        return GitPushResult(
            pushed=False,
            skipped_reason="git_command_failed",
            error=err[:500],
            branch=branch,
            repo=repo,
            files_committed=relative_files,
        )

    except Exception as e:
        if verbose:
            print(f"  [git_push] ❌ Erreur inattendue : {type(e).__name__}: {e}")
        return GitPushResult(
            pushed=False,
            skipped_reason="exception",
            error=f"{type(e).__name__}: {str(e)[:300]}",
            branch=branch,
            repo=repo,
        )


def _run(
    cmd: List[str],
    *,
    cwd: Path,
    env: dict,
    verbose: bool = False,
    allow_failure: bool = False,
    mask: Optional[str] = None,
) -> subprocess.CompletedProcess:
    """Lance une commande shell. Capture stdout+stderr. Lève CalledProcessError
    si return code != 0 (sauf allow_failure)."""
    if verbose:
        # Affiche la commande sans le PAT
        display = " ".join(shlex.quote(c) for c in cmd)
        if mask:
            display = display.replace(mask, "***")
        print(f"  [git_push] $ {display}")

    proc = subprocess.run(
        cmd,
        cwd=str(cwd),
        env=env,
        capture_output=True,
        text=True,
        timeout=60,
    )

    if proc.returncode != 0 and not allow_failure:
        raise subprocess.CalledProcessError(
            proc.returncode, cmd,
            output=proc.stdout, stderr=proc.stderr,
        )

    return proc


__all__ = ["GitPushResult", "commit_and_push_scraper"]
