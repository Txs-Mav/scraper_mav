import { ImageResponse } from "next/og"

export const size = { width: 180, height: 180 }
export const contentType = "image/png"

export default function AppleIcon() {
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
          background: "linear-gradient(135deg, #2563eb 0%, #7c3aed 100%)",
          borderRadius: 38,
        }}
      >
        <div
          style={{
            fontSize: 80,
            fontWeight: 900,
            color: "white",
            letterSpacing: -3,
            lineHeight: 1,
            marginBottom: 4,
          }}
        >
          GO
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "flex-end" }}>
          <div
            style={{
              width: 16,
              height: 24,
              background: "rgba(255,255,255,0.6)",
              borderRadius: 4,
            }}
          />
          <div
            style={{
              width: 16,
              height: 36,
              background: "rgba(255,255,255,0.7)",
              borderRadius: 4,
            }}
          />
          <div
            style={{
              width: 16,
              height: 48,
              background: "rgba(255,255,255,0.85)",
              borderRadius: 4,
            }}
          />
        </div>
      </div>
    ),
    { ...size }
  )
}
