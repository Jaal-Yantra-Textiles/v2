import imageLoader from "@lib/util/image-loader"
import LocalizedClientLink from "@modules/common/components/localized-client-link"

/**
 * The founder's own photo from Dharamshala: evening light on the snow of the
 * Dhauladhar. Override per deploy with NEXT_PUBLIC_GENESIS_PHOTO_URL.
 */
const GENESIS_PHOTO_URL =
  process.env.NEXT_PUBLIC_GENESIS_PHOTO_URL ||
  "https://automatic.jaalyantra.com/automatica/IMG_0138-357d62ad975e71d4.jpg"
const GENESIS_PHOTO_ALT = "The snow peaks of the Dhauladhar above Dharamshala"

/** The photo fades in from the paper above and back into it below. */
const PHOTO_FADE =
  "linear-gradient(to bottom, transparent 0%, black 30%, black 74%, transparent 100%)"

/**
 * Origin band between the collection rails: the brand's first statement over
 * the real Dhauladhar. Just the photograph and the words — the peaks rise
 * close under the text, which sits on the paper-pale sky.
 */
const Genesis = ({ photoUrl = GENESIS_PHOTO_URL }: { photoUrl?: string }) => {
  const hasPhoto = Boolean(photoUrl)

  return (
    <section className="relative w-full overflow-hidden bg-gradient-to-b from-[#f7f4ef] via-[#f3ece1] to-[#ebe2d3]">
      {hasPhoto && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-[480px] small:h-[680px]"
          style={{ maskImage: PHOTO_FADE, WebkitMaskImage: PHOTO_FADE }}
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
            style={{
              filter: "saturate(0.8) sepia(0.12) contrast(0.94) brightness(1.06)",
            }}
          />
        </div>
      )}

      {/* A light paper glow behind the words keeps them crisp where the sky
          meets the top of the photo. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 46% 40% at 50% 38%, rgba(247,244,239,0.9) 0%, rgba(247,244,239,0.55) 55%, rgba(247,244,239,0) 100%)",
        }}
      />

      <div
        className={`content-container relative z-10 flex flex-col items-center text-center ${
          hasPhoto
            ? "pt-28 pb-[240px] small:pt-40 small:pb-[340px]"
            : "py-28 small:py-40"
        }`}
      >
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

        <p className="mt-16 txt-small uppercase tracking-[0.2em] text-neutral-900/55 small:tracking-[0.32em]">
          Kangra Valley · Himachal Pradesh
        </p>
      </div>
    </section>
  )
}

export default Genesis
