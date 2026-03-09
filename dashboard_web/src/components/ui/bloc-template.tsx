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
        "bloc-template",
        className
      )}
    >
      <div
        className={cn(
          "bloc-template-inner",
          innerClassName
        )}
      >
        {children}
      </div>
    </div>
  )
}

export default BlocTemplate

