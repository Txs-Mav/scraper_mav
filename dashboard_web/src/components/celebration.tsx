"use client"

import { useEffect, useState } from "react"

interface Particle {
  id: number
  x: number
  y: number
  color: string
  rotation: number
  scale: number
  speedX: number
  speedY: number
  type: "circle" | "square" | "star"
}

const COLORS = [
  "#3B82F6", // blue
  "#8B5CF6", // purple
  "#10B981", // emerald
  "#F59E0B", // amber
  "#EF4444", // red
  "#EC4899", // pink
  "#06B6D4", // cyan
]

export default function Celebration({ onComplete }: { onComplete?: () => void }) {
  const [particles, setParticles] = useState<Particle[]>([])
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    const newParticles: Particle[] = Array.from({ length: 60 }, (_, i) => ({
      id: i,
      x: 50 + (Math.random() - 0.5) * 30,
      y: 40,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      rotation: Math.random() * 360,
      scale: 0.5 + Math.random() * 0.8,
      speedX: (Math.random() - 0.5) * 8,
      speedY: -3 - Math.random() * 6,
      type: (["circle", "square", "star"] as const)[Math.floor(Math.random() * 3)],
    }))
    setParticles(newParticles)

    const timer = setTimeout(() => {
      setVisible(false)
      onComplete?.()
    }, 2500)

    return () => clearTimeout(timer)
  }, [onComplete])

  if (!visible || particles.length === 0) return null

  return (
    <div className="fixed inset-0 z-[200] pointer-events-none overflow-hidden">
      {particles.map((p) => (
        <div
          key={p.id}
          className="absolute animate-confetti"
          style={{
            left: `${p.x}%`,
            top: `${p.y}%`,
            "--speed-x": `${p.speedX}vw`,
            "--speed-y": `${p.speedY}vh`,
            "--rotation": `${p.rotation}deg`,
            animationDelay: `${Math.random() * 200}ms`,
          } as React.CSSProperties}
        >
          {p.type === "circle" && (
            <div
              className="w-3 h-3 rounded-full"
              style={{ backgroundColor: p.color, transform: `scale(${p.scale})` }}
            />
          )}
          {p.type === "square" && (
            <div
              className="w-3 h-3 rounded-sm"
              style={{ backgroundColor: p.color, transform: `scale(${p.scale}) rotate(${p.rotation}deg)` }}
            />
          )}
          {p.type === "star" && (
            <div style={{ color: p.color, fontSize: `${12 * p.scale}px` }}>✦</div>
          )}
        </div>
      ))}
    </div>
  )
}
