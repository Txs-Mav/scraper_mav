function normalizeTextValue(raw?: string | null): string {
  return (raw || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

export function normalizeEtatValue(raw?: string | null): string {
  const value = normalizeTextValue(raw)
  if (!value) return ""

  if (
    value.includes("demo") ||
    value.includes("demonstrateur")
  ) {
    return "demonstrateur"
  }

  if (
    value.includes("occasion") ||
    value.includes("used") ||
    value.includes("pre owned") ||
    value.includes("pre possede") ||
    value.includes("usag")
  ) {
    return "occasion"
  }

  if (
    value.includes("neuf") ||
    value.includes("brand new") ||
    value === "new" ||
    value.includes("vehicule neuf")
  ) {
    return "neuf"
  }

  return value.replace(/\s+/g, "_")
}

export function normalizeSourceCategorieValue(raw?: string | null): string {
  const value = normalizeTextValue(raw)
  if (!value) return ""

  if (
    value.includes("vehicules occasion") ||
    value.includes("vehicule occasion") ||
    value.includes("produits occasion") ||
    value.includes("used inventory")
  ) {
    return "vehicules_occasion"
  }

  if (
    value.includes("catalog") ||
    value.includes("showroom") ||
    value.includes("gamme")
  ) {
    return "catalogue"
  }

  if (
    value.includes("inventaire") ||
    value.includes("inventory") ||
    value.includes("stock")
  ) {
    return "inventaire"
  }

  if (
    value.includes("occasion") ||
    value.includes("used") ||
    value.includes("usag")
  ) {
    return "vehicules_occasion"
  }

  return value.replace(/\s+/g, "_")
}

export function getEffectiveStatus(etat?: string | null, sourceCategorie?: string | null): string {
  return normalizeEtatValue(etat) || normalizeSourceCategorieValue(sourceCategorie)
}
