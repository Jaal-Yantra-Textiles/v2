"use client"

import { motion, AnimatePresence } from "framer-motion"
import { useState, useEffect, useRef } from "react"
import LocalizedClientLink from "@modules/common/components/localized-client-link"
import type { PublicHoliday } from "@lib/data/holidays"

const PAPER = "#f6efe3"
const INK = "#171512"

// ── Ambient motes ─────────────────────────────────────────────────────────────
// Slow, drifting specks of light — quiet depth behind the postcard.
const MOTE_COLORS = ["#FFD9A0", "#FFC9D8", "#C9C4FF", "#BFE3FF"]

function Motes() {
  const motes = useRef(
    Array.from({ length: 24 }, (_, i) => ({
      id: i,
      x: (i * 4.3 + (i % 5) * 6) % 100,
      size: 2 + (i % 4) * 1.6,
      delay: (i % 9) * 1.1,
      duration: 16 + (i % 6) * 3,
      drift: (i % 2 === 0 ? 1 : -1) * (10 + (i % 5) * 6),
      color: MOTE_COLORS[i % MOTE_COLORS.length],
      opacity: 0.15 + (i % 4) * 0.1,
    }))
  ).current

  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      {motes.map((m) => (
        <motion.span
          key={m.id}
          className="absolute rounded-full"
          style={{
            left: `${m.x}%`,
            bottom: "-6%",
            width: m.size,
            height: m.size,
            backgroundColor: m.color,
          }}
          animate={{
            y: ["0vh", "-105vh"],
            x: [0, m.drift, 0],
            opacity: [0, m.opacity, m.opacity, 0],
          }}
          transition={{
            duration: m.duration,
            delay: m.delay,
            repeat: Infinity,
            ease: "linear",
          }}
        />
      ))}
    </div>
  )
}

// ── Shimmer sweep ─────────────────────────────────────────────────────────────
function Shimmer() {
  return (
    <motion.div
      aria-hidden
      className="pointer-events-none absolute inset-y-0 w-1/3"
      style={{
        background:
          "linear-gradient(100deg, transparent 0%, rgba(255,255,255,0.55) 50%, transparent 100%)",
        skewX: "-14deg",
      }}
      initial={{ x: "-180%" }}
      animate={{ x: "380%" }}
      transition={{
        duration: 2.4,
        repeat: Infinity,
        repeatDelay: 6,
        ease: "easeInOut",
      }}
    />
  )
}

