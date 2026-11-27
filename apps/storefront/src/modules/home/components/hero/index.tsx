import HeroVisual from "./hero-visual"
import type { HomeMediaImage } from "../home-media"

type HeroProps = {
  /**
   * The hero painting, resolved once on the home page by `getHomeMedia()`
   * so the media grid below can draw from the same batch without ever
   * repeating it. `null` renders the gradient fallback.
   */
  image?: HomeMediaImage | null
}

/**
 * Painting-backed hero. The media fetch lives on the page (not here) so the
 * hero and the homepage media grid share a single, non-repeating draw from
 * the public media API.
 */
const Hero = ({ image }: HeroProps) => (
  <HeroVisual
    imageUrl={image?.url ?? null}
    alt={image?.alt}
    credit={image?.credit ?? null}
  />
)

export default Hero
