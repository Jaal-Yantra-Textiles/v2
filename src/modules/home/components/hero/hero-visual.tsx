"use client"

import { motion } from "framer-motion"
import HeroScrollButton from "./hero-scroll-button"
import imageLoader from "@lib/util/image-loader"

interface HeroVisualProps {
  imageUrl: string | null
  alt?: string
  floatingImageUrl: string | null
}

// Routes Cloudflare-hosted heroes through `/cdn-cgi/image/...` (so the
// browser-fetched source is already <4MB) and falls back to Vercel's
// optimizer for everything else. Same logic as the next/image custom loader.
function nextImg(url: string, w: 384 | 640 | 750 | 1080, q = 85) {
  return imageLoader({ src: url, width: w, quality: q })
}

export default function HeroVisual({ imageUrl, alt, floatingImageUrl }: HeroVisualProps) {
  return (
    <div id="hero-section" className="relative w-full min-h-screen flex flex-col items-center justify-center overflow-hidden bg-[#0a0a0a] select-none px-4 sm:px-0">

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
            width: "clamp(180px, 38vw, 400px)",
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
            style={{ background: "linear-gradient(to bottom, rgba(10,10,10,0.15) 0%, rgba(10,10,10,0.55) 100%)" }}
          />
        </motion.div>
      )}

      {/* Purple glow behind image */}
      <div
        className="absolute z-0 pointer-events-none"
        style={{
          width: "clamp(200px, 50vw, 500px)",
          aspectRatio: "1",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -52%)",
          background: "radial-gradient(ellipse, rgba(155,114,207,0.25) 0%, transparent 70%)",
          filter: "blur(40px)",
        }}
      />

      {/* Floating image — top-left, hidden on mobile */}
      {floatingImageUrl && (
        <motion.div
          initial={{ opacity: 0, y: -60 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1.4, ease: [0.16, 1, 0.3, 1], delay: 0.6 }}
          className="absolute left-[3%] top-0 z-10 pointer-events-none float-image hidden sm:block"
          style={{ width: "clamp(120px, 14vw, 200px)" }}
        >
          <div
            className="w-full overflow-hidden shadow-2xl"
            style={{
              height: "clamp(200px, 50vh, 440px)",
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
            fontSize: "clamp(64px, 20vw, 260px)",
            WebkitTextStroke: "1.5px rgba(255,255,255,0.55)",
            color: "transparent",
          }}
        >
          CICI
        </span>
      </motion.div>

      {/* LABEL — solid white */}
      <motion.div
        initial={{ opacity: 0, y: 28 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 1, ease: "easeOut", delay: 0.7 }}
        aria-hidden
        className="relative z-20 pointer-events-none"
        style={{ marginTop: "clamp(-16px, -2.5vh, -28px)" }}
      >
        <span
          className="font-serif leading-none tracking-tighter text-white"
          style={{ fontSize: "clamp(44px, 13vw, 180px)" }}
        >
          LABEL
        </span>
      </motion.div>

      {/* Divider */}
      <motion.div
        initial={{ scaleX: 0 }}
        animate={{ scaleX: 1 }}
        transition={{ duration: 1, ease: [0.16, 1, 0.3, 1], delay: 0.9 }}
        className="relative z-20 h-px w-16 sm:w-24 bg-white/25 mt-4 sm:mt-6 origin-center"
      />

      {/* Tagline */}
      <motion.div
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.9, ease: "easeOut", delay: 1.05 }}
        className="relative z-20 mt-4 sm:mt-5 px-6"
      >
        <p className="text-white/40 text-[10px] sm:text-xs tracking-[0.2em] sm:tracking-[0.25em] uppercase font-sans text-center">
          Unique pieces with artists across the globe
        </p>
      </motion.div>

      {/* CTA — stacked on mobile, side-by-side on sm+ */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.9, ease: "easeOut", delay: 1.15 }}
        className="relative z-20 flex flex-col sm:flex-row items-center gap-3 mt-5 sm:mt-5 w-full max-w-xs sm:max-w-none sm:w-auto"
      >
        <a
          href="/design"
          className="w-full sm:w-auto text-center px-6 sm:px-8 py-3 border border-white/25 text-white text-xs tracking-[0.18em] sm:tracking-[0.2em] uppercase font-sans transition-all duration-300 hover:bg-white hover:text-black hover:border-white"
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
