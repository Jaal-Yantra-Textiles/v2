import { Container, clx } from "@medusajs/ui"
import Image from "next/image"
import React from "react"

import PlaceholderImage from "@modules/common/icons/placeholder-image"

type ThumbnailProps = {
  thumbnail?: string | null
  // TODO: Fix image typings
  images?: any[] | null
  size?: "small" | "medium" | "large" | "full" | "square"
  isFeatured?: boolean
  className?: string
  "data-testid"?: string
}

const Thumbnail: React.FC<ThumbnailProps> = ({
  thumbnail,
  images,
  size = "small",
  isFeatured,
  className,
  "data-testid": dataTestid,
}) => {
  const initialImage = thumbnail || images?.[0]?.url
  const secondaryImage = images?.[1]?.url

  return (
    <Container
      className={clx(
        "relative w-full overflow-hidden bg-transparent shadow-none transition-shadow ease-in-out duration-150",
        className,
        {
          "aspect-[11/14]": isFeatured,
          "aspect-[9/16]": !isFeatured && size !== "square",
          "aspect-[1/1]": size === "square",
          "w-[180px]": size === "small",
          "w-[290px]": size === "medium",
          "w-[440px]": size === "large",
          "w-full": size === "full",
        }
      )}
      data-testid={dataTestid}
    >
      <div className="absolute inset-0 overflow-hidden rounded-lg bg-gray-100">
        <ImageOrPlaceholder
          image={initialImage}
          size={size}
          className={clx(
            "absolute inset-0 object-cover object-center transition-all duration-500 ease-in-out transform",
            // Scale up on hover
            "group-hover:scale-105",
            // Fade out if secondary image exists
            secondaryImage && "group-hover:opacity-0"
          )}
        />

        {secondaryImage && (
          <ImageOrPlaceholder
            image={secondaryImage}
            size={size}
            className={clx(
              "absolute inset-0 object-cover object-center transition-all duration-500 ease-in-out transform scale-105 opacity-0",
              // Fade in on hover
              "group-hover:opacity-100"
            )}
          />
        )}
      </div>
    </Container>
  )
}

const ImageOrPlaceholder = ({
  image,
  size,
  className,
}: Pick<ThumbnailProps, "size"> & { image?: string, className?: string }) => {
  return image ? (
    <Image
      src={image}
      alt="Thumbnail"
      className={className}
      draggable={false}
      quality={50}
      sizes="(max-width: 576px) 280px, (max-width: 768px) 360px, (max-width: 992px) 480px, 800px"
      fill
    />
  ) : (
    <div className="w-full h-full absolute inset-0 flex items-center justify-center bg-gray-100">
      <PlaceholderImage size={size === "small" ? 16 : 24} />
    </div>
  )
}

export default Thumbnail
