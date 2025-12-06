import { Select, Switch, Text, Heading, Textarea, Badge } from "@medusajs/ui"
import { Control, useWatch } from "react-hook-form"
import { Form } from "../../common/form"
import { CreateSocialPostForm, ContentRule } from "./types"
import { useMemo } from "react"

interface CampaignSettingsStepProps {
  control: Control<CreateSocialPostForm>
  platformName: string
  defaultContentRule?: ContentRule
  products?: Array<{ id: string; title: string; thumbnail?: string }>
}

// Default content rule templates
const DEFAULT_TEMPLATES: Record<string, string> = {
  instagram: `✨ {{title}}

{{description}}

{{#if design_name}}🎨 Design: {{design_name}}{{/if}}

{{hashtags}}`,
  facebook: `{{title}}

{{description}}

{{#if price}}💰 {{price}}{{/if}}

{{#if url}}🔗 {{url}}{{/if}}`,
  x: `{{title}}

{{description}}

{{hashtags}}`,
  twitter: `{{title}}

{{description}}

{{hashtags}}`,
  fbinsta: `✨ {{title}}

{{description}}

{{#if design_name}}🎨 Design: {{design_name}}{{/if}}

{{hashtags}}`,
}

export const CampaignSettingsStep = ({
  control,
  platformName,
  defaultContentRule,
  products = [],
}: CampaignSettingsStepProps) => {
  const selectedProductIds = useWatch({ control, name: "product_ids" }) || []
  const customTemplate = useWatch({ control, name: "custom_caption_template" })
  const intervalHours = useWatch({ control, name: "interval_hours" }) || 24
  const startAt = useWatch({ control, name: "start_at" })
  
  const platform = platformName.toLowerCase()
  const defaultTemplate = defaultContentRule?.caption_template || DEFAULT_TEMPLATES[platform] || DEFAULT_TEMPLATES.instagram
  
  // Calculate schedule preview
  const schedulePreview = useMemo(() => {
    const startTime = startAt ? new Date(startAt) : new Date()
    const intervalMs = intervalHours * 60 * 60 * 1000
    
    return selectedProductIds.slice(0, 5).map((productId: string, index: number) => {
      const product = products.find(p => p.id === productId)
      const scheduledAt = new Date(startTime.getTime() + (index * intervalMs))
      return {
        productId,
        productTitle: product?.title || productId.slice(0, 8) + "...",
        thumbnail: product?.thumbnail,
        scheduledAt,
      }
    })
  }, [selectedProductIds, products, intervalHours, startAt])
  
  return (
    <div className="flex h-full overflow-hidden">
      {/* Left Side - Settings */}
      <div className="flex-1 overflow-y-auto p-16">
        <div className="mx-auto w-full max-w-[600px] flex flex-col gap-y-8">
          <div>
            <Heading level="h2">Campaign Settings</Heading>
            <Text size="small" className="text-ui-fg-subtle mt-2">
              Configure how your products will be transformed into social posts
            </Text>
          </div>

          {/* Caption Template */}
          <div className="border rounded-lg p-4 space-y-4">
            <div>
              <Heading level="h3" className="text-base">Caption Template</Heading>
              <Text size="small" className="text-ui-fg-subtle mt-1">
                Define how product data is formatted into post captions
              </Text>
            </div>
            
            <div className="bg-ui-bg-subtle p-3 rounded text-xs font-mono">
              <Text size="xsmall" className="text-ui-fg-subtle mb-2 block">
                Available variables:
              </Text>
              <div className="flex flex-wrap gap-2">
                <Badge color="blue">{"{{title}}"}</Badge>
                <Badge color="blue">{"{{description}}"}</Badge>
                <Badge color="blue">{"{{price}}"}</Badge>
                <Badge color="blue">{"{{design_name}}"}</Badge>
                <Badge color="blue">{"{{hashtags}}"}</Badge>
                <Badge color="blue">{"{{url}}"}</Badge>
              </div>
              <Text size="xsmall" className="text-ui-fg-subtle mt-2 block">
                Conditionals: {"{{#if variable}}...{{/if}}"}
              </Text>
            </div>
            
            <Form.Field
              control={control}
              name="custom_caption_template"
              render={({ field: { value, onChange } }) => (
                <Form.Item>
                  <Form.Control>
                    <Textarea
                      value={value || defaultTemplate}
                      onChange={onChange}
                      rows={8}
                      className="font-mono text-sm"
                      placeholder={defaultTemplate}
                    />
                  </Form.Control>
                  <Form.ErrorMessage />
                </Form.Item>
              )}
            />
          </div>

          {/* Hashtag Strategy */}
          <Form.Field
            control={control}
            name="content_rule.hashtag_strategy"
            render={({ field: { value, onChange } }) => (
              <Form.Item>
                <Form.Label>Hashtag Strategy</Form.Label>
                <Form.Control>
                  <Select value={value || "from_product"} onValueChange={onChange}>
                    <Select.Trigger>
                      <Select.Value placeholder="Select strategy" />
                    </Select.Trigger>
                    <Select.Content>
                      <Select.Item value="from_product">
                        From Product Tags
                      </Select.Item>
                      <Select.Item value="from_design">
                        From Linked Design
                      </Select.Item>
                      <Select.Item value="custom">
                        Custom Hashtags
                      </Select.Item>
                      <Select.Item value="none">
                        No Hashtags
                      </Select.Item>
                    </Select.Content>
                  </Select>
                </Form.Control>
                <Form.Hint>
                  How hashtags are generated for each post
                </Form.Hint>
                <Form.ErrorMessage />
              </Form.Item>
            )}
          />

          {/* Image Selection */}
          <Form.Field
            control={control}
            name="content_rule.image_selection"
            render={({ field: { value, onChange } }) => (
              <Form.Item>
                <Form.Label>Image Selection</Form.Label>
                <Form.Control>
                  <Select value={value || "all"} onValueChange={onChange}>
                    <Select.Trigger>
                      <Select.Value placeholder="Select strategy" />
                    </Select.Trigger>
                    <Select.Content>
                      <Select.Item value="all">
                        All Images (carousel)
                      </Select.Item>
                      <Select.Item value="thumbnail">
                        Thumbnail Only
                      </Select.Item>
                      <Select.Item value="first">
                        First Image
                      </Select.Item>
                      <Select.Item value="featured">
                        Featured/Thumbnail
                      </Select.Item>
                    </Select.Content>
                  </Select>
                </Form.Control>
                <Form.Hint>
                  Which product images to include in posts
                </Form.Hint>
                <Form.ErrorMessage />
              </Form.Item>
            )}
          />

          {/* Include Options */}
          <div className="space-y-4">
            <Form.Field
              control={control}
              name="content_rule.include_price"
              render={({ field: { value, onChange } }) => (
                <Form.Item>
                  <div className="flex items-center justify-between">
                    <div>
                      <Form.Label className="mb-0">Include Price</Form.Label>
                      <Text size="xsmall" className="text-ui-fg-subtle">
                        Show product price in the caption
                      </Text>
                    </div>
                    <Switch checked={!!value} onCheckedChange={onChange} />
                  </div>
                </Form.Item>
              )}
            />

            <Form.Field
              control={control}
              name="content_rule.include_design"
              render={({ field: { value, onChange } }) => (
                <Form.Item>
                  <div className="flex items-center justify-between">
                    <div>
                      <Form.Label className="mb-0">Include Design Info</Form.Label>
                      <Text size="xsmall" className="text-ui-fg-subtle">
                        Show linked design name in the caption
                      </Text>
                    </div>
                    <Switch checked={value !== false} onCheckedChange={onChange} />
                  </div>
                </Form.Item>
              )}
            />
          </div>
        </div>
      </div>

      {/* Right Side - Schedule Preview */}
      <div className="w-[400px] border-l bg-ui-bg-subtle overflow-y-auto p-6">
        <div className="space-y-4">
          <div>
            <Heading level="h3" className="text-base">Schedule Preview</Heading>
            <Text size="small" className="text-ui-fg-subtle mt-1">
              {selectedProductIds.length} products • Every {intervalHours}h
            </Text>
          </div>

          <div className="space-y-3">
            {schedulePreview.map((item, index) => (
              <div 
                key={item.productId}
                className="flex items-center gap-3 p-3 bg-ui-bg-base rounded-lg border"
              >
                <div className="w-8 h-8 rounded-full bg-ui-bg-subtle flex items-center justify-center text-sm font-medium">
                  {index + 1}
                </div>
                {item.thumbnail && (
                  <img 
                    src={item.thumbnail} 
                    alt={item.productTitle}
                    className="w-12 h-12 rounded object-cover"
                  />
                )}
                <div className="flex-1 min-w-0">
                  <Text className="font-medium truncate text-sm">
                    {item.productTitle}
                  </Text>
                  <Text size="xsmall" className="text-ui-fg-subtle">
                    {item.scheduledAt.toLocaleDateString()} at {item.scheduledAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </Text>
                </div>
              </div>
            ))}
            
            {selectedProductIds.length > 5 && (
              <Text size="small" className="text-ui-fg-subtle text-center py-2">
                + {selectedProductIds.length - 5} more products
              </Text>
            )}
            
            {selectedProductIds.length === 0 && (
              <div className="text-center py-8 text-ui-fg-subtle">
                <Text>No products selected</Text>
                <Text size="small">Go back to select products</Text>
              </div>
            )}
          </div>

          {/* Template Preview */}
          <div className="mt-6">
            <Heading level="h3" className="text-base mb-3">Caption Preview</Heading>
            <div className="bg-ui-bg-base p-4 rounded-lg border">
              <pre className="whitespace-pre-wrap text-sm font-sans">
                {(customTemplate || defaultTemplate)
                  .replace(/\{\{title\}\}/g, "Product Title")
                  .replace(/\{\{description\}\}/g, "Product description will appear here...")
                  .replace(/\{\{price\}\}/g, "$99.00")
                  .replace(/\{\{design_name\}\}/g, "Design Name")
                  .replace(/\{\{hashtags\}\}/g, "#fashion #style #new")
                  .replace(/\{\{url\}\}/g, "https://store.com/product")
                  .replace(/\{\{#if\s+\w+\}\}/g, "")
                  .replace(/\{\{\/if\}\}/g, "")
                }
              </pre>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
