"use client"

import { useEffect, useRef, useState } from "react"
import { usePathname } from "next/navigation"

interface NavScrollHeaderProps {
  children: React.ReactNode
}

function isHomePath(pathname: string) {
  // Home is /{countryCode} e.g. /us, /in, /gb
  return pathname === "/" || /^\/[a-z]{2}\/?$/.test(pathname)
}

export default function NavScrollHeader({ children }: NavScrollHeaderProps) {
  const pathname = usePathname()
  const onHero = isHomePath(pathname)
  const [scrolled, setScrolled] = useState(false)
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    if (!onHero) {
      setScrolled(true)
      return
    }
    // Reset when navigating back to home
    setScrolled(window.scrollY > 60)

    const onScroll = () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      rafRef.current = requestAnimationFrame(() => {
        setScrolled(window.scrollY > 60)
      })
    }
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => {
      window.removeEventListener("scroll", onScroll)
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [onHero])

  const dark = onHero && !scrolled

  return (
    <div className="sticky top-0 inset-x-0 z-50" data-dark={dark}>
      <header
        className="relative h-16 mx-auto border-b transition-all duration-500"
        style={
          dark
            ? {
                background: "transparent",
                borderColor: "rgba(255,255,255,0.1)",
                color: "white",
              }
            : {
                background: "rgba(255,255,255,0.92)",
                backdropFilter: "blur(12px)",
                WebkitBackdropFilter: "blur(12px)",
                borderColor: "var(--border-base)",
              }
        }
      >
        {children}
      </header>
    </div>
  )
}
