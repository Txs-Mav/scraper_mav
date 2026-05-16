"use client"

import { useEffect, useMemo, useState } from "react"
import { ChevronRight, Check, Loader2, FolderTree } from "lucide-react"
import { cn } from "@/lib/utils"
import type { CategoryNode } from "./types"

interface CategoryPickerProps {
  value: string | null              // path actuellement sélectionné, ex: "vehicule.moto"
  onChange: (path: string | null) => void
  /**
   * Liste blanche de chemins de catégories visibles (`null` = pas de filtre).
   * Un chemin "vehicule.moto" autorise la sous-arbre ; on garde aussi les
   * ancêtres ("vehicule") pour permettre la navigation jusqu'aux feuilles.
   */
  allowedPaths?: string[] | null
  /**
   * Classes additionnelles ou remplaçantes pour le trigger.
   * Le parent peut ainsi adapter le picker à différents contextes
   * (barre de recherche pleine largeur vs segmented control compact
   * dans le header).
   */
  triggerClassName?: string
  /** Largeur max du label tronqué (Tailwind class). */
  labelMaxWidthClassName?: string
}

/**
 * Filtre récursivement l'arbre en ne gardant que les noeuds qui :
 *   - matchent exactement un chemin autorisé,
 *   - ou descendent d'un chemin autorisé (sous-arbre complet),
 *   - ou en sont l'ancêtre (chemin de navigation jusqu'à la feuille autorisée).
 */
function filterTree(
  nodes: CategoryNode[],
  allowedPaths: string[] | null,
): CategoryNode[] {
  if (!allowedPaths) return nodes
  if (allowedPaths.length === 0) return []

  const matches = (path: string): "exact" | "ancestor" | "descendant" | null => {
    for (const allowed of allowedPaths) {
      if (path === allowed) return "exact"
      if (path.startsWith(allowed + ".")) return "descendant"
      if (allowed.startsWith(path + ".")) return "ancestor"
    }
    return null
  }

  const walk = (list: CategoryNode[]): CategoryNode[] => {
    const out: CategoryNode[] = []
    for (const n of list) {
      const kind = matches(n.path)
      if (kind === "exact" || kind === "descendant") {
        // Sous-arbre complet : on garde tel quel (pas de filtre récursif inutile)
        out.push(n)
      } else if (kind === "ancestor") {
        // Ancêtre : on garde mais on filtre récursivement les enfants pour
        // ne montrer que la branche menant aux chemins autorisés.
        const filteredChildren = walk(n.children)
        if (filteredChildren.length > 0 || allowedPaths.includes(n.path)) {
          out.push({ ...n, children: filteredChildren })
        }
      }
      // Pas de match → skip
    }
    return out
  }

  return walk(nodes)
}

/**
 * Sélecteur hiérarchique de catégories.
 *
 * UX :
 *   - Bouton/breadcrumb qui ouvre une popover.
 *   - Popover : 3 colonnes (racine → enfant → petit-enfant) façon "miller columns".
 *   - On peut s'arrêter à n'importe quel niveau (sélection partielle).
 *   - Bouton "Toutes les catégories" pour reset.
 *   - Si `allowedPaths` est fourni, on filtre l'arbre + un toggle "Tout voir"
 *     permet d'outrepasser le filtre au cas par cas.
 */
