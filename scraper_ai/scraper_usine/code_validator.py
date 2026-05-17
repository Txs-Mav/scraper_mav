"""Validation 6-etapes d'un code Python avant ecriture sur disque.

Pipeline (Phase 2.4 du plan optim couts) :
  1. ast.parse(new_code)       - syntaxe Python valide
  2. compile(new_code, "exec") - detecte certains cas qu'ast.parse rate
  3. ecriture dans un .py.tmp
  4. importlib.import_module   - detecte erreurs d'import
  5. getattr(class) + issubclass(DedicatedScraper)
  6. methodes obligatoires (discover_product_urls, extract_from_detail_page)
     + attributs SITE_NAME, SITE_SLUG, SITE_URL, SITE_DOMAIN

Si TOUTES les etapes passent : rename atomique .py.tmp -> .py
Si une etape echoue : .tmp supprime, retour structure d'erreur detaillee.

Cout : ~50 ms par appel. Bloque tout patch mort-ne avant qu'il atteigne
le run reel.
"""
from __future__ import annotations

import ast
import importlib
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import List, Optional


# Methodes que toute classe heritant de DedicatedScraper DOIT avoir
REQUIRED_METHODS = ("discover_product_urls", "extract_from_detail_page")

# Attributs SITE_* obligatoires sur la classe
REQUIRED_CLASS_ATTRS = ("SITE_NAME", "SITE_SLUG", "SITE_URL", "SITE_DOMAIN")


@dataclass
class ValidationResult:
    """Resultat du pipeline de validation 6-etapes."""
    ok: bool
    failed_at: Optional[str] = None  # ex: "step3_import_module"
    error: Optional[str] = None
    final_path: Optional[Path] = None
    steps_passed: List[str] = field(default_factory=list)


def validate_and_write_atomic(
    new_code: str,
    target_path: Path,
    *,
    class_name: str,
    module_dotted_path: str,
) -> ValidationResult:
    """Pipeline complet de validation + ecriture atomique.

    Args:
        new_code: code Python a valider et ecrire.
        target_path: chemin final ``.py`` (sera renomme depuis .tmp).
        class_name: nom de la classe attendue (ex: ``"SportplusmotoScraper"``).
        module_dotted_path: chemin module style import (ex:
            ``"scraper_ai.dedicated_scrapers.sportplusmoto"``).

    Returns:
        ``ValidationResult`` avec ``ok=True`` et ``final_path`` si tout passe,
        sinon ``ok=False`` avec ``failed_at`` et ``error``.
    """
    result = ValidationResult(ok=False)
    tmp_path = target_path.with_suffix(target_path.suffix + ".tmp")

    # Etape 1 : ast.parse
    try:
        ast.parse(new_code)
        result.steps_passed.append("step1_ast_parse")
    except SyntaxError as e:
        result.failed_at = "step1_ast_parse"
        result.error = f"SyntaxError: {e}"
        return result

    # Etape 2 : compile
    try:
        compile(new_code, str(target_path), "exec")
        result.steps_passed.append("step2_compile")
    except (SyntaxError, ValueError) as e:
        result.failed_at = "step2_compile"
        result.error = f"compile error: {type(e).__name__}: {e}"
        return result

    # Etape 3 : ecriture .tmp
    try:
        target_path.parent.mkdir(parents=True, exist_ok=True)
        tmp_path.write_text(new_code, encoding="utf-8")
        result.steps_passed.append("step3_write_tmp")
    except OSError as e:
        result.failed_at = "step3_write_tmp"
        result.error = f"write tmp error: {e}"
        return result

    # Pour les etapes 4-6, on doit importer le module .tmp. Comme Python
    # ne sait pas importer directement un .tmp, on importe en remplacant
    # temporairement le .py final par le .tmp. C'est sequentiel donc safe.
    target_existed = target_path.exists()
    backup_content: Optional[bytes] = None
    if target_existed:
        try:
            backup_content = target_path.read_bytes()
        except OSError:
            pass

    try:
        # Place le .tmp comme .py temporairement pour pouvoir l'importer
        target_path.write_bytes(tmp_path.read_bytes())

        # Etape 4 : importlib
        try:
            importlib.invalidate_caches()
            if module_dotted_path in sys.modules:
                del sys.modules[module_dotted_path]
            module = importlib.import_module(module_dotted_path)
            result.steps_passed.append("step4_import_module")
        except Exception as e:
            result.failed_at = "step4_import_module"
            result.error = f"import error: {type(e).__name__}: {e}"
            return result

        # Etape 5 : getattr classe + issubclass DedicatedScraper
        try:
            klass = getattr(module, class_name, None)
            if klass is None:
                result.failed_at = "step5_getattr_class"
                result.error = (
                    f"classe {class_name!r} introuvable dans {module_dotted_path}"
                )
                return result

            try:
                from scraper_ai.dedicated_scrapers.base import DedicatedScraper
            except ImportError as e:
                result.failed_at = "step5_import_base"
                result.error = f"import DedicatedScraper KO: {e}"
                return result

            if not (isinstance(klass, type) and issubclass(klass, DedicatedScraper)):
                result.failed_at = "step5_issubclass"
                result.error = (
                    f"{class_name} n'herite pas de DedicatedScraper"
                )
                return result
            result.steps_passed.append("step5_class_inheritance")
        except Exception as e:
            result.failed_at = "step5_class_inheritance"
            result.error = f"{type(e).__name__}: {e}"
            return result

        # Etape 6 : methodes + attributs obligatoires
        missing_methods = [
            m for m in REQUIRED_METHODS if not callable(getattr(klass, m, None))
        ]
        missing_attrs = [
            a for a in REQUIRED_CLASS_ATTRS if not getattr(klass, a, None)
        ]
        if missing_methods or missing_attrs:
            result.failed_at = "step6_methods_attrs"
            parts = []
            if missing_methods:
                parts.append(f"methodes manquantes: {missing_methods}")
            if missing_attrs:
                parts.append(f"attrs SITE_* manquants/vides: {missing_attrs}")
            result.error = " | ".join(parts)
            return result
        result.steps_passed.append("step6_methods_attrs")

    finally:
        # Si on a foire APRES avoir ecrit dans target_path, on restaure
        # l'ancien contenu (rollback). Si on a reussi, on garde target_path
        # qui contient deja le nouveau code (et on supprime le .tmp).
        if not result.ok and result.failed_at and result.failed_at.startswith("step"):
            step_num = int(result.failed_at[4]) if result.failed_at[4].isdigit() else 0
            if step_num >= 4 and target_existed and backup_content is not None:
                try:
                    target_path.write_bytes(backup_content)
                except OSError:
                    pass
            elif step_num >= 4 and not target_existed:
                # On avait cree target_path pour pouvoir importer, on l'enleve
                try:
                    target_path.unlink()
                except OSError:
                    pass

        # Toujours nettoyer le .tmp
        try:
            if tmp_path.exists():
                tmp_path.unlink()
        except OSError:
            pass

    # Tout est passe ; target_path contient deja le nouveau code (place a
    # l'etape 4 pour permettre l'import). On finalise.
    result.ok = True
    result.final_path = target_path
    return result


