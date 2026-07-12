import { clx } from "@medusajs/ui"
import { HttpTypes } from "@medusajs/types"
import { getArtisanDetail } from "./index"

/**
 * The maker / provenance prose for an artisan product (#859 S3 / #862).
 *
 * Partner-authored free text describing who made the piece, where, and how.
 * Editorial artisan-info treatment: an uppercase eyebrow + prose under a hairline
 * divider — deliberately NOT the bordered "Fast delivery / Easy returns" shipping
 * card, so it reads as provenance, not a shipping trust badge. Titled
 * "Made by <partner>" when the owning partner's name is known (grafted
 * server-side as `maker_name`). Renders nothing when the product has no maker
 * story.
 */
export default function MakerStory({
  product,
  className,
}: {
  product: HttpTypes.StoreProduct
  className?: string
}) {
  const detail = getArtisanDetail(product)
  const story = detail?.maker_story?.trim()
  if (!story) return null

  const maker = detail?.maker_name?.trim()

  return (
    <div
      data-testid="maker-story"
      className={clx(
        "flex flex-col gap-y-3 border-t border-ui-border-base pt-6",
        className
      )}
    >
      <span className="text-xs uppercase tracking-wider text-ui-fg-muted">
        {maker ? `Made by ${maker}` : "The maker's story"}
      </span>
      <div className="flex flex-col gap-y-2">
        {story.split(/\n{2,}/).map((paragraph, i) => (
          <p
            key={i}
            className="text-small-regular max-w-sm text-ui-fg-subtle whitespace-pre-line"
          >
            {paragraph}
          </p>
        ))}
      </div>
    </div>
  )
}
