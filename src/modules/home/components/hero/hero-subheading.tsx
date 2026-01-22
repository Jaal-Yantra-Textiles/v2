"use client"

import { Heading } from "@medusajs/ui"
import { useEffect, useState } from "react"
import { motion, AnimatePresence } from "framer-motion"

const HeroSubheading = () => {
  const [phase, setPhase] = useState<"initial" | "secondary">("initial")

  useEffect(() => {
    const timeout = setTimeout(() => setPhase("secondary"), 3500)
    return () => clearTimeout(timeout)
  }, [])

  return (
    <div className="relative mt-4 w-full h-[80px] flex items-center justify-center overflow-hidden">
      <AnimatePresence mode="wait">
        {phase === "initial" ? (
          <motion.div
            key="initial"
            initial={{ opacity: 0, y: 20, filter: "blur(10px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, y: -20, filter: "blur(10px)" }}
            transition={{ duration: 0.8, ease: "easeOut" }}
            className="absolute inset-0 flex items-center justify-center text-center"
          >
            <Heading
              level="h2"
              className="text-lg leading-7 font-medium sm:text-2xl sm:leading-9 bg-gradient-to-r from-pink-300 via-purple-300 to-indigo-300 bg-clip-text text-transparent"
            >
              <span>With Care, </span>
              <span className="bg-gradient-to-r from-green-200 via-teal-300 to-blue-400 bg-clip-text text-transparent">
                Through Inversion:{" "}
              </span>
              <span className="bg-gradient-to-r from-yellow-200 via-orange-300 to-red-400 bg-clip-text text-transparent">
                Compassion Meets Impermanence
              </span>
            </Heading>
          </motion.div>
        ) : (
          <motion.div
            key="secondary"
            initial={{ opacity: 0, scale: 0.9, filter: "blur(10px)" }}
            animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
            transition={{ duration: 1, ease: "easeOut" }}
            className="absolute inset-0 flex items-center justify-center text-center"
          >
            <Heading
              level="h2"
              className="text-lg leading-7 font-medium sm:text-2xl sm:leading-9 bg-gradient-to-r from-indigo-200 via-purple-200 to-pink-200 bg-clip-text text-transparent"
            >
              We source good fabrics and turn them into
              <br className="hidden sm:block" />
              unique pieces with artists across the globe.
            </Heading>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export default HeroSubheading