# ---------------------------------------------------------------------------
# Format patches Sonnet : application + validation
# ---------------------------------------------------------------------------

@dataclass
class PatchApplyResult:
    """Resultat d'application d'une liste de patches."""
    new_code: str
    applied_count: int
    failed_count: int
    overlap_detected: bool = False
    errors: List[str] = field(default_factory=list)


def apply_patches(
    base_code: str,
    patches: List[dict],
    *,
    max_patches: int = 5,
) -> PatchApplyResult:
    """Applique une liste de patches ``[{find, replace}]`` au code.

    Strategie :
      - Chaque patch fait un str.replace() unique (1 seule occurrence du find).
      - Si find apparait 0 fois : echec de ce patch, on continue.
      - Si find apparait > 1 fois : ambigue, on echoue ce patch et on log.
      - Si > max_patches au total : refus global (fallback full_rewrite recommande).

    Args:
        base_code: contenu du fichier .py actuel.
        patches: liste de dicts ``{"find": str, "replace": str}``.
        max_patches: au-dela on bascule en mode full_rewrite (ce helper n'applique
            pas, le caller doit alors demander un fichier complet a Sonnet).

    Returns:
        ``PatchApplyResult`` avec le code modifie et les compteurs.
    """
    if len(patches) > max_patches:
        return PatchApplyResult(
            new_code=base_code,
            applied_count=0,
            failed_count=len(patches),
            overlap_detected=False,
            errors=[f"trop de patches ({len(patches)} > {max_patches})"],
        )

    out = base_code
    applied = 0
    failed = 0
    errors: List[str] = []
    seen_finds: List[str] = []

    for i, p in enumerate(patches):
        if not isinstance(p, dict):
            failed += 1
            errors.append(f"patch #{i}: pas un dict")
            continue
        find = p.get("find")
        replace = p.get("replace")
        if not isinstance(find, str) or not isinstance(replace, str):
            failed += 1
            errors.append(f"patch #{i}: find/replace invalides")
            continue
        if not find:
            failed += 1
            errors.append(f"patch #{i}: find vide")
            continue

        count = out.count(find)
        if count == 0:
            failed += 1
            errors.append(f"patch #{i}: find absent du code")
            continue
        if count > 1:
            failed += 1
            errors.append(f"patch #{i}: find ambigu ({count} occurrences)")
            continue

        # Detection d'overlap : si un find precedent contient le find actuel
        # ou vice-versa, on a un risque de patch qui mange un autre.
        for prev in seen_finds:
            if find in prev or prev in find:
                return PatchApplyResult(
                    new_code=base_code,
                    applied_count=0,
                    failed_count=len(patches),
                    overlap_detected=True,
                    errors=[
                        f"overlap detecte entre patch #{i} et un precedent"
                    ],
                )
        seen_finds.append(find)

        out = out.replace(find, replace, 1)
        applied += 1

    return PatchApplyResult(
        new_code=out,
        applied_count=applied,
        failed_count=failed,
        overlap_detected=False,
        errors=errors,
    )


__all__ = [
    "ValidationResult",
    "validate_and_write_atomic",
    "PatchApplyResult",
    "apply_patches",
    "REQUIRED_METHODS",
    "REQUIRED_CLASS_ATTRS",
]
