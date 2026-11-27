import imageLoader from "@lib/util/image-loader"
import LocalizedClientLink from "@modules/common/components/localized-client-link"

/**
 * The real Dhauladhar behind the drawn foothills. Set the public media URL of
 * the photo here (or override per deploy with NEXT_PUBLIC_GENESIS_PHOTO_URL).
 * Set it to "" in code to fall back to the drawn snow range alone.
 */
const GENESIS_PHOTO_URL =
  process.env.NEXT_PUBLIC_GENESIS_PHOTO_URL ||
  // The founder's own photo from Dharamshala, evening light on the snow.
  "https://automatic.jaalyantra.com/automatica/IMG_0138-357d62ad975e71d4.jpg"
const GENESIS_PHOTO_ALT = "The snow peaks of the Dhauladhar above Dharamshala"

const INK = "#1c1917"

// The Dhauladhar: the snow range that stands behind Dharamshala. Sharp,
// broken peaks — the only range drawn with straight-ish strokes.
const FAR_RIDGE =
  "M -40 300 L 60 262 L 112 276 L 190 204 L 232 218 L 300 156 L 342 180 L 402 140 L 452 172 L 522 198 L 590 162 L 650 184 L 722 116 L 772 152 L 822 140 L 882 188 L 952 160 L 1012 202 L 1082 150 L 1132 174 L 1202 132 L 1262 170 L 1322 206 L 1392 184 L 1480 232"

const MID_RIDGE =
  "M -40 386 C 92 374 154 300 270 292 C 380 285 426 340 534 334 C 640 328 688 244 796 232 C 896 221 942 306 1046 314 C 1150 322 1196 254 1298 246 C 1394 239 1442 312 1480 322"

const NEAR_RIDGE =
  "M -40 454 C 86 446 158 366 280 356 C 392 347 440 412 550 406 C 662 400 714 310 826 298 C 928 287 974 376 1082 386 C 1184 396 1236 322 1338 314 C 1426 307 1464 380 1500 388"

const WASH_CLOSE = " L 1500 620 L -40 620 Z"

/** A deodar (Himalayan cedar): three tiers on a stub of trunk, 27 units tall,
 *  drawn from its base so it can stand on a ridge point. */
const DEODAR = "M 0 -27 L -5 -17 L -2 -17 L -7 -9 L -2 -9 L -9 0 L -1 0 L -1 3 L 1 3 L 1 0 L 9 0 L 2 -9 L 7 -9 L 2 -17 L 5 -17 Z"

/** Where the deodars stand on the near ridge, with a little size variety. */
const DEODARS: Array<[x: number, y: number, scale: number]> = [
  [214, 371, 0.9], [238, 366, 1.15], [262, 361, 0.8],
  [806, 303, 1], [832, 300, 1.25], [858, 304, 0.9],
  [1304, 319, 0.85], [1330, 315, 1.1], [1356, 318, 0.95],
]

/**
 * Origin band that closes the collection rails: a hand-drawn ridge of the
 * Dharamshala valley under the brand's first statement.
 *
 * Everything is a single pen language — cubic beziers, tapered ink gradients,
 * a turbulence wobble so no line is mechanically straight, a second offset
 * pass on the front ridge, and a light wash behind each range for depth.
 * The far range is the snow-capped Dhauladhar; a few deodars stand on the
 * near ridge. Otherwise just the ranges, the mist and the paper grain.
 *
 * Static on purpose — this is the quiet beat between the hero, the postcard
 * and the media grid.
 */
