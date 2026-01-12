import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

interface BlocTemplateProps {
  children: ReactNode
  className?: string
  innerClassName?: string
}

/**
 * Enveloppe commune pour les blocs avec halo gradient sombre (style bloc_template).
 */
export function BlocTemplate({ children, className, innerClassName }: BlocTemplateProps) {
  return (
    <div
      className={cn(
        "bloc-template shadow-[0_20px_60px_-25px_rgba(0,0,0,0.45)]",
        className
      )}
    >
      <div
        className={cn(
          "bloc-template-inner bg-white/95 dark:bg-[#0F0F12]",
          innerClassName
        )}
      >
        {children}
      </div>
    </div>
  )
}

export default BlocTemplate

