"use client"

import { Heading, clx } from "@medusajs/ui"
import { useEffect, useState } from "react"

const HeroSubheading = () => {
  const [phase, setPhase] = useState<"initial" | "secondary">("initial")

  useEffect(() => {
    const timeout = setTimeout(() => setPhase("secondary"), 3200)
    return () => clearTimeout(timeout)
  }, [])

  return (
    <div
      className="relative mt-4 w-full"
      aria-live="polite"
    >
      {/* Initial message */}
      <Heading
        level="h2"
        className={clx(
          "text-lg leading-7 font-medium transition-all duration-700 ease-out sm:text-2xl sm:leading-9",
          "bg-gradient-to-r from-pink-300 via-purple-300 to-indigo-300 bg-clip-text text-transparent",
          phase === "initial"
            ? "opacity-100 relative"
            : "opacity-0 absolute inset-0 pointer-events-none"
        )}
      >
        <span>With Care, </span>
        <span className="bg-gradient-to-r from-green-200 via-teal-300 to-blue-400 bg-clip-text text-transparent">
          Through Inversion:{" "}
        </span>
        <span className="bg-gradient-to-r from-yellow-200 via-orange-300 to-red-400 bg-clip-text text-transparent">
          Compassion Meets Impermanence
        </span>
      </Heading>

      {/* Secondary message */}
      <Heading
        level="h2"
        className={clx(
          "text-lg leading-7 font-medium transition-all duration-700 ease-out sm:text-2xl sm:leading-9",
          "bg-gradient-to-r from-indigo-200 via-purple-200 to-pink-200 bg-clip-text text-transparent",
          phase === "secondary"
            ? "opacity-100 relative"
            : "opacity-0 absolute inset-0 pointer-events-none"
        )}
      >
        Okay, now that you know we source thoughtful fabrics, we turn them into
        pieces with artists across globe.
      </Heading>
    </div>
  )
}

export default HeroSubheading
