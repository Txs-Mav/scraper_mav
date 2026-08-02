import { ImageResponse } from "next/og"

export const size = { width: 180, height: 180 }
export const contentType = "image/png"

// Monogramme Go-Data : G blanc sur pastille encre, point de données orange.
// Même géométrie que public/Go-Data.svg et src/app/icon.svg.
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#111827",
          borderRadius: 38,
        }}
      >
        <svg width="164" height="164" viewBox="0 0 100 100" fill="none">
          <path
            d="M 73.5 24.5 A 36 36 0 1 0 79 68"
            fill="none"
            stroke="#FFFFFF"
            strokeWidth="21"
            strokeLinecap="round"
          />
          <path
            d="M 62 42 H 93.5 A 3 3 0 0 1 96.5 45 V 59 A 3 3 0 0 1 93.5 62 H 62 Z"
            fill="#FFFFFF"
          />
          <circle cx="47" cy="51" r="12" fill="#F97316" />
        </svg>
      </div>
    ),
    { ...size }
  )
}
