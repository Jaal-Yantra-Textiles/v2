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
      className="relative mt-4 h-[88px] w-full overflow-hidden"
      aria-live="polite"
    >
      <Heading
        level="h2"
        className={clx(
          "absolute inset-0 text-2xl leading-9 font-medium transition-all duration-700 ease-out",
          "bg-gradient-to-r from-pink-300 via-purple-300 to-indigo-300 bg-clip-text text-transparent",
          phase === "initial" ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-4"
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

      <Heading
        level="h2"
        className={clx(
          "absolute inset-0 text-2xl leading-9 font-medium transition-all duration-700 ease-out",
          "bg-gradient-to-r from-indigo-200 via-purple-200 to-pink-200 bg-clip-text text-transparent",
          phase === "secondary" ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
        )}
      >
        Okay, now that you know we source thoughtful fabrics, let&apos;s turn them
        into pieces with artists across Kashmir, the plains, and the desert.
      </Heading>
    </div>
  )
}

export default HeroSubheading
