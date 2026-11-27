"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"

const THREAD = "#b8322a"

type Thread = { w: number; h: number; strand: string; twin: string }

const f = (n: number) => Math.round(n * 10) / 10

/**
 * Wraps "The making" and draws one red thread through it: out of the needle's
 * eye (`[data-thread-eye]`), a loose loop and a small knot by the needle,
 * then a gentle wave beside the text (the pillar-row gap nearest the needle,
 * `[data-pillar]`) out to the section's right edge. A doubled strand, like
 * real sewing thread. No turns back, no wrapping.
 *
 * Measured in the browser so the thread sits in the real gaps at every width.
 * Nothing is drawn on the server (no hydration mismatch); the thread appears
 * once mounted and follows resizes.
 */
export default function StitchedSection({
  className,
  children,
}: {
  className?: string
  children: ReactNode
}) {
  const ref = useRef<HTMLElement>(null)
  const [thread, setThread] = useState<Thread | null>(null)

  useEffect(() => {
    const section = ref.current
    if (!section) return

    const measure = () => {
      const s = section.getBoundingClientRect()
      const eyeEl = section.querySelector("[data-thread-eye]")
      const pillars = Array.from(section.querySelectorAll("[data-pillar]")).map(
        (el) => el.getBoundingClientRect()
      )
      if (!eyeEl || pillars.length === 0) return setThread(null)

      const e = eyeEl.getBoundingClientRect()
      const x0 = e.left + e.width / 2 - s.left
      const y0 = e.top + e.height / 2 - s.top

      // Group pillars into rows by their top edge.
      const rows: { top: number; bottom: number }[] = []
      for (const p of [...pillars].sort((a, b) => a.top - b.top)) {
        const row = rows.find((r) => Math.abs(r.top - (p.top - s.top)) < 8)
        if (row) row.bottom = Math.max(row.bottom, p.bottom - s.top)
        else rows.push({ top: p.top - s.top, bottom: p.bottom - s.top })
      }
      const gridLeft = Math.min(...pillars.map((p) => p.left)) - s.left
      const W = s.width
      // One straight run, no wrapping: through whichever line beside the text
      // sits nearest the needle — a gap between pillar rows, or just under
      // the last row. When the needle sits ABOVE the pillars (a phone's single
      // column), the run goes just above the first one, so the curve down to
      // it never crosses a line of text.
      const lines =
        y0 < rows[0].top
          ? [rows[0].top - 24]
          : [
              ...rows.slice(0, -1).map((r, i) => (r.bottom + rows[i + 1].top) / 2),
              rows[rows.length - 1].bottom + 28,
            ]
      const y = lines.reduce((best, l) =>
        Math.abs(l - y0) < Math.abs(best - y0) ? l : best
      )
      const runFrom = Math.max(gridLeft - 24, x0 + 90)
      // Smaller loop on a phone, where the button sits close to the needle.
      const k = W < 640 ? 0.55 : 1

      /** One loose strand: tail → eye → a loose loop → a small knot → a
       *  drift down to the line → a gentle wave out to the right edge.
       *  `dx/dy` and `amp` let the twin strand lie alongside, not on top. */
      const strand = (dx: number, dy: number, amp: number) => {
        const X = (v: number) => f(v + dx)
        const Y = (v: number) => f(v + dy)
        let d =
          `M ${X(x0 - 34)} ${Y(y0 - 16)} L ${X(x0)} ${Y(y0)}` +
          // the loose loop
          ` C ${X(x0 + 40 * k)} ${Y(y0 + 10 * k)} ${X(x0 + 72 * k)} ${Y(y0 + 62 * k)} ${X(x0 + 40 * k)} ${Y(y0 + 72 * k)}` +
          ` C ${X(x0 + 10 * k)} ${Y(y0 + 82 * k)} ${X(x0 + 4 * k)} ${Y(y0 + 36 * k)} ${X(x0 + 46 * k)} ${Y(y0 + 30 * k)}` +
          // a small knot
          ` C ${X(x0 + 62 * k)} ${Y(y0 + 28 * k)} ${X(x0 + 68 * k)} ${Y(y0 + 46 * k)} ${X(x0 + 57 * k)} ${Y(y0 + 46 * k)}` +
          ` C ${X(x0 + 48 * k)} ${Y(y0 + 46 * k)} ${X(x0 + 52 * k)} ${Y(y0 + 31 * k)} ${X(x0 + 74 * k)} ${Y(y0 + 35 * k)}` +
          // drift down (or up) to the line beside the text
          ` C ${X(x0 + 130 * k)} ${Y(y0 + 44 * k)} ${X(runFrom - 80)} ${Y(y)} ${X(runFrom)} ${Y(y)}`
        // a slow wave to the edge: one Q, then smooth T joins
        const L = W < 640 ? 90 : 150
        let x = runFrom + L
        d += ` Q ${X(runFrom + L / 2)} ${Y(y + amp)} ${X(x)} ${Y(y)}`
        while (x < W + L) {
          x += L
          d += ` T ${X(x)} ${Y(y)}`
        }
        return d
      }

      setThread({ w: W, h: s.height, strand: strand(0, 0, 9), twin: strand(1.4, 2.2, 7.5) })
    }

    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(section)
    window.addEventListener("load", measure)
    return () => {
      ro.disconnect()
      window.removeEventListener("load", measure)
    }
  }, [])

  return (
    <section ref={ref} className={`relative overflow-hidden ${className ?? ""}`}>
      {thread && (
        <svg
          aria-hidden
          className="pointer-events-none absolute inset-0 z-0"
          width={thread.w}
          height={thread.h}
          viewBox={`0 0 ${f(thread.w)} ${f(thread.h)}`}
          fill="none"
          stroke={THREAD}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {/* A doubled thread: the main strand and a fainter twin beside it. */}
          <path d={thread.strand} strokeWidth="1.3" />
          <path d={thread.twin} strokeWidth="0.9" strokeOpacity="0.45" />
        </svg>
      )}
      {children}
    </section>
  )
}
