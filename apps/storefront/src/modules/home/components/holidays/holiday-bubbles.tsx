"use client"

import { motion, AnimatePresence } from "framer-motion"
import { useState, useEffect, useRef } from "react"
import type { PublicHoliday } from "@lib/data/holidays"

// ── Confetti ──────────────────────────────────────────────────────────────────
const CONFETTI_COLORS = ["#FF8FAB", "#74B9FF", "#FDCB6E", "#A29BFE", "#55EFC4", "#FD79A8"]
const EMOJIS = ["🎉", "✨", "🎊", "🌟", "💫", "🎈"]

function Confetti() {
  const pieces = useRef(
    Array.from({ length: 20 }, (_, i) => ({
      id: i,
      x: (i / 20) * 100,
      delay: (i / 20) * 4,
      duration: 4 + (i % 4),
      size: 6 + (i % 4) * 2,
      color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      rotate: (i * 37) % 360,
      isEmoji: i % 5 === 0,
      emoji: EMOJIS[i % EMOJIS.length],
    }))
  ).current

  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      {pieces.map((p) =>
        p.isEmoji ? (
          <motion.span key={p.id} className="absolute text-lg select-none"
            style={{ left: `${p.x}%`, top: "-5%" }}
            animate={{ y: ["0vh", "110vh"], opacity: [0, 1, 1, 0] }}
            transition={{ duration: p.duration, delay: p.delay, repeat: Infinity, ease: "linear" }}
          >{p.emoji}</motion.span>
        ) : (
          <motion.div key={p.id} className="absolute rounded-sm"
            style={{ left: `${p.x}%`, top: "-5%", width: p.size, height: p.size, backgroundColor: p.color }}
            animate={{ y: ["0vh", "110vh"], opacity: [0, 0.9, 0.9, 0], rotate: [0, p.rotate + 360] }}
            transition={{ duration: p.duration, delay: p.delay, repeat: Infinity, ease: "linear" }}
          />
        )
      )}
    </div>
  )
}

