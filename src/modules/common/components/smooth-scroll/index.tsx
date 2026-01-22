"use client"

import { ReactLenis } from "lenis/react"
import "lenis/dist/lenis.css"

export default function SmoothScroll({ children }: { children: React.ReactNode }) {
    return (
        <ReactLenis root options={{ lerp: 0.1, duration: 1.5 }}>
            {children}
        </ReactLenis>
    )
}
