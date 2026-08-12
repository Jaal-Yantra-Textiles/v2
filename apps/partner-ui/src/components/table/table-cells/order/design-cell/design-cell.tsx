import { Thumbnail } from "../../../../common/thumbnail"
import { PlaceholderCell } from "../../common/placeholder-cell"

/** One design of a work-order, as summarised by `GET /partners/orders`. */
export type OrderDesignSummary = {
  id: string
  name?: string | null
  thumbnail?: string | null
}

/**
 * The design column of the Design Orders table.
 *
 * Every other column on that table is a number, a date, or a badge — nothing
 * says WHICH garment the row is. This shows the design's picture (its flagged
 * media thumbnail, else its first media file, else the moodboard's first
 * reference image — resolved server-side) next to its name, which is what a
 * partner actually recognises a job by.
 *
 * A COLLATED order (#826) holds many designs: the first design's picture leads
 * and the rest are counted, rather than growing the row.
 */
export const DesignCell = ({
  designs,
}: {
  designs?: OrderDesignSummary[] | null
}) => {
  if (!designs?.length) {
    return <PlaceholderCell />
  }

  const [first, ...rest] = designs
  const label = first.name || "Untitled design"

  return (
    <div className="flex h-full w-full max-w-[250px] items-center gap-x-3 overflow-hidden">
      <div className="w-fit flex-shrink-0">
        <Thumbnail src={first.thumbnail} alt={label} />
      </div>
      <span title={label} className="truncate">
        {label}
      </span>
      {rest.length > 0 && (
        <span className="text-ui-fg-muted txt-compact-small flex-shrink-0">
          +{rest.length}
        </span>
      )}
    </div>
  )
}

export const DesignHeader = () => {
  return (
    <div className="flex h-full w-full items-center">
      <span className="truncate">Design</span>
    </div>
  )
}
