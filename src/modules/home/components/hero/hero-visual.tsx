"use client"

import { motion } from "framer-motion"
import HeroScrollButton from "./hero-scroll-button"

interface HeroVisualProps {
  imageUrl: string | null
  alt?: string
  floatingImageUrl: string | null
}

function nextImg(url: string, w: 384 | 640 | 750 | 1080, q = 85) {
  return `/_next/image?url=${encodeURIComponent(url)}&w=${w}&q=${q}`
}

export default function HeroVisual({ imageUrl, alt, floatingImageUrl }: HeroVisualProps) {
  return (
    <div className="relative w-full min-h-screen flex flex-col items-center justify-center overflow-hidden bg-[#0a0a0a] select-none">

      {/* Noise overlay */}
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

      {/* ── MAIN IMAGE — behind everything, z-0 ── */}
      {imageUrl && (
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 1.4, ease: [0.16, 1, 0.3, 1], delay: 0.3 }}
          className="absolute z-0 blob-morph overflow-hidden shadow-2xl"
          style={{
            width: "clamp(240px, 42vh, 400px)",
            aspectRatio: "3/4",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -52%)",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={nextImg(imageUrl, 640)}
            alt={alt || "Cici Label model"}
            className="w-full h-full object-cover"
            draggable={false}
          />
          {/* Dark vignette so text stays readable */}
          <div
            className="absolute inset-0"
            style={{ background: "linear-gradient(to bottom, rgba(10,10,10,0.15) 0%, rgba(10,10,10,0.5) 100%)" }}
          />
        </motion.div>
      )}

      {/* Purple glow behind image */}
      <div
        className="absolute z-0 pointer-events-none"
        style={{
          width: "clamp(300px, 50vh, 500px)",
          aspectRatio: "1",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -52%)",
          background: "radial-gradient(ellipse, rgba(155,114,207,0.25) 0%, transparent 70%)",
          filter: "blur(40px)",
        }}
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
              src={nextImg(floatingImageUrl, 384)}
              alt=""
              className="w-full h-full object-cover object-top"
              draggable={false}
            />
          </div>
          {/* Fade to black at bottom */}
          <div
            className="absolute bottom-0 left-0 right-0 h-1/3 pointer-events-none"
            style={{ background: "linear-gradient(to bottom, transparent, #0a0a0a)" }}
          />
        </motion.div>
      )}

      {/* ── TEXT STACK — all in front of image (z-20+) ── */}

      {/* CICI — outline stroke */}
      <motion.div
        initial={{ opacity: 0, y: -32 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 1.1, ease: "easeOut", delay: 0.25 }}
        aria-hidden
        className="relative z-20 pointer-events-none"
      >
        <span
          className="font-serif leading-none tracking-tighter"
          style={{
            fontSize: "clamp(72px, 22vw, 260px)",
            WebkitTextStroke: "1.5px rgba(255,255,255,0.55)",
            color: "transparent",
          }}
        >
          CICI
        </span>
      </motion.div>

      {/* Spacer to push LABEL down over the image */}
      <div className="relative z-20" style={{ height: "clamp(160px, 28vh, 280px)" }} />

      {/* LABEL — solid white */}
      <motion.div
        initial={{ opacity: 0, y: 28 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 1, ease: "easeOut", delay: 0.7 }}
        aria-hidden
        className="relative z-20 pointer-events-none"
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
        className="relative z-20 h-px w-24 bg-white/25 mt-6 origin-center"
      />

      {/* Tagline */}
      <motion.div
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.9, ease: "easeOut", delay: 1.05 }}
        className="relative z-20 mt-5"
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
        className="relative z-20 flex items-center gap-4 mt-5"
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
