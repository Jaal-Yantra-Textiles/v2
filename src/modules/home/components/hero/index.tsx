import { ArrowDownMini } from "@medusajs/icons"
import { Button, Heading } from "@medusajs/ui"
import { buildPublicMediaUrl, listPublicMedia } from "@lib/data/media"

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
    <div className="h-[75vh] w-full border-b border-ui-border-base relative bg-gray-900 overflow-hidden">
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
      <div className="absolute inset-0 z-10 flex flex-col justify-center items-center text-center small:p-32 gap-6">
        <span>
          <Heading
            level="h1"
            className="text-6xl font-bold bg-gradient-to-r from-violet-600 to-rose-500 bg-clip-text text-transparent"
          >
            Cici Label
          </Heading>
          <Heading
            level="h2"
            className="text-2xl leading-9 font-medium"
          >
            <span className="bg-gradient-to-r from-pink-300 via-purple-300 to-indigo-300 bg-clip-text text-transparent">With Care, </span>
            <span className="bg-gradient-to-r from-green-200 via-teal-300 to-blue-400 bg-clip-text text-transparent">Through Inversion: </span>
            <span className="bg-gradient-to-r from-yellow-200 via-orange-300 to-red-400 bg-clip-text text-transparent">Compassion Meets Impermanence</span>
          </Heading>
        </span>
        <a
          href="/design"
        >
          <Button variant="secondary">
            Design your first piece
          </Button>
        </a>

        <a
          href="#shop"
          className="absolute bottom-8 left-1/2 -translate-x-1/2 inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/10 px-4 py-2 text-sm font-medium text-white backdrop-blur-sm shadow-sm transition-colors hover:bg-white/15 focus:outline-none focus:ring-2 focus:ring-white/25"
        >
          <span>Scroll more if you want to buy what we made</span>
          <span className="inline-flex h-8 w-12 items-center justify-center rounded-full bg-white/10">
            <ArrowDownMini className="h-5 w-5" color="currentColor" />
          </span>
        </a>
      </div>
    </div>
  )
}

export default Hero
