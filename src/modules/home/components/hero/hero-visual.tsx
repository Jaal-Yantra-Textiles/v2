"use client"

import { motion } from "framer-motion"
import HeroScrollButton from "./hero-scroll-button"

interface HeroVisualProps {
  imageUrl: string | null
  alt?: string
  floatingImageUrl: string | null
}

export default function HeroVisual({ imageUrl, alt, floatingImageUrl }: HeroVisualProps) {
  return (
    <div className="relative w-full min-h-screen flex flex-col items-center justify-center overflow-hidden bg-[#0a0a0a] select-none">

      {/* Subtle noise overlay */}
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.025]"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E")`,
          backgroundRepeat: "repeat",
          backgroundSize: "128px",
        }}
      />

      {/* Top editorial rule */}
      <motion.div
        initial={{ scaleX: 0 }}
        animate={{ scaleX: 1 }}
        transition={{ duration: 1.4, ease: [0.16, 1, 0.3, 1], delay: 0.1 }}
        className="absolute top-[18%] left-0 right-0 h-px bg-white/10 origin-left pointer-events-none"
      />

      {/* Floating image — top-left, emerges from top of hero */}
      {floatingImageUrl && (
        <motion.div
          initial={{ opacity: 0, y: -60 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1.4, ease: [0.16, 1, 0.3, 1], delay: 0.6 }}
          className="absolute left-[3%] top-0 z-10 pointer-events-none float-image"
          style={{ width: "clamp(120px, 16vw, 220px)" }}
        >
          <div
            className="w-full overflow-hidden shadow-2xl"
            style={{
              height: "clamp(200px, 55vh, 480px)",
              borderRadius: "0 0 50% 50% / 0 0 40% 40%",
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/_next/image?url=${encodeURIComponent(floatingImageUrl)}&w=400&q=85`}
              alt=""
              className="w-full h-full object-cover object-top"
              draggable={false}
            />
          </div>
          {/* Fade to black at the bottom */}
          <div
            className="absolute bottom-0 left-0 right-0 h-1/3 pointer-events-none"
            style={{ background: "linear-gradient(to bottom, transparent, #0a0a0a)" }}
          />
          {/* Faint purple glow */}
          <div
            className="absolute -bottom-4 left-0 right-0 h-24 -z-10 blur-3xl opacity-25"
            style={{ background: "radial-gradient(ellipse, #c084fc 0%, transparent 70%)" }}
          />
        </motion.div>
      )}

      {/* CICI — large stroke text layered behind the main image */}
      <motion.div
        initial={{ opacity: 0, y: -32 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 1.1, ease: "easeOut", delay: 0.25 }}
        aria-hidden
        className="absolute z-10 flex items-center justify-center w-full pointer-events-none"
        style={{ top: "calc(50% - 4vw)" }}
      >
        <span
          className="font-serif leading-none tracking-tighter"
          style={{
            fontSize: "clamp(72px, 22vw, 260px)",
            WebkitTextStroke: "1.5px rgba(255,255,255,0.12)",
            color: "transparent",
          }}
        >
          CICI
        </span>
      </motion.div>

      {/* Main model image in morphing blob */}
      <motion.div
        initial={{ opacity: 0, y: 56, scale: 0.88 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 1.3, ease: [0.16, 1, 0.3, 1], delay: 0.45 }}
        className="relative z-20"
        style={{ width: "clamp(200px, 36vh, 340px)", aspectRatio: "3/4" }}
      >
        <div className="blob-morph w-full h-full overflow-hidden shadow-2xl">
          {imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/_next/image?url=${encodeURIComponent(imageUrl)}&w=640&q=85`}
              alt={alt || "Cici Label model"}
              className="w-full h-full object-cover"
              draggable={false}
            />
          ) : (
            <div className="w-full h-full bg-white/5 flex items-center justify-center">
              <span className="text-white/20 font-serif text-2xl tracking-widest">CICI</span>
            </div>
          )}
        </div>
        {/* Glow behind image */}
        <div
          className="absolute inset-0 -z-10 blur-3xl opacity-30 rounded-full"
          style={{ background: "radial-gradient(ellipse, #9b72cf 0%, transparent 70%)" }}
        />
      </motion.div>

      {/* LABEL — solid white, overlaps image bottom */}
      <motion.div
        initial={{ opacity: 0, y: 28 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 1, ease: "easeOut", delay: 0.7 }}
        aria-hidden
        className="relative z-30 pointer-events-none"
        style={{ marginTop: "clamp(-20px, -3vh, -28px)" }}
      >
        <span
          className="font-serif leading-none tracking-tighter text-white"
          style={{ fontSize: "clamp(52px, 14vw, 180px)" }}
        >
          LABEL
        </span>
      </motion.div>

      {/* Divider */}
      <motion.div
        initial={{ scaleX: 0 }}
        animate={{ scaleX: 1 }}
        transition={{ duration: 1, ease: [0.16, 1, 0.3, 1], delay: 0.9 }}
        className="relative z-30 h-px w-24 bg-white/25 mt-6 origin-center"
      />

      {/* Tagline */}
      <motion.div
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.9, ease: "easeOut", delay: 1.05 }}
        className="relative z-30 mt-5"
      >
        <p className="text-white/40 text-xs tracking-[0.25em] uppercase font-sans text-center">
          Unique pieces with artists across the globe
        </p>
      </motion.div>

      {/* CTA row — Design + Scroll side by side */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.9, ease: "easeOut", delay: 1.15 }}
        className="relative z-30 flex items-center gap-4 mt-5"
      >
        <a
          href="/design"
          className="px-8 py-3 border border-white/25 text-white text-xs tracking-[0.2em] uppercase font-sans transition-all duration-300 hover:bg-white hover:text-black hover:border-white"
        >
          Design your first piece
        </a>
        <HeroScrollButton targetId="shop" />
      </motion.div>

      {/* Bottom editorial rule */}
      <motion.div
        initial={{ scaleX: 0 }}
        animate={{ scaleX: 1 }}
        transition={{ duration: 1.4, ease: [0.16, 1, 0.3, 1], delay: 0.1 }}
        className="absolute bottom-[10%] left-0 right-0 h-px bg-white/10 origin-right pointer-events-none"
      />
    </div>
  )
}
