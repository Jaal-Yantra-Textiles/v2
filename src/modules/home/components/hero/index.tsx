import { Button, Heading } from "@medusajs/ui"
import { buildPublicMediaUrl, listPublicMedia } from "@lib/data/media"
import HeroSubheading from "./hero-subheading"
import HeroScrollButton from "./hero-scroll-button"
import ThreeScene from "./three-scene"

const Hero = async () => {
  const isDev = process.env.NODE_ENV === "development"

  const heroImages: Array<{ id: string; url: string; alt: string }> = isDev ? [] : await listPublicMedia({
    limit: 18,
    type: "image",
    random: true,
    offset: 0,
  }).catch(() => ({ medias: [], count: 0, total: 0 })).then(({ medias }) =>
    medias
      .map((m) => ({
        id: m.id,
        url: buildPublicMediaUrl(m.file_path),
        alt: m.alt_text || m.title || m.filename || "",
      }))
      .filter((m) => Boolean(m.url))
  )

  return (
    <div className="min-h-screen sm:h-[75vh] w-full border-b border-ui-border-base relative bg-gray-900 overflow-hidden">

      {/* 3D Scene Backdrop */}
      {heroImages.length > 0 && (
        <ThreeScene images={heroImages} />
      )}

      <div className="absolute inset-0 z-0 bg-gradient-to-b from-gray-900/30 via-gray-900/60 to-gray-900 pointer-events-none" />

      <div className="absolute inset-0 z-10 flex flex-col justify-center items-center text-center px-6 py-16 small:p-32 gap-8 pointer-events-none">
        {/* We use pointer-events-auto on interactive children */}
        <div className="flex w-full max-w-3xl flex-col items-center gap-6 rounded-[32px] bg-gray-900/40 px-6 py-8 shadow-2xl backdrop-blur-sm small:px-8 small:py-10 pointer-events-auto border border-white/10">
          <div className="w-full space-y-4">
            <Heading
              level="h1"
              className="text-6xl font-bold bg-gradient-to-r from-violet-400 to-rose-400 bg-clip-text text-transparent drop-shadow-md"
            >
              Cici Label
            </Heading>
            <HeroSubheading />
          </div>
          <a
            href="/design"
            className="pointer-events-auto"
          >
            <Button variant="secondary" className="px-8 py-3 text-lg shadow-lg hover:shadow-violet-500/20 transition-all">
              Design your first piece
            </Button>
          </a>
        </div>

        <div className="pointer-events-auto">
          <HeroScrollButton targetId="shop" />
        </div>
      </div>
    </div>
  )
}

export default Hero
