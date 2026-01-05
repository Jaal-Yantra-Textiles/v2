import { Button, Heading } from "@medusajs/ui"
import { buildPublicMediaUrl, listPublicMedia } from "@lib/data/media"
import HeroSubheading from "./hero-subheading"
import HeroScrollButton from "./hero-scroll-button"



const Hero = async () => {
  const { medias } = await listPublicMedia({
    limit: 18,
    type: "image",
    random: true,
    seed: "home-mosaic",
    offset: 0,
  }).catch(() => ({ medias: [], count: 0, total: 0 }))

  const heroImages = medias
    .map((m) => ({
      id: m.id,
      url: buildPublicMediaUrl(m.file_path),
      alt: m.alt_text || m.title || m.filename || "",
    }))
    .filter((m) => Boolean(m.url)) as Array<{ id: string; url: string; alt: string }>

  return (
    <div className="min-h-screen sm:h-[75vh] w-full border-b border-ui-border-base relative bg-gray-900 overflow-hidden">
      {/* Media mosaic backdrop */}
      {heroImages.length > 0 && (
        <div className="absolute inset-0 z-0">
          <div className="grid h-full w-full grid-cols-3 gap-2 p-6 opacity-50 sm:grid-cols-4 lg:grid-cols-6">
            {heroImages.map((img) => (
              <div
                key={img.id}
                className="relative aspect-square overflow-hidden rounded-lg bg-gray-800"
              >
                <img
                  src={img.url}
                  alt={img.alt}
                  className="h-full w-full object-cover"
                  loading="lazy"
                  decoding="async"
                />
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="absolute inset-0 z-0 bg-gradient-to-b from-gray-900/55 via-gray-900/65 to-gray-900" />
      <div className="absolute inset-0 z-0 bg-[radial-gradient(ellipse_at_bottom,_rgba(139,92,246,0.15)_0%,_transparent_60%)] animate-breathing" />
      <div className="absolute inset-0 z-10 flex flex-col justify-center items-center text-center px-6 py-16 small:p-32 gap-8">
        <div className="flex w-full max-w-3xl flex-col items-center gap-6 rounded-[32px] bg-gray-900/70 px-6 py-8 shadow-2xl backdrop-blur small:px-8 small:py-10">
          <div className="w-full space-y-4">
            <Heading
              level="h1"
              className="text-6xl font-bold bg-gradient-to-r from-violet-600 to-rose-500 bg-clip-text text-transparent"
            >
              Cici Label
            </Heading>
            <HeroSubheading />
          </div>
          <a
            href="/design"
          >
            <Button variant="secondary">
              Design your first piece
            </Button>
          </a>
        </div>

        <HeroScrollButton targetId="shop" />
      </div>
    </div>
  )
}

export default Hero
