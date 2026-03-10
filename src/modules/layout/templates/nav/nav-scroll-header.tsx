"use client"

import { useLayoutEffect, useState } from "react"
import { usePathname } from "next/navigation"

export default function NavScrollHeader({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const [dark, setDark] = useState(false)

  // useLayoutEffect runs synchronously before paint — no white flash
  useLayoutEffect(() => {
    const hero = document.getElementById("hero-section")
    if (!hero) {
      setDark(false)
      return
    }

    const update = () => {
      setDark(window.scrollY < hero.offsetHeight * 0.85)
    }
    update()
    window.addEventListener("scroll", update, { passive: true })
    return () => window.removeEventListener("scroll", update)
  }, [pathname])

  return (
    <div className="sticky top-0 inset-x-0 z-50 group" data-dark={dark}>
      <header
        className="relative h-16 mx-auto border-b transition-all duration-500"
        style={
          dark
            ? { background: "transparent", borderColor: "rgba(255,255,255,0.1)", color: "white" }
            : { background: "rgba(255,255,255,0.92)", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)", borderColor: "var(--border-base)" }
        }
      >
        {children}
      </header>
    </div>
  )
}
