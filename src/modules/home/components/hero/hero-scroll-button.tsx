"use client"

import { ArrowDownMini } from "@medusajs/icons"
import { useCallback } from "react"

type HeroScrollButtonProps = {
  targetId: string
}

const HeroScrollButton = ({ targetId }: HeroScrollButtonProps) => {
  const handleClick = useCallback(() => {
    const el = document.getElementById(targetId)
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" })
    }
  }, [targetId])

  return (
    <button
      type="button"
      onClick={handleClick}
      className="inline-flex items-center gap-3 rounded-full border border-white/30 bg-white/10 px-6 py-2 text-sm font-medium text-white backdrop-blur-sm shadow-lg transition-all hover:bg-white/15 focus:outline-none focus:ring-2 focus:ring-white/25"
    >
      <span>Scroll to explore the collections</span>
      <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-white/15">
        <ArrowDownMini className="h-4 w-4" color="currentColor" />
      </span>
    </button>
  )
}

export default HeroScrollButton
