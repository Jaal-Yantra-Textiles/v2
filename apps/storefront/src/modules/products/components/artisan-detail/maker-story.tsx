import { clx } from "@medusajs/ui"
import { User } from "@medusajs/icons"
import { HttpTypes } from "@medusajs/types"
import { getArtisanDetail } from "./index"

/**
 * The maker / provenance prose for an artisan product (#859 S3 / #862).
 *
 * Partner-authored free text describing who made the piece, where, and how.
 * Styled after the "Fast delivery / Easy returns" inline shipping blocks (icon +
 * bold label + subtle copy) so it reads as a native trust signal alongside the
 * made-to-order notice. Titled "Made by <partner>" when the owning partner's
 * name is known (grafted server-side as `maker_name`). Renders nothing when the
 * product has no maker story.
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
        "text-small-regular flex flex-col gap-y-4 rounded-lg border border-ui-border-base bg-ui-bg-subtle p-4",
        className
      )}
    >
      <div className="flex items-start gap-x-2">
        <User className="mt-0.5 flex-shrink-0 text-ui-fg-subtle" />
        <div>
          <span className="font-semibold">
            {maker ? `Made by ${maker}` : "The maker's story"}
          </span>
          <div className="mt-1 flex flex-col gap-y-2">
            {story.split(/\n{2,}/).map((paragraph, i) => (
              <p
                key={i}
                className="max-w-sm text-ui-fg-subtle whitespace-pre-line"
              >
                {paragraph}
              </p>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
