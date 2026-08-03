import { ImageResponse } from "next/og"

export const alt = "Go-Data — Veille de prix pour concessionnaires moto et sports motorisés"
export const size = { width: 1200, height: 630 }
export const contentType = "image/png"

export default function OGImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#111827",
          padding: "72px 80px",
          position: "relative",
        }}
      >
        {/* Grille discrète */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            backgroundImage:
              "linear-gradient(rgba(255,255,255,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px)",
            backgroundSize: "64px 64px",
          }}
        />
        {/* Halo orange bas-droite */}
        <div
          style={{
            position: "absolute",
            right: -160,
            bottom: -220,
            width: 560,
            height: 560,
            borderRadius: 9999,
            background: "radial-gradient(circle, rgba(249,115,22,0.22) 0%, rgba(249,115,22,0) 70%)",
          }}
        />

        {/* En-tête : monogramme + wordmark */}
        <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
          <svg width="104" height="104" viewBox="0 0 512 512" fill="none">
            <rect width="512" height="512" rx="108" fill="#1f2937" />
            <g transform="translate(16,16) scale(4.8)">
              <path
                d="M 73.5 24.5 A 36 36 0 1 0 79 68"
                fill="none"
                stroke="#FFFFFF"
                strokeWidth="21"
                strokeLinecap="round"
              />
              <path d="M 62 42 H 93.5 A 3 3 0 0 1 96.5 45 V 59 A 3 3 0 0 1 93.5 62 H 62 Z" fill="#FFFFFF" />
              <circle cx="47" cy="51" r="11" fill="#F97316" />
            </g>
          </svg>
          <div
            style={{
              fontSize: 54,
              fontWeight: 800,
              color: "white",
              letterSpacing: -1.5,
            }}
          >
            Go-Data
          </div>
        </div>

        {/* Message principal */}
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div
            style={{
              fontSize: 68,
              fontWeight: 800,
              color: "white",
              letterSpacing: -2.5,
              lineHeight: 1.08,
              maxWidth: 1010,
            }}
          >
            Veille de prix pour concessionnaires moto et sports motorisés
          </div>
          <div
            style={{
              fontSize: 30,
              color: "rgba(255,255,255,0.66)",
              letterSpacing: -0.5,
            }}
          >
            Comparez votre position. Détectez les écarts. Ajustez vos prix.
          </div>
        </div>

        {/* Pied : URL */}
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div
            style={{
              width: 14,
              height: 14,
              borderRadius: 9999,
              background: "#F97316",
            }}
          />
          <div style={{ fontSize: 26, fontWeight: 600, color: "#F97316" }}>go-data.co</div>
        </div>
      </div>
    ),
    { ...size }
  )
}
