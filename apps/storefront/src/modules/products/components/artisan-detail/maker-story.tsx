import { Heading, Text } from "@medusajs/ui"
import { HttpTypes } from "@medusajs/types"
import { getArtisanDetail } from "./index"

/**
 * The maker / provenance prose for an artisan product (#859 S3 / #862).
 *
 * Partner-authored free text describing who made the piece, where, and how.
 * Rendered on the product page under the product info. Renders nothing when
 * the product has no maker story.
 */
export default function MakerStory({
  product,
}: {
  product: HttpTypes.StoreProduct
}) {
  const detail = getArtisanDetail(product)
  const story = detail?.maker_story?.trim()
  if (!story) return null

  return (
    <div
      data-testid="maker-story"
      className="flex flex-col gap-y-2 border-t border-ui-border-base pt-6"
    >
      <Heading level="h3" className="text-base-semi">
        The maker&apos;s story
      </Heading>
      {story.split(/\n{2,}/).map((paragraph, i) => (
        <Text
          key={i}
          size="small"
          className="text-ui-fg-subtle whitespace-pre-line"
        >
          {paragraph}
        </Text>
      ))}
    </div>
  )
}
