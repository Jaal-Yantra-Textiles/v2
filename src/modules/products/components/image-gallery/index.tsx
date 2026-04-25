"use client"

import { HttpTypes } from "@medusajs/types"
import { Container } from "@medusajs/ui"
import Image from "next/image"
import { useState } from "react"

import { isUnoptimizableImageUrl } from "@lib/util/image-optimizer"

const GalleryImage = ({ image, index }: { image: HttpTypes.StoreProductImage; index: number }) => {
  const [isLoaded, setIsLoaded] = useState(false)

  return (
    <Container
      className="relative aspect-[29/34] w-full overflow-hidden bg-ui-bg-subtle"
      id={image.id}
    >
      {!isLoaded && (
        <div className="absolute inset-0 bg-gray-100 animate-pulse z-10" />
      )}
      {!!image.url && (
        <Image
          src={image.url}
          priority={index <= 2 ? true : false}
          className="absolute inset-0 rounded-rounded object-cover"
          alt={`Product image ${index + 1}`}
          fill
          sizes="(max-width: 576px) 280px, (max-width: 768px) 360px, (max-width: 992px) 480px, 800px"
          unoptimized={isUnoptimizableImageUrl(image.url)}
          onLoad={() => setIsLoaded(true)}
        />
      )}
    </Container>
  )
}

type ImageGalleryProps = {
  images: HttpTypes.StoreProductImage[]
}

const ImageGallery = ({ images }: ImageGalleryProps) => {
  return (
    <div className="flex items-start relative">
      <div className="flex flex-col flex-1 small:mx-16 gap-y-4">
        {images.map((image, index) => {
          return (
            <GalleryImage key={image.id} image={image} index={index} />
          )
        })}
      </div>
    </div>
  )
}

export default ImageGallery