export default function CategoryPicker({
  value,
  onChange,
  allowedPaths,
  triggerClassName,
  labelMaxWidthClassName,
}: CategoryPickerProps) {
  const [tree, setTree] = useState<CategoryNode[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  /** Toggle "Voir tout" qui désactive le filtre pour le picker uniquement. */
  const [showAll, setShowAll] = useState(false)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const res = await fetch("/api/product-search/categories", { cache: "no-store" })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        if (!cancelled) {
          setTree(Array.isArray(data?.tree) ? data.tree : [])
          setLoading(false)
        }
      } catch (e: unknown) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e))
          setLoading(false)
        }
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])

  // Arbre filtré selon allowedPaths (ou complet si showAll/pas de filtre).
  const displayedTree = useMemo(() => {
    if (showAll) return tree
    return filterTree(tree, allowedPaths ?? null)
  }, [tree, allowedPaths, showAll])

  const isFiltered = !showAll && allowedPaths !== null && allowedPaths !== undefined && allowedPaths.length > 0

  // Trouve le node correspondant à un path donné (toujours dans l'arbre complet
  // — sinon le breadcrumb ne fonctionne pas quand la cat. sélectionnée est
  // dans la zone filtrée).
  const findNode = useMemo(() => {
    return (path: string): CategoryNode | null => {
      const walk = (nodes: CategoryNode[]): CategoryNode | null => {
        for (const n of nodes) {
          if (n.path === path) return n
          const child = walk(n.children)
          if (child) return child
        }
        return null
      }
      return walk(tree)
    }
  }, [tree])

  const breadcrumb = useMemo(() => {
    if (!value) return []
    const parts: CategoryNode[] = []
    const segments = value.split(".")
    for (let i = 0; i < segments.length; i++) {
      const partial = segments.slice(0, i + 1).join(".")
      const node = findNode(partial)
      if (node) parts.push(node)
    }
    return parts
  }, [value, findNode])

  const labelText = breadcrumb.length === 0
    ? "Toutes les catégories"
    : breadcrumb.map(b => b.name).join(" › ")

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={cn(
          triggerClassName
            ? triggerClassName
            : cn(
                "inline-flex items-center gap-2 px-3 py-2.5 rounded-xl border transition-colors w-full md:w-auto",
                "border-[var(--color-border-secondary)] bg-[var(--color-background-primary)]",
                "hover:bg-[var(--color-background-hover)] text-sm font-medium",
                "text-[var(--color-text-primary)]",
              ),
        )}
      >
        <FolderTree className="h-4 w-4 text-[var(--color-text-secondary)] shrink-0" />
        <span
          className={cn(
            "truncate",
            labelMaxWidthClassName ?? "max-w-[200px] lg:max-w-[300px]",
          )}
        >
          {labelText}
        </span>
        <ChevronRight
          className={cn(
            "h-3.5 w-3.5 text-[var(--color-text-secondary)] transition-transform shrink-0 ml-auto",
            open ? "rotate-90" : ""
          )}
        />
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
          />
          <div
            className={cn(
              "absolute left-0 top-full mt-2 z-50",
              "w-[680px] max-w-[92vw] max-h-[480px]",
              "bg-[var(--color-background-primary)] border border-[var(--color-border-secondary)]",
              "rounded-xl shadow-2xl overflow-hidden flex flex-col"
            )}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] gap-3">
              <span className="text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wide">
                Choisir une catégorie
              </span>
              <div className="flex items-center gap-2">
                {(allowedPaths && allowedPaths.length > 0) && (
                  <button
                    type="button"
                    onClick={() => setShowAll((v) => !v)}
                    className={cn(
                      "text-xs font-medium px-2 py-0.5 rounded-md transition-colors",
                      showAll
                        ? "bg-amber-100 dark:bg-amber-500/15 text-amber-800 dark:text-amber-300"
                        : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-background-hover)]",
                    )}
                    title="Affiche aussi les catégories hors de ton domaine d'activité"
                  >
                    {showAll ? "Vue : tout" : "Voir tout"}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    onChange(null)
                    setOpen(false)
                  }}
                  className="text-xs text-emerald-600 hover:text-emerald-700 font-medium"
                >
                  Toutes les catégories
                </button>
              </div>
            </div>

            {loading && (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-5 w-5 animate-spin text-[var(--color-text-secondary)]" />
              </div>
            )}

            {error && (
              <div className="px-4 py-3 text-sm text-red-600">
                Erreur : {error}
              </div>
            )}

            {!loading && !error && displayedTree.length === 0 && (
              <div className="px-4 py-8 text-center">
                <p className="text-sm text-[var(--color-text-secondary)]">
                  Aucune catégorie ne correspond à ton domaine d&apos;activité.
                </p>
                {isFiltered && (
                  <button
                    type="button"
                    onClick={() => setShowAll(true)}
                    className="mt-2 text-xs font-medium text-emerald-600 hover:text-emerald-700"
                  >
                    Voir tout l&apos;arbre
                  </button>
                )}
              </div>
            )}

            {!loading && !error && displayedTree.length > 0 && (
              <MillerColumns
                tree={displayedTree}
                value={value}
                onSelect={(path) => {
                  onChange(path)
                  setOpen(false)
                }}
              />
            )}
          </div>
        </>
      )}
    </div>
  )
}

