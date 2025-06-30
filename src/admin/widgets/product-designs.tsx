import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { Container, Text, Select } from "@medusajs/ui"
import { DetailWidgetProps } from "@medusajs/framework/types"
import { Spinner } from "../components/ui/ios-spinner"
import { useState } from "react"

const ProductDesignsWidget = ({ data }: DetailWidgetProps<string>) => {
  const [selectedDesign, setSelectedDesign] = useState<string | undefined>()

  // Dummy data for the designs
  const dummyDesigns = [
    { value: "design_1", label: "Floral Bloom" },
    { value: "design_2", label: "Geometric Maze" },
    { value: "design_3", label: "Abstract Waves" },
    { value: "design_4", label: "Vintage Paisley" },
  ]

  if (!data) {
    return <Spinner />
  }

  return (
    <Container className="divide-y p-0">
      <div className="px-6 py-4">
        <Text size="large" weight="plus" className="mb-1">
          Design
        </Text>
        <Text className="text-ui-fg-subtle">
          Select a design for pre-production.
        </Text>
      </div>
      <div className="px-6 py-4">
        <Select value={selectedDesign} onValueChange={setSelectedDesign}>
          <Select.Trigger>
            <Select.Value placeholder="Select a Design" />
          </Select.Trigger>
          <Select.Content>
            {dummyDesigns.map((item) => (
              <Select.Item key={item.value} value={item.value}>
                {item.label}
              </Select.Item>
            ))}
          </Select.Content>
        </Select>
      </div>
    </Container>
  )
}

export const config = defineWidgetConfig({
  zone: "product.details.side.before",
})

export default ProductDesignsWidget
