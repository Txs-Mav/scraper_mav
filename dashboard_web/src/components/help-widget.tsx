"use client"

import { useState } from "react"
import {
  HelpCircle,
  X,
  MessageCircle,
  BookOpen,
  Mail,
  ExternalLink,
  ChevronRight,
  Keyboard,
} from "lucide-react"

interface HelpItem {
  icon: React.ElementType
  label: string
  description: string
  action: () => void
  color: string
}

export default function HelpWidget() {
  const [open, setOpen] = useState(false)

  const items: HelpItem[] = [
    {
      icon: BookOpen,
      label: "Guide & Tutoriel",
      description: "Revoir les étapes de démarrage",
      action: () => { setOpen(false); window.dispatchEvent(new CustomEvent("restart-onboarding")) },
      color: "text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/30",
    },
    {
      icon: Keyboard,
      label: "Raccourcis clavier",
      description: "⌘K pour rechercher",
      action: () => { setOpen(false); window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true })) },
      color: "text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-950/30",
    },
    {
      icon: Mail,
      label: "Nous contacter",
      description: "support@go-data.ca",
      action: () => window.open("mailto:support@go-data.ca"),
      color: "text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30",
    },
  ]

  return (
    <>
      {/* Floating button */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`fixed bottom-6 left-6 z-50 p-3.5 rounded-full shadow-lg transition-all duration-200 ${
          open
            ? "bg-gray-900 dark:bg-white text-white dark:text-gray-900 shadow-gray-900/20 rotate-90"
            : "bg-white dark:bg-[#1a1a1f] text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-800 hover:shadow-xl hover:-translate-y-0.5 hover:border-gray-300 dark:hover:border-gray-700"
        }`}
      >
        {open ? <X className="h-5 w-5" /> : <HelpCircle className="h-5 w-5" />}
      </button>

      {/* Panel */}
      {open && (
        <div className="fixed bottom-20 left-6 z-50 w-72 bg-white dark:bg-[#111114] rounded-2xl shadow-2xl shadow-black/15 dark:shadow-black/40 border border-gray-200 dark:border-gray-800 overflow-hidden animate-in slide-in-from-bottom-3 fade-in duration-200">
          <div className="px-5 pt-5 pb-3">
            <h3 className="text-sm font-bold text-gray-900 dark:text-white">Aide & Support</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Comment pouvons-nous vous aider ?</p>
          </div>

          <div className="px-3 pb-3 space-y-1">
            {items.map((item) => {
              const Icon = item.icon
              return (
                <button
                  key={item.label}
                  type="button"
                  onClick={item.action}
                  className="w-full flex items-center gap-3 px-3 py-3 rounded-xl text-left hover:bg-gray-50 dark:hover:bg-white/[0.03] transition-colors group"
                >
                  <div className={`p-2 rounded-xl ${item.color} flex-shrink-0`}>
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 dark:text-white">{item.label}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{item.description}</p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-gray-300 dark:text-gray-600 group-hover:text-gray-500 flex-shrink-0 transition" />
                </button>
              )
            })}
          </div>

          <div className="px-5 py-3 border-t border-gray-100 dark:border-gray-800">
            <p className="text-[11px] text-gray-400 dark:text-gray-500">
              Raccourci : <kbd className="px-1 py-0.5 rounded bg-gray-100 dark:bg-white/[0.06] font-mono text-[10px]">⌘K</kbd> pour chercher
            </p>
          </div>
        </div>
      )}
    </>
  )
}
