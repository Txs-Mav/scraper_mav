"use client"

/**
 * Background ambient pour la page de Surveillance — variante BEAMS NEUTRES.
 *
 * Inspiré du `beams-background` de KokonutUI, mais en CSS pur (pas de
 * canvas / animation continue) et SANS palette colorée. L'utilisateur a
 * explicitement demandé "pas plus de couleur dans le fond, plus un effet
 * genre beams background de kokonut".
 *
 * Composition (de l'arrière vers l'avant) :
 *   1. Base — gris très clair (mode clair) / quasi-noir (mode sombre)
 *   2. Beams principaux — 3 rayons diagonaux larges et flous, palette
 *      neutre légèrement teintée de bleu ardoise, qui descendent de
 *      gauche-haut vers droite-bas
 *   3. Beams secondaires — 4 rayons plus fins en sens opposé pour
 *      croiser le motif et casser la régularité
 *   4. Halo central très doux pour donner un point focal subtil
 *   5. Grain SVG (texture papier) en blend multiply
 */
export default function SurveillanceBackground() {
  // Bruit fractal SVG pour la texture papier. Encodé en data-URL pour
  // éviter un asset externe.
  const noiseSvg = encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200">
      <filter id="n">
        <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch"/>
        <feColorMatrix values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.65 0"/>
      </filter>
      <rect width="100%" height="100%" filter="url(#n)"/>
    </svg>`,
  )

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-0 overflow-hidden"
    >
      {/* Couche 1 — Base neutre. Gris papier clair, ou quasi-noir dark. */}
      <div className="absolute inset-0 bg-[#f7f8fa] dark:bg-[#0f1112]" />

      {/* Couche dark matte — léger voile charbon chaud pour casser l'effet
          métallique des beams froids + du grain. En dark mode, on veut un
          fond feutré, pas une texture acier. */}
      <div
        className="absolute inset-0 hidden dark:block"
        style={{
          backgroundImage: [
            "radial-gradient(ellipse 80% 55% at 50% 0%, rgba(38, 42, 46, 0.38), transparent 70%)",
            "linear-gradient(180deg, rgba(17, 19, 20, 0.95) 0%, rgba(10, 11, 12, 0.98) 100%)",
          ].join(", "),
        }}
      />

      {/* Couche 2 — Beams principaux : 3 rayons diagonaux. Opacité
          divisée par 2 vs version précédente (0.25 au lieu de 0.55) —
          l'utilisateur a dit "l'effet beams est trop fort". On garde la
          structure mais on baisse drastiquement la présence visuelle. */}
      <div
        className="absolute inset-0 opacity-[0.16] dark:opacity-[0.08]"
        style={{
          backgroundImage: [
            "linear-gradient(105deg, transparent 12%, hsla(215, 22%, 80%, 0.40) 18%, hsla(215, 26%, 84%, 0.50) 22%, transparent 30%)",
            "linear-gradient(105deg, transparent 42%, hsla(220, 20%, 78%, 0.35) 48%, hsla(220, 24%, 82%, 0.45) 52%, transparent 60%)",
            "linear-gradient(105deg, transparent 70%, hsla(210, 24%, 82%, 0.40) 76%, hsla(210, 28%, 86%, 0.50) 82%, transparent 92%)",
          ].join(", "),
          filter: "blur(52px)",
          maskImage:
            "linear-gradient(180deg, black 0%, black 55%, transparent 100%)",
          WebkitMaskImage:
            "linear-gradient(180deg, black 0%, black 55%, transparent 100%)",
        }}
      />

      {/* Couche 3 — Beams secondaires : encore plus discrets (0.18). */}
      <div
        className="absolute inset-0 opacity-[0.10] dark:opacity-[0.06]"
        style={{
          backgroundImage: [
            "linear-gradient(-72deg, transparent 20%, hsla(220, 18%, 82%, 0.35) 25%, transparent 33%)",
            "linear-gradient(-72deg, transparent 50%, hsla(215, 20%, 80%, 0.30) 55%, transparent 63%)",
            "linear-gradient(-72deg, transparent 70%, hsla(210, 22%, 84%, 0.35) 75%, transparent 83%)",
            "linear-gradient(-72deg, transparent 88%, hsla(225, 20%, 82%, 0.30) 93%, transparent 100%)",
          ].join(", "),
          filter: "blur(48px)",
          maskImage:
            "linear-gradient(180deg, black 0%, black 50%, transparent 95%)",
          WebkitMaskImage:
            "linear-gradient(180deg, black 0%, black 50%, transparent 95%)",
        }}
      />

      {/* Couche 4 — Halo central allégé (0.30 au lieu de 0.50). */}
      <div
        className="absolute inset-0 opacity-[0.22] dark:opacity-[0.10]"
        style={{
          backgroundImage:
            "radial-gradient(ellipse 100% 70% at 50% 0%, hsla(220, 18%, 94%, 0.55), transparent 70%)",
        }}
      />

      {/* Couche 5 — Grain SVG (texture papier) — un poil plus discret. */}
      <div
        className="absolute inset-0 opacity-[0.12] dark:opacity-[0.08] mix-blend-multiply dark:mix-blend-soft-light"
        style={{
          backgroundImage: `url("data:image/svg+xml;utf8,${noiseSvg}")`,
          backgroundSize: "200px 200px",
        }}
      />
    </div>
  )
}
