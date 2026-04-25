"use client"

import { Text } from "@medusajs/ui"
import { useMemo, useState } from "react"

type ProductDescriptionProps = {
  description?: string | null
}

const ProductDescription = ({ description }: ProductDescriptionProps) => {
  const normalized = description?.trim() || ""

  const { preview, remainder } = useMemo(() => {
    if (!normalized) {
      return { preview: "", remainder: "" }
    }
    const dotIndex = normalized.indexOf(".")
    if (dotIndex === -1 || dotIndex === normalized.length - 1) {
      return { preview: normalized, remainder: "" }
    }
    const firstSentence = normalized.slice(0, dotIndex + 1)
    const rest = normalized.slice(dotIndex + 1).trimStart()
    return { preview: firstSentence, remainder: rest }
  }, [normalized])

  const [expanded, setExpanded] = useState(false)
  const hasMore = Boolean(remainder)

  if (!normalized) {
    return null
  }

  return (
    <div>
      <Text
        className="text-medium text-ui-fg-subtle whitespace-pre-line"
        data-testid="product-description"
      >
        {expanded || !hasMore ? normalized : preview}
      </Text>
      {hasMore && (
        <button
          type="button"
          className="mt-2 text-sm text-ui-fg-interactive hover:text-ui-fg-base transition-colors"
          onClick={() => setExpanded((prev) => !prev)}
          aria-expanded={expanded}
        >
          {expanded ? "Show less" : "Read more"}
        </button>
      )}
    </div>
  )
}

export default ProductDescription