/**
 * Sélecteur en colonnes (style Mac Finder / Miller columns).
 * On affiche jusqu'à 3 colonnes en parallèle pour naviguer dans l'arbre.
 */
function MillerColumns({
  tree,
  value,
  onSelect,
}: {
  tree: CategoryNode[]
  value: string | null
  onSelect: (path: string) => void
}) {
  // État local : chemin "en survol" pendant la navigation (différent de `value` qui est le sélectionné)
  const [hoverPath, setHoverPath] = useState<string | null>(value)

  useEffect(() => {
    setHoverPath(value)
  }, [value])

  // Calcule les 3 niveaux à afficher
  const columns = useMemo(() => {
    const cols: CategoryNode[][] = [tree]
    if (!hoverPath) return cols

    const segments = hoverPath.split(".")
    for (let i = 0; i < segments.length; i++) {
      const partial = segments.slice(0, i + 1).join(".")
      const node = findInTree(tree, partial)
      if (node && node.children.length > 0) {
        cols.push(node.children)
      }
    }
    return cols.slice(-3)
  }, [tree, hoverPath])

  const isOnPath = (path: string): boolean => {
    if (!hoverPath) return false
    return hoverPath === path || hoverPath.startsWith(path + ".")
  }

  return (
    <div className="flex-1 grid grid-cols-3 divide-x divide-[var(--color-border-secondary)] overflow-hidden">
      {columns.map((nodes, colIdx) => (
        <div key={colIdx} className="overflow-y-auto py-1.5">
          {nodes.map((node) => {
            const isHovered = hoverPath === node.path
            const onPath = isOnPath(node.path)
            const isSelected = value === node.path
            return (
              <button
                key={node.path}
                type="button"
                onClick={() => {
                  if (node.children.length === 0) {
                    onSelect(node.path)
                  } else {
                    setHoverPath(node.path)
                  }
                }}
                onDoubleClick={() => onSelect(node.path)}
                className={cn(
                  "w-full flex items-center justify-between gap-2 px-3 py-1.5 text-sm text-left transition-colors",
                  isHovered || onPath
                    ? "bg-[var(--color-background-hover)] text-[var(--color-text-primary)]"
                    : "text-[var(--color-text-primary)] hover:bg-[var(--color-background-hover)]"
                )}
              >
                <span className="truncate flex items-center gap-1.5">
                  {isSelected && <Check className="h-3 w-3 text-emerald-600 shrink-0" />}
                  {node.name}
                </span>
                {node.children.length > 0 && (
                  <ChevronRight className="h-3 w-3 text-[var(--color-text-tertiary)] shrink-0" />
                )}
              </button>
            )
          })}
          {/* Footer : bouton "Sélectionner ce niveau" si on n'est pas sur les feuilles */}
          {colIdx === columns.length - 1 && hoverPath && (
            <div className="px-3 py-2 mt-1 border-t border-[var(--color-border-secondary)]">
              <button
                type="button"
                onClick={() => onSelect(hoverPath)}
                className="w-full inline-flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs font-medium rounded-md bg-emerald-600 text-white hover:bg-emerald-700 transition-colors"
              >
                <Check className="h-3 w-3" />
                Choisir cette catégorie
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

function findInTree(tree: CategoryNode[], path: string): CategoryNode | null {
  for (const n of tree) {
    if (n.path === path) return n
    const c = findInTree(n.children, path)
    if (c) return c
  }
  return null
}
