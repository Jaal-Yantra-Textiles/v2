import { buildPublicMediaUrl, listPublicMedia } from "@lib/data/media"
import HeroVisual from "./hero-visual"

const Hero = async () => {
  const isDev = process.env.NODE_ENV === "development"

  const images = isDev ? [] : await listPublicMedia({
    limit: 2,
    type: "image",
    random: true,
    offset: 0,
  }).catch(() => ({ medias: [], count: 0, total: 0 })).then(({ medias }) =>
    medias
      .map((m) => {
        const url = buildPublicMediaUrl(m.file_path)
        return url ? { url, alt: m.alt_text || m.title || m.filename || "" } : null
      })
      .filter(Boolean) as Array<{ url: string; alt: string }>
  )

  return (
    <HeroVisual
      imageUrl={images[0]?.url ?? null}
      alt={images[0]?.alt}
      floatingImageUrl={images[1]?.url ?? null}
    />
  )
}

export default Hero