const Genesis = ({ photoUrl = GENESIS_PHOTO_URL }: { photoUrl?: string }) => {
  const hasPhoto = Boolean(photoUrl)

  return (
    <section className="relative w-full overflow-hidden bg-gradient-to-b from-[#f7f4ef] via-[#f1eade] to-[#e7ddcc]">
      {/* The photograph: real snow peaks at the back. Toned towards the
          paper (desaturated, warmed, multiplied) and faded out at the top
          and bottom, so it reads as part of the plate, not a pasted banner. */}
      {hasPhoto && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-[440px] small:h-[620px]"
          style={{
            maskImage:
              "linear-gradient(to bottom, transparent 0%, black 26%, black 62%, transparent 94%)",
            WebkitMaskImage:
              "linear-gradient(to bottom, transparent 0%, black 26%, black 62%, transparent 94%)",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imageLoader({ src: photoUrl, width: 1600 })}
            srcSet={`${imageLoader({ src: photoUrl, width: 900 })} 900w, ${imageLoader({ src: photoUrl, width: 1600 })} 1600w, ${imageLoader({ src: photoUrl, width: 2400 })} 2400w`}
            sizes="100vw"
            alt={GENESIS_PHOTO_ALT}
            loading="lazy"
            decoding="async"
            draggable={false}
            className="h-full w-full object-cover object-[center_46%] opacity-90 mix-blend-multiply"
            style={{ filter: "saturate(0.8) sepia(0.12) contrast(0.94) brightness(1.06)" }}
          />
        </div>
      )}

      {/* ---------------------------------------------------------------
          The ridge plate. Filled washes give the ranges body; the ink
          strokes on top give them a drawn edge.
      ----------------------------------------------------------------- */}
      <svg
        aria-hidden
        viewBox="0 0 1440 620"
        // Keep the drawing's proportions and crop the sides on a narrow screen;
        // "none" squeezed 1440 units into a phone and turned slopes into spikes.
        preserveAspectRatio="xMidYMax slice"
        className={`pointer-events-none absolute inset-x-0 bottom-0 w-full ${hasPhoto ? "h-[300px] small:h-[420px]" : "h-[52%] small:h-[72%]"}`}
      >
        <defs>
          {/* Drags every stroke a few pixels off true, like a nib. */}
          <filter
            id="genesis-wobble"
            x="-4%"
            y="-4%"
            width="108%"
            height="108%"
          >
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.008 0.014"
              numOctaves="2"
              seed="9"
              result="noise"
            />
            <feDisplacementMap
              in="SourceGraphic"
              in2="noise"
              scale="6"
              xChannelSelector="R"
              yChannelSelector="G"
            />
          </filter>

          {/* Ink fades at both edges so no line stops abruptly. */}
          <linearGradient id="genesis-ink-soft" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0%" stopColor={INK} stopOpacity="0" />
            <stop offset="14%" stopColor={INK} stopOpacity="0.09" />
            <stop offset="52%" stopColor={INK} stopOpacity="0.12" />
            <stop offset="86%" stopColor={INK} stopOpacity="0.07" />
            <stop offset="100%" stopColor={INK} stopOpacity="0" />
          </linearGradient>

          <linearGradient id="genesis-ink-strong" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0%" stopColor={INK} stopOpacity="0" />
            <stop offset="10%" stopColor={INK} stopOpacity="0.22" />
            <stop offset="55%" stopColor={INK} stopOpacity="0.3" />
            <stop offset="92%" stopColor={INK} stopOpacity="0.16" />
            <stop offset="100%" stopColor={INK} stopOpacity="0" />
          </linearGradient>

          {/* Far range by HEIGHT, not by shape: whatever rises above the snow
              line reads white, the rest fades into the paper. */}
          <linearGradient
            id="genesis-wash-far"
            gradientUnits="userSpaceOnUse"
            x1="0"
            x2="0"
            y1="110"
            y2="340"
          >
            <stop offset="0%" stopColor="#fffdf8" stopOpacity="0.95" />
            <stop offset="24%" stopColor="#fffdf8" stopOpacity="0.8" />
            <stop offset="38%" stopColor="#c8b79b" stopOpacity="0.36" />
            <stop offset="100%" stopColor="#c8b79b" stopOpacity="0.04" />
          </linearGradient>

          <linearGradient id="genesis-wash-mid" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#b3a082" stopOpacity="0.38" />
            <stop offset="100%" stopColor="#b3a082" stopOpacity="0.03" />
          </linearGradient>

          {/* Mist pooling in the valley between the ranges. */}
          <radialGradient id="genesis-mist" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0%" stopColor="#fbf7ef" stopOpacity="0.75" />
            <stop offset="100%" stopColor="#fbf7ef" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Far range: wash, then edge. With a photo, the real peaks take
            this place and the drawing starts at the foothills. */}
        {!hasPhoto && (
          <>
            <path d={FAR_RIDGE + WASH_CLOSE} fill="url(#genesis-wash-far)" />
            <g
              filter="url(#genesis-wobble)"
              fill="none"
              stroke="url(#genesis-ink-soft)"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path
                d={FAR_RIDGE}
                strokeWidth="1.1"
                vectorEffect="non-scaling-stroke"
              />
            </g>
          </>
        )}

        <ellipse cx="720" cy="430" rx="760" ry="58" fill="url(#genesis-mist)" />

        {/* Mid range — drawing only. Over a photo its wash would veil the
            real peaks, so there the front pen line carries the drawing alone. */}
        {!hasPhoto && (
          <>
            <path d={MID_RIDGE + WASH_CLOSE} fill="url(#genesis-wash-mid)" />
            <g
              filter="url(#genesis-wobble)"
              fill="none"
              stroke="url(#genesis-ink-soft)"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path
                d={MID_RIDGE}
                strokeWidth="1.2"
                vectorEffect="non-scaling-stroke"
              />
            </g>
          </>
        )}

        {/* Near range: broad under-stroke, crisp edge, second pencil pass. */}
        <g
          filter="url(#genesis-wobble)"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path
            d={NEAR_RIDGE}
            stroke={INK}
            strokeOpacity="0.05"
            strokeWidth="7"
            vectorEffect="non-scaling-stroke"
          />
          <path
            d={NEAR_RIDGE}
            stroke="url(#genesis-ink-strong)"
            strokeWidth="1.7"
            vectorEffect="non-scaling-stroke"
          />
          <path
            d={NEAR_RIDGE}
            stroke="url(#genesis-ink-strong)"
            strokeWidth="0.8"
            opacity="0.4"
            transform="translate(5 6)"
            vectorEffect="non-scaling-stroke"
          />
        </g>

        {/* A few deodars on the near ridge, kept faint so they read as
            distance, not decoration. */}
        <g fill={INK} fillOpacity="0.11">
          {DEODARS.map(([x, y, k]) => (
            <path
              key={`${x}-${y}`}
              d={DEODAR}
              transform={`translate(${x} ${y + 3}) scale(${k})`}
            />
          ))}
        </g>
      </svg>

      {/* Paper grain, so the band reads as stock rather than a gradient. */}
      <svg
        aria-hidden
        className="pointer-events-none absolute inset-0 h-full w-full opacity-[0.05] mix-blend-multiply"
      >
        <filter id="genesis-grain">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.85"
            numOctaves="3"
            stitchTiles="stitch"
          />
        </filter>
        <rect width="100%" height="100%" filter="url(#genesis-grain)" />
      </svg>

      {/* Paper glow behind the words: the ridges stay visible at the edges but
          fade where the text sits, so no line crosses a sentence at full ink. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 46% 42% at 50% 46%, rgba(247,244,239,0.92) 0%, rgba(247,244,239,0.6) 55%, rgba(247,244,239,0) 100%)",
        }}
      />

      <div className={`content-container relative z-10 flex flex-col items-center text-center ${hasPhoto ? "pt-28 pb-[300px] small:pt-40 small:pb-[440px]" : "py-28 small:py-40"}`}>
        <div className="flex items-center gap-3">
          <span aria-hidden className="h-px w-8 bg-neutral-900/20" />
          <p className="txt-small uppercase tracking-[0.28em] text-ui-fg-muted">
            32.2190° N · 76.3234° E
          </p>
          <span aria-hidden className="h-px w-8 bg-neutral-900/20" />
        </div>

        <h2 className="mt-8 max-w-4xl font-serif text-4xl leading-[1.05] tracking-tight text-balance text-neutral-900 small:text-6xl">
          Genesis in Dharamshala
        </h2>

        <div className="mt-6 flex items-center gap-4">
          <span aria-hidden className="h-px w-10 bg-neutral-900/25" />
          <p className="font-serif text-xl italic text-neutral-700 small:text-2xl">
            Made for the world.
          </p>
          <span aria-hidden className="h-px w-10 bg-neutral-900/25" />
        </div>

        <div className="mt-10 max-w-2xl space-y-6 font-serif text-lg leading-relaxed text-neutral-700 small:text-xl">
          <p>
            As the mythology goes, the goddess of the Himalayas sent out a
            whisper to me and asked me to perform duties which help me develop
            care-based products that may help you and all of us to look inside.
          </p>
          <p>
            Then, if you survive the ordeal of the world, compassion may arise,
            thus creating the winds of impermanence — that was the Himalayan
            goddess&apos;s moral. When you buy our products, you are part of
            that story.
          </p>
        </div>

        <p className="mt-10 max-w-md txt-medium text-ui-fg-subtle">
          The first pieces were cut, dyed and sewn in the Kangra valley. Every
          one since has carried that quiet beginning.
        </p>

        <LocalizedClientLink
          href="/pages/about-us"
          className="group mt-10 inline-flex items-center gap-2 txt-small uppercase tracking-[0.18em] text-ui-fg-base"
        >
          Our story
          <span
            aria-hidden
            className="transition-transform duration-150 ease-in-out group-hover:translate-x-1"
          >
            →
          </span>
        </LocalizedClientLink>

        <p className="mt-16 txt-small uppercase tracking-[0.2em] text-neutral-900/35 small:tracking-[0.32em]">
          Kangra Valley · Himachal Pradesh
        </p>
      </div>
    </section>
  )
}

export default Genesis
