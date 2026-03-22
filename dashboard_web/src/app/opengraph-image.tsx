import { ImageResponse } from "next/og"

export const alt = "Go-Data — Vos données, prêtes à l'emploi"
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
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #0a0a1a 0%, #1a1a3e 50%, #0a0a1a 100%)",
          position: "relative",
        }}
      >
        {/* Grid pattern overlay */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            backgroundImage:
              "linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)",
            backgroundSize: "60px 60px",
          }}
        />

        {/* Logo */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            width: 120,
            height: 120,
            borderRadius: 28,
            background: "linear-gradient(135deg, #2563eb 0%, #7c3aed 100%)",
            marginBottom: 32,
            boxShadow: "0 20px 60px rgba(37,99,235,0.3)",
          }}
        >
          <div
            style={{
              fontSize: 52,
              fontWeight: 900,
              color: "white",
              letterSpacing: -2,
              lineHeight: 1,
              marginBottom: 2,
            }}
          >
            GO
          </div>
          <div style={{ display: "flex", gap: 4, alignItems: "flex-end" }}>
            <div
              style={{
                width: 10,
                height: 14,
                background: "rgba(255,255,255,0.6)",
                borderRadius: 3,
              }}
            />
            <div
              style={{
                width: 10,
                height: 22,
                background: "rgba(255,255,255,0.7)",
                borderRadius: 3,
              }}
            />
            <div
              style={{
                width: 10,
                height: 30,
                background: "rgba(255,255,255,0.85)",
                borderRadius: 3,
              }}
            />
          </div>
        </div>

        {/* Title */}
        <div
          style={{
            fontSize: 64,
            fontWeight: 900,
            color: "white",
            letterSpacing: -2,
            marginBottom: 16,
            textAlign: "center",
          }}
        >
          Go-Data
        </div>

        {/* Subtitle */}
        <div
          style={{
            fontSize: 28,
            color: "rgba(255,255,255,0.6)",
            textAlign: "center",
            maxWidth: 700,
          }}
        >
          Vos données. Prêtes à l'emploi.
        </div>

        {/* URL */}
        <div
          style={{
            position: "absolute",
            bottom: 40,
            fontSize: 20,
            color: "rgba(255,255,255,0.35)",
          }}
        >
          go-data.co
        </div>
      </div>
    ),
    { ...size }
  )
}
