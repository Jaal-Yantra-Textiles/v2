"use client"

import { useRef } from "react"
import { motion, useScroll, useTransform, useSpring } from "framer-motion"

interface ScrollStageProps {
  hero: React.ReactNode
  holiday: React.ReactNode
}

/**
 * Apple-style sticky scroll stage.
 * The hero is pinned. As the user scrolls through the 220vh container,
 * the holiday panel rises over it. On exit, normal page flow resumes.
 */
export default function ScrollStage({ hero, holiday }: ScrollStageProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ["start start", "end end"],
  })

  // Smooth spring for fluid feel on mobile + desktop
  const smooth = useSpring(scrollYProgress, { stiffness: 60, damping: 18, mass: 0.6 })

  // Hero: scales down and fades slightly as holiday rises
  const heroScale   = useTransform(smooth, [0, 0.55, 0.75], [1, 0.94, 0.88])
  const heroOpacity = useTransform(smooth, [0, 0.5, 0.75],  [1, 0.7, 0])
  const heroFilter  = useTransform(smooth, [0.3, 0.75], ["blur(0px)", "blur(8px)"])

  // Holiday panel: slides up from bottom
  const holidayY       = useTransform(smooth, [0.25, 0.72], ["100%", "0%"])
  const holidayOpacity = useTransform(smooth, [0.25, 0.5],   [0, 1])

  return (
    // Tall container — 220vh gives enough scroll room for the effect
    <div ref={containerRef} style={{ height: "220vh" }} className="relative">
      {/* Sticky viewport — stays pinned while scrolling through the container */}
      <div className="sticky top-0 h-screen overflow-hidden">

        {/* Hero layer */}
        <motion.div
          className="absolute inset-0"
          style={{
            scale: heroScale,
            opacity: heroOpacity,
            filter: heroFilter,
            transformOrigin: "center top",
          }}
        >
          {hero}
        </motion.div>

        {/* Holiday overlay — slides up over the hero, full viewport height */}
        <motion.div
          className="absolute inset-0"
          style={{ y: holidayY, opacity: holidayOpacity }}
        >
          {holiday}
        </motion.div>
      </div>
    </div>
  )
}
