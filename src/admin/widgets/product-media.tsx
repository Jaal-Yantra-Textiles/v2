import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { Container, Text, Badge, Skeleton, Heading } from "@medusajs/ui"
import { DetailWidgetProps } from "@medusajs/framework/types"
import { XMark, Plus } from "@medusajs/icons"
import { useProduct, useUpdateProduct } from "../hooks/api/products"
import ProductMediaModal from "../components/media/product-media-modal"
import { ActionMenu } from "../components/common/action-menu"
import { useState } from "react"

type ProductImage = {
  id: string
  url: string
  metadata?: Record<string, any>
}

type AdminProduct = {
  id: string
  images?: ProductImage[]
}

const ProductMediaWidget = ({ data }: DetailWidgetProps<AdminProduct>) => {
  const updateProductMutation = useUpdateProduct()
  const [isModalOpen, setIsModalOpen] = useState(false)

  const {
    product,
    isPending: isLoading,
    isError,
    error,
  } = useProduct(
    data.id!,
    {
      fields: "+images.*",
    },
  ) as {
    product?: AdminProduct
    isPending: boolean
    isError: boolean
    error?: Error
  }

  const currentImages = product?.images || []

  const handleSaveMedia = async (urls: string[]) => {
    // Convert URLs to the format expected by MedusaJS
    const imagePayload = urls.map(url => ({ url }))

    try {
      await updateProductMutation.mutateAsync({
        productId: data.id!,
        payload: { images: imagePayload }
      })
    } catch (error) {
      // Error handling is done in the mutation
    }
  }

  const handleRemoveImage = async (imageUrl: string) => {
    const updatedImages = currentImages
      .filter(img => img.url !== imageUrl)
      .map(img => ({ url: img.url }))

    try {
      await updateProductMutation.mutateAsync({
        productId: data.id!,
        payload: { images: updatedImages }
      })
    } catch (error) {
      // Error handling is done in the mutation
    }
  }

  if (isLoading) {
    return (
      <Skeleton className="h-32"></Skeleton>
    )
  }

  if (isError) {
    return (
      <Container className="divide-y p-0">
        <div className="flex items-center justify-center h-40">
          <Text className="text-ui-fg-error">{error?.message || "An error occurred"}</Text>
        </div>
      </Container>
    )
  }

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-x-4">
          <Heading level="h2">Product Media</Heading>
          {currentImages.length > 0 && (
            <Badge size="2xsmall" color="blue">
              {currentImages.length} image{currentImages.length !== 1 ? 's' : ''}
            </Badge>
          )}
        </div>
        <ActionMenu
          groups={[
            {
              actions: [
                {
                  label: "Add Media",
                  icon: <Plus />,
                  onClick: () => setIsModalOpen(true),
                },
              ],
            },
          ]}
        />
      </div>

      <ProductMediaModal 
        open={isModalOpen}
        onOpenChange={setIsModalOpen}
        onSave={handleSaveMedia} 
        initialUrls={currentImages.map(img => img.url)}
      />

      <div className="p-6">
        {currentImages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 gap-y-3">
            <Text className="text-ui-fg-subtle">Choose existing media</Text>
          </div>
        ) : (
          <div className="grid grid-cols-4 gap-3 md:grid-cols-6 lg:grid-cols-8">
            {currentImages.map((image) => (
              <div key={image.id} className="relative h-20 w-20 overflow-hidden rounded-md border">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img 
                  src={image.url} 
                  alt="Product media" 
                  className="h-full w-full object-cover" 
                />
                <div className="absolute top-1 right-1 flex items-center justify-center rounded-full bg-white/80 p-0.5 hover:bg-white">
                  <button
                    onClick={() => handleRemoveImage(image.url)}
                    className="text-ui-fg-muted hover:text-ui-fg-subtle cursor-pointer"
                    disabled={updateProductMutation.isPending}
                  >
                    <XMark className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Container>
  )
}

export const config = defineWidgetConfig({
  zone: "product.details.side.after",
})

export default ProductMediaWidget