// ── Balloon ───────────────────────────────────────────────────────────────────
function Balloon({
  color, knotColor, textColor = "#fff", width, children,
  floatDelay = 0, floatDuration = 4, stringHeight = 80, onClick, glowing,
}: {
  color: string; knotColor: string; textColor?: string; width: number
  children: React.ReactNode; floatDelay?: number; floatDuration?: number
  stringHeight?: number; onClick?: () => void; glowing?: boolean
}) {
  const height = width * 1.18
  return (
    <motion.div className="flex flex-col items-center relative"
      animate={{ y: [0, -22, 0], rotate: [-4, 4, -4] }}
      transition={{ duration: floatDuration, repeat: Infinity, ease: "easeInOut", delay: floatDelay }}
      onClick={onClick} style={{ cursor: onClick ? "pointer" : "default" }}
    >
      {glowing && (
        <motion.div className="absolute pointer-events-none"
          style={{
            width: width + 32, height: height + 32, top: -16, left: -16,
            background: "radial-gradient(ellipse, rgba(255,215,0,0.35) 0%, transparent 70%)",
            borderRadius: "50% 50% 48% 48% / 55% 55% 45% 45%",
          }}
          animate={{ opacity: [0.3, 1, 0.3], scale: [0.95, 1.06, 0.95] }}
          transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
        />
      )}
      <div className="relative flex flex-col items-center justify-center text-center shadow-2xl"
        style={{ width, height, backgroundColor: color, borderRadius: "50% 50% 48% 48% / 55% 55% 45% 45%", color: textColor }}
      >
        <div className="absolute pointer-events-none"
          style={{ top: "14%", left: "20%", width: "28%", height: "20%", background: "rgba(255,255,255,0.25)", borderRadius: "50%", transform: "rotate(-30deg)" }}
        />
        <div className="relative z-10 px-3">{children}</div>
      </div>
      <div style={{ width: 12, height: 13, backgroundColor: knotColor, clipPath: "polygon(50% 100%, 0% 0%, 100% 0%)", marginTop: -1 }} />
      <svg width={20} height={stringHeight} style={{ overflow: "visible", marginTop: -2 }}>
        <path d={`M10,0 Q${-8},${stringHeight / 2} 10,${stringHeight}`}
          fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    </motion.div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function HolidayBubbles({
  holiday, countryName, countryCode,
}: {
  holiday: PublicHoliday | null
  countryName: string
  countryCode: string
}) {
  const [copied, setCopied] = useState(false)
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const handleCopy = () => {
    navigator.clipboard.writeText("HOLIDAYS").then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    })
  }

  return (
    <div className="relative w-full h-full min-h-screen overflow-hidden select-none flex flex-col justify-center"
      style={{ background: "#0a0a0a" }}
    >
      {mounted && holiday && <Confetti />}

      {/* Soft colour blooms */}
      {["#FF8FAB", "#A29BFE", "#74B9FF"].map((c, i) => (
        <motion.div key={i} className="absolute rounded-full pointer-events-none"
          style={{
            width: 300 + i * 60, height: 300 + i * 60,
            backgroundColor: c, opacity: 0.06, filter: "blur(60px)",
            top: i === 0 ? "0%" : "40%",
            left: i === 0 ? "-10%" : i === 1 ? "50%" : "20%",
          }}
          animate={{ scale: [1, 1.1, 1] }}
          transition={{ duration: 7 + i * 2, repeat: Infinity, ease: "easeInOut", delay: i }}
        />
      ))}


      {/* Text */}
      <div className="relative z-10 text-center px-6 flex flex-col items-center gap-3">
        <p className="text-xs tracking-[0.28em] uppercase font-sans" style={{ color: "rgba(255,255,255,0.4)" }}>
          {countryCode.toUpperCase()} · {new Date().toLocaleDateString("en", { weekday: "long", month: "long", day: "numeric" })}
        </p>

        <AnimatePresence mode="wait">
          {holiday ? (
            <motion.div key="has" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              className="flex flex-col items-center gap-2"
            >
              <h2 className="font-serif tracking-tight text-white" style={{ fontSize: "clamp(28px, 5vw, 52px)" }}>
                Happy {holiday.localName}! 🎉
              </h2>
              <p className="text-sm font-sans max-w-sm" style={{ color: "rgba(255,255,255,0.5)" }}>
                It&apos;s a holiday in {countryName} — use{" "}
                <button onClick={handleCopy} className="font-bold text-white underline underline-offset-2">HOLIDAYS</button>
                {" "}for <span className="font-bold text-white">30% off</span>
              </p>
            </motion.div>
          ) : (
            <motion.div key="none" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              className="flex flex-col items-center gap-2"
            >
              <h2 className="font-serif tracking-tight text-white" style={{ fontSize: "clamp(24px, 4vw, 44px)" }}>
                No holiday today in {countryName}
              </h2>
              <p className="text-sm font-sans max-w-sm" style={{ color: "rgba(255,255,255,0.5)" }}>
                That doesn&apos;t mean you can&apos;t celebrate — use{" "}
                <button onClick={handleCopy} className="font-bold text-white underline underline-offset-2">HOLIDAYS</button>
                {" "}for <span className="font-bold text-white">30% off</span> anyway 🎈
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Balloons */}
      <motion.div className="relative z-10 flex items-end justify-center gap-12 sm:gap-24 mt-12 px-6"
        initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.15 }}
      >
        {/* Holiday balloon */}
        {holiday ? (
          <Balloon color="#FF8FAB" knotColor="#d4607a" width={160} floatDelay={0} floatDuration={4.5} stringHeight={100}>
            <span className="font-serif font-bold text-sm leading-snug block">{holiday.localName}</span>
            <span className="text-xs opacity-75 mt-1 block font-sans">
              {new Date(holiday.date + "T00:00:00").toLocaleDateString("en", { month: "long", day: "numeric" })}
            </span>
            <span className="text-2xl mt-2 block">🎊</span>
          </Balloon>
        ) : (
          <Balloon color="#1e1e1e" knotColor="#333" textColor="rgba(255,255,255,0.4)"
            width={115} floatDelay={0} floatDuration={5} stringHeight={80}
          >
            <span className="text-3xl block">😴</span>
            <span className="text-xs font-sans mt-1 block leading-tight opacity-60">No holiday<br />today</span>
          </Balloon>
        )}

        {/* Coupon balloon — always */}
        <Balloon color="#FFD700" knotColor="#c9a800" textColor="#111"
          width={holiday ? 150 : 162}
          floatDelay={0.5} floatDuration={3.8}
          stringHeight={holiday ? 92 : 105}
          onClick={handleCopy} glowing
        >
          <span className="font-sans font-black tracking-widest block" style={{ fontSize: 13 }}>HOLIDAYS</span>
          <span className="font-sans font-black block mt-0.5" style={{ fontSize: 26 }}>30% OFF</span>
          <motion.span className="block mt-1 tracking-widest uppercase font-sans"
            style={{ fontSize: 9, opacity: 0.6 }}
            animate={{ opacity: copied ? 1 : [0.4, 0.85, 0.4] }}
            transition={{ duration: 1.5, repeat: copied ? 0 : Infinity }}
          >
            {copied ? "✓ Copied!" : "Tap to copy"}
          </motion.span>
        </Balloon>
      </motion.div>
    </div>
  )
}
