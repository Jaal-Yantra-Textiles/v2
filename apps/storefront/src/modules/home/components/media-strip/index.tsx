import imageLoader from "@lib/util/image-loader"
import LocalizedClientLink from "@modules/common/components/localized-client-link"
import type { HomeMediaImage } from "../home-media"

type HomeMediaStripProps = {
  /**
   * The four images after the hero's pick, already de-duped and resolved by
   * `getHomeMedia()` on the page — no second media fetch, so nothing here
   * can repeat the hero.
   */
  images: HomeMediaImage[]
}

const HomeMediaStrip = ({ images }: HomeMediaStripProps) => {
  if (!images.length) {
    return null
  }

  return (
    <section className="w-full py-16 small:py-24">
      <div className="content-container grid grid-cols-1 items-center gap-10 small:grid-cols-2 small:gap-16">
        <ul className="grid grid-cols-2 gap-2 small:gap-3">
          {images.map((image) => (
            <li key={image.id}>
              <LocalizedClientLink href="/gallery" className="group block">
                <div className="relative aspect-square w-full overflow-hidden bg-gray-100">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={imageLoader({ src: image.url, width: 800 })}
                    srcSet={`${imageLoader({ src: image.url, width: 400 })} 400w, ${imageLoader({ src: image.url, width: 800 })} 800w, ${imageLoader({ src: image.url, width: 1200 })} 1200w`}
                    sizes="(max-width: 576px) 50vw, 30vw"
                    alt={image.alt}
                    loading="lazy"
                    draggable={false}
                    className="h-full w-full object-cover transition-transform duration-500 ease-in-out group-hover:scale-105"
                  />
                </div>
              </LocalizedClientLink>
            </li>
          ))}
        </ul>

        <div className="max-w-md">
          <h2 className="font-serif text-3xl tracking-tight text-neutral-900 text-balance small:text-5xl">
            Pieces from our world
          </h2>
          <p className="mt-5 txt-medium text-ui-fg-subtle">
            Handloom, natural dyes, and the quiet hours in between — a look at
            the cloth, the hands, and the places behind Cici Label.
          </p>
          <LocalizedClientLink
            href="/gallery"
            className="group mt-8 inline-flex items-center gap-2 txt-small uppercase tracking-[0.18em] text-ui-fg-base"
          >
            View gallery
            <span
              aria-hidden
              className="transition-transform duration-150 ease-in-out group-hover:translate-x-1"
            >
              →
            </span>
          </LocalizedClientLink>
        </div>
      </div>
    </section>
  )
}

export default HomeMediaStrip
