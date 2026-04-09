"use client"

import { cn } from "@/lib/utils"

function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "rounded-xl bg-gradient-to-r from-gray-200/50 via-gray-200/80 to-gray-200/50 dark:from-white/[0.03] dark:via-white/[0.06] dark:to-white/[0.03] bg-[length:200%_100%] animate-shimmer",
        className
      )}
    />
  )
}

export function DashboardSkeleton() {
  return (
    <div className="space-y-5 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <Skeleton className="h-8 w-44" />
          <Skeleton className="h-4 w-36" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-9 w-24 rounded-xl" />
          <Skeleton className="h-9 w-24 rounded-xl" />
        </div>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="col-span-2 md:col-span-1 rounded-2xl bg-emerald-100/50 dark:bg-emerald-950/20 p-5 space-y-3">
          <Skeleton className="h-3 w-16 !from-emerald-200/60 !to-emerald-200/60 dark:!from-emerald-900/40 dark:!to-emerald-900/40" />
          <Skeleton className="h-10 w-16 !from-emerald-200/60 !to-emerald-200/60 dark:!from-emerald-900/40 dark:!to-emerald-900/40" />
        </div>
        {[...Array(3)].map((_, i) => (
          <div key={i} className="rounded-2xl border border-[var(--color-border-tertiary)] bg-white/40 dark:bg-white/[0.015] p-4 space-y-3">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-6 w-10" />
          </div>
        ))}
      </div>

      {/* Extraction */}
      <div className="rounded-2xl border border-[var(--color-border-tertiary)] bg-white/40 dark:bg-white/[0.015] p-5 space-y-4">
        <div className="flex items-center gap-3">
          <Skeleton className="h-9 w-9 rounded-xl" />
          <div className="space-y-1.5">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-3 w-44" />
          </div>
        </div>
        <Skeleton className="h-11 w-full rounded-xl" />
      </div>

      {/* Products */}
      <div className="rounded-2xl border border-[var(--color-border-tertiary)] bg-[var(--color-background-primary)] overflow-hidden shadow-sm">
        <div className="p-5 flex items-center justify-between">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-4 w-20" />
        </div>
        {[...Array(5)].map((_, i) => (
          <div key={i} className="flex items-center gap-4 px-5 py-3 border-t border-[var(--color-border-tertiary)]">
            <Skeleton className="h-4 w-6" />
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-4 w-20 ml-auto" />
            <Skeleton className="h-6 w-16 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  )
}

export function AnalyticsSkeleton() {
  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <Skeleton className="h-8 w-48" />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="rounded-2xl border border-[var(--color-border-tertiary)] bg-[var(--color-background-primary)] p-6 space-y-4 shadow-sm">
            <Skeleton className="h-5 w-36" />
            <Skeleton className="h-44 w-full rounded-xl" />
          </div>
        ))}
      </div>
    </div>
  )
}

export function TableSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="rounded-2xl border border-[var(--color-border-tertiary)] bg-[var(--color-background-primary)] overflow-hidden shadow-sm animate-in fade-in duration-500">
      {[...Array(rows)].map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-5 py-3 border-b border-[var(--color-border-tertiary)] last:border-0">
          <Skeleton className="h-4 w-6" />
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 w-20 ml-auto" />
          <Skeleton className="h-6 w-16 rounded-full" />
        </div>
      ))}
    </div>
  )
}

export { Skeleton }