// ── Postmark ──────────────────────────────────────────────────────────────────
// Classic cancellation stamp, overlapping the postage stamp the way a real
// one does when it goes through the mail.
function Postmark({ label, date }: { label: string; date: string }) {
  return (
    <svg
      viewBox="0 0 120 120"
      aria-hidden
      className="h-[104px] w-[104px] small:h-[122px] small:w-[122px] text-[#171512]/35"
    >
      <circle cx="60" cy="60" r="46" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <circle
        cx="60"
        cy="60"
        r="38"
        fill="none"
        stroke="currentColor"
        strokeWidth="0.8"
        strokeDasharray="2.5 4"
      />
      <text
        x="60"
        y="50"
        textAnchor="middle"
        fontSize="7.5"
        letterSpacing="2.4"
        fill="currentColor"
      >
        CICI LABEL
      </text>
      <text
        x="60"
        y="67"
        textAnchor="middle"
        fontSize="12"
        letterSpacing="0.6"
        fill="currentColor"
      >
        {date}
      </text>
      <text
        x="60"
        y="79"
        textAnchor="middle"
        fontSize="6.5"
        letterSpacing="2"
        fill="currentColor"
      >
        {label}
      </text>
    </svg>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function HolidayBubbles({
  holiday,
  countryName,
  countryCode,
}: {
  holiday: PublicHoliday | null
  countryName: string
  countryCode: string
}) {
  const [copied, setCopied] = useState(false)
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const handleCopy = async () => {
    const done = () => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    }
    try {
      await navigator.clipboard.writeText("HOLIDAYS")
      done()
    } catch {
      // In-app browsers (Instagram, WhatsApp) and plain http have no
      // clipboard API — fall back to a hidden textarea so the tap still works.
      const el = document.createElement("textarea")
      el.value = "HOLIDAYS"
      el.setAttribute("readonly", "")
      el.style.position = "fixed"
      el.style.opacity = "0"
      document.body.appendChild(el)
      el.select()
      const ok = document.execCommand("copy")
      document.body.removeChild(el)
      if (ok) done()
    }
  }

  const dateShort = new Date().toLocaleDateString("en", {
    month: "short",
    day: "numeric",
  })

  return (
    <div
      className="relative w-full h-full min-h-screen overflow-hidden select-none flex flex-col justify-center py-20 small:py-24"
      style={{ background: "#0a0a0a" }}
    >
      {mounted && <Motes />}

      {/* Soft colour blooms */}
      {["#FF8FAB", "#A29BFE", "#74B9FF"].map((c, i) => (
        <motion.div
          key={i}
          className="absolute rounded-full pointer-events-none"
          style={{
            width: 300 + i * 60,
            height: 300 + i * 60,
            backgroundColor: c,
            opacity: 0.06,
            filter: "blur(60px)",
            top: i === 0 ? "0%" : "40%",
            left: i === 0 ? "-10%" : i === 1 ? "50%" : "20%",
          }}
          animate={{ scale: [1, 1.1, 1] }}
          transition={{ duration: 7 + i * 2, repeat: Infinity, ease: "easeInOut", delay: i }}
        />
      ))}

      {/* Quiet line above the postcard — no date, no headline */}
      <div className="relative z-10 text-center px-6 flex flex-col items-center">
        <AnimatePresence mode="wait">
          {holiday ? (
            <motion.p
              key="has"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="text-sm font-sans max-w-md text-balance"
              style={{ color: "rgba(255,255,255,0.5)" }}
            >
              It&apos;s {holiday.localName} in {countryName}. Celebrate the festive
              with something made by hands.
            </motion.p>
          ) : (
            <motion.p
              key="none"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="text-sm font-sans max-w-md text-balance"
              style={{ color: "rgba(255,255,255,0.5)" }}
            >
              Nothing on the calendar in {countryName} today — send yourself a
              postcard anyway.
            </motion.p>
          )}
        </AnimatePresence>
      </div>

      {/* Postcard */}
      <motion.div
        className="relative z-10 mx-auto mt-10 w-full max-w-6xl px-5 small:mt-12"
        initial={{ opacity: 0, y: 28 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, delay: 0.2, ease: [0.22, 1, 0.36, 1] }}
      >
        <motion.div
          className="relative overflow-hidden rounded-[3px] shadow-[0_40px_90px_-40px_rgba(0,0,0,0.85)]"
          style={{ backgroundColor: PAPER }}
          animate={{ y: [0, -7, 0], rotate: [-0.35, 0.35, -0.35] }}
          transition={{ duration: 11, repeat: Infinity, ease: "easeInOut" }}
        >
          {/* Paper sheen */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                "radial-gradient(120% 100% at 0% 0%, rgba(255,255,255,0.7) 0%, transparent 55%)",
            }}
          />

          <div className="relative grid grid-cols-1 small:grid-cols-[1.12fr_1fr]">
            {/* Left — the message */}
            <div className="flex flex-col justify-between px-8 py-10 small:px-14 small:py-14">
              <div>
                <p
                  className="text-[10px] tracking-[0.32em] uppercase font-sans"
                  style={{ color: `${INK}66` }}
                >
                  Cici Label · Postcard
                </p>

                <p
                  className="mt-8 -rotate-1 font-serif italic leading-[1.25] text-balance"
                  style={{ color: INK, fontSize: "clamp(26px, 3.4vw, 42px)" }}
                >
                  {holiday
                    ? `Celebrate ${holiday.localName} with something made by hands.`
                    : "Celebrate the festive with something made by hands."}
                </p>

                <p
                  className="mt-6 max-w-[38ch] font-sans text-[14px] leading-relaxed"
                  style={{ color: `${INK}8a` }}
                >
                  Handloom cloth, natural dyes, slow hours — a piece that still
                  carries the maker&apos;s fingerprint.
                </p>
              </div>

              <div className="mt-10">
                <div className="h-px w-10" style={{ backgroundColor: `${INK}33` }} />
                <p
                  className="mt-4 font-serif italic text-[15px]"
                  style={{ color: `${INK}99` }}
                >
                  — with care, Cici Label
                </p>
              </div>
            </div>

            {/* Right — stamp, postmark, address */}
            <div
              className="relative flex flex-col justify-between border-t border-dashed px-8 py-10 small:border-t-0 small:border-l small:px-12 small:py-14"
              style={{ borderColor: `${INK}26` }}
            >
              {/* Stamp + postmark */}
              <div className="flex items-start justify-end">
                <div className="mt-9 -mr-7 rotate-[-9deg]">
                  <Postmark
                    label={countryCode.toUpperCase()}
                    // Rendered on the server too: the server's date can be a
                    // day off from the visitor's, so print it once mounted.
                    date={mounted ? dateShort : ""}
                  />
                </div>

                <motion.button
                  type="button"
                  onClick={handleCopy}
                  aria-label="Copy discount code HOLIDAYS"
                  className="relative z-10 shrink-0 rounded-[2px] outline-none focus-visible:ring-2 focus-visible:ring-[#171512]/40 focus-visible:ring-offset-4 focus-visible:ring-offset-[#f6efe3]"
                  initial={false}
                  whileHover={{ rotate: -3, scale: 1.04 }}
                  whileTap={{ scale: 0.96 }}
                  transition={{ type: "spring", stiffness: 300, damping: 20 }}
                >
                  <div
                    className="rotate-[3deg] p-[5px] shadow-[0_14px_28px_-16px_rgba(0,0,0,0.6)]"
                    style={{ backgroundColor: "#fdfaf3" }}
                  >
                    <div
                      className="relative flex h-[118px] w-[98px] flex-col items-center justify-center overflow-hidden text-center small:h-[136px] small:w-[112px]"
                      style={{ backgroundColor: "#e8cd97", color: "#2a2416" }}
                    >
                      <Shimmer />
                      <span className="text-[8px] tracking-[0.24em] uppercase opacity-70">
                        Cici Label
                      </span>
                      <span className="mt-2 font-serif text-[30px] leading-none small:text-[34px]">
                        30%
                      </span>
                      <span className="font-serif text-[15px] leading-tight small:text-[17px]">
                        off
                      </span>
                      <span className="mt-2 text-[8px] tracking-[0.26em] uppercase opacity-75">
                        Holidays
                      </span>
                    </div>
                  </div>
                </motion.button>
              </div>

              {/* Address block */}
              <div className="mt-9 small:mt-12">
                <p
                  className="text-[10px] tracking-[0.28em] uppercase font-sans"
                  style={{ color: `${INK}59` }}
                >
                  Deliver to
                </p>

                <p
                  className="mt-3 font-serif italic text-[15px] leading-snug"
                  style={{ color: `${INK}cc` }}
                >
                  Someone who deserves something handmade
                </p>

                {[0, 1].map((i) => (
                  <div
                    key={i}
                    className="mt-5 h-px w-full"
                    style={{ backgroundColor: `${INK}26` }}
                  />
                ))}
              </div>

              {/* Footer row */}
              <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
                <motion.span
                  className="text-[10px] tracking-[0.22em] uppercase font-sans"
                  style={{ color: `${INK}73` }}
                  animate={{ opacity: copied ? 1 : [0.5, 0.9, 0.5] }}
                  transition={{ duration: 2.6, repeat: copied ? 0 : Infinity }}
                >
                  {copied ? "✓ HOLIDAYS copied" : "Tap the stamp to copy"}
                </motion.span>

                <LocalizedClientLink
                  href="/store"
                  className="group inline-flex items-center gap-2 text-[11px] font-sans uppercase tracking-[0.2em]"
                  style={{ color: INK }}
                >
                  Shop handmade
                  <span
                    aria-hidden
                    className="transition-transform duration-150 ease-in-out group-hover:translate-x-1"
                  >
                    →
                  </span>
                </LocalizedClientLink>
              </div>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </div>
  )
}
