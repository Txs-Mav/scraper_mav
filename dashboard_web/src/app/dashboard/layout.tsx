"use client"

import { useActivityTracker } from "@/hooks/use-activity-tracker"

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  useActivityTracker()
  return <>{children}</>
}
