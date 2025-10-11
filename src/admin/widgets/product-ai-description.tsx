import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { Container, Text, Badge, Skeleton, Heading } from "@medusajs/ui"
import { DetailWidgetProps } from "@medusajs/framework/types"
import { Sparkles } from "@medusajs/icons"
import { useProduct, useUpdateProduct } from "../hooks/api/products"
import AIDescriptionChatModal from "../components/products/ai-description-chat-modal"
import { useState } from "react"
import { getThumbUrl, isImageUrl } from "../lib/media"

type ProductImage = {
  id: string
  url: string
  metadata?: Record<string, any>
}

type Design = {
  id: string
  name: string
  description?: string
  design_type?: string
  status?: string
  color_palette?: Array<{
    name: string
    value: string
    is_primary?: boolean
  }>
  tags?: string[]
  designer_notes?: any
  metadata?: Record<string, any>
}

type AdminProduct = {
  id: string
  title?: string
  description?: string
  images?: ProductImage[]
  designs?: Design[]
}

const ProductAIDescriptionWidget = ({ data }: DetailWidgetProps<AdminProduct>) => {
  const updateProductMutation = useUpdateProduct()
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [selectedImageUrl, setSelectedImageUrl] = useState<string | null>(null)

  const {
    product,
    isPending: isLoading,
    isError,
    error,
  } = useProduct(
    data.id!,
    {
      fields: "+images.*,+designs.*",
    },
  ) as {
    product?: AdminProduct
    isPending: boolean
    isError: boolean
    error?: Error
  }

  const currentImages = product?.images || []

  const handleImageSelect = (imageUrl: string) => {
    setSelectedImageUrl(imageUrl)
    setIsModalOpen(true)
  }

  const handleApplyDescription = async (title: string, description: string) => {
    try {
      await updateProductMutation.mutateAsync({
        productId: data.id!,
        payload: { 
          title,
          description,
        }
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
    <>
      <Container className="divide-y p-0">
        <div className="flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-x-4">
            <Heading level="h2">AI Description Generator</Heading>
            <Badge size="2xsmall" color="purple">
              <Sparkles className="mr-1" />
              AI Powered
            </Badge>
          </div>
        </div>

        <div className="px-6 py-4">
          {currentImages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 gap-y-3">
              <Text className="text-ui-fg-subtle">
                Add product images first to generate AI descriptions
              </Text>
            </div>
          ) : (
            <div className="flex flex-col gap-y-4">
              <Text size="small" className="text-ui-fg-subtle">
                Select an image to generate an AI-powered product description
              </Text>
              <div className="grid grid-cols-4 gap-3 md:grid-cols-6 lg:grid-cols-8">
                {currentImages.map((image) => {
                  // Use thumbnail for better performance
                  const thumbnailUrl = isImageUrl(image.url)
                    ? getThumbUrl(image.url, { width: 128, quality: 70, fit: "cover" })
                    : image.url
                  
                  const isSelected = selectedImageUrl === image.url
                  
                  return (
                    <button
                      key={image.id}
                      onClick={() => handleImageSelect(image.url)}
                      className={`relative h-20 w-20 overflow-hidden rounded-md border-2 transition-all hover:border-ui-fg-interactive ${
                        isSelected ? "border-ui-fg-interactive ring-2 ring-ui-fg-interactive" : "border-ui-border-base"
                      }`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img 
                        src={thumbnailUrl} 
                        alt="Product media" 
                        className="h-full w-full object-cover"
                        loading="lazy"
                      />
                      {isSelected && (
                        <div className="absolute inset-0 bg-ui-fg-interactive/10 flex items-center justify-center">
                          <Sparkles className="text-ui-fg-interactive" />
                        </div>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </Container>

      <AIDescriptionChatModal
        productId={data.id!}
        selectedImageUrl={selectedImageUrl}
        open={isModalOpen}
        onOpenChange={setIsModalOpen}
        onApply={handleApplyDescription}
        designs={product?.designs || []}
      />
    </>
  )
}

export const config = defineWidgetConfig({
  zone: "product.details.side.after",
})

export default ProductAIDescriptionWidget
