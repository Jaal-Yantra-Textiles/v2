"use client"

import { useLayoutEffect, useState } from "react"
import { usePathname } from "next/navigation"

export default function NavScrollHeader({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  // Start dark — useLayoutEffect corrects to white on non-hero pages before paint
  const [dark, setDark] = useState(true)

  useLayoutEffect(() => {
    const hero = document.getElementById("hero-section")
    if (!hero) {
      setDark(false)
      return
    }
    const update = () => setDark(window.scrollY < hero.offsetHeight * 0.85)
    update()
    window.addEventListener("scroll", update, { passive: true })
    return () => window.removeEventListener("scroll", update)
  }, [pathname])

  return (
    <div className="sticky top-0 inset-x-0 z-50 group" data-dark={dark}>
      <header className={[
        "relative h-16 mx-auto border-b transition-all duration-500",
        dark
          ? "border-white/10"
          : "bg-white/90 backdrop-blur-md border-ui-border-base",
      ].join(" ")}
        style={dark ? { background: "#0a0a0a" } : undefined}
      >
        {children}
      </header>
    </div>
  )
}
