import { Input, Select, Switch, Text, Badge, DatePicker } from "@medusajs/ui"
import { Control, useWatch } from "react-hook-form"
import { Form } from "../../common/form"
import { CreateSocialPostForm } from "./types"
import { useMemo, useState } from "react"

interface BasicStepProps {
  control: Control<CreateSocialPostForm>
  platforms: Array<{ id: string; name: string }>
  isPlatformsLoading: boolean
  onPlatformChange: (platformId: string, platformName: string) => void
  products?: Array<{ id: string; title: string; thumbnail?: string }>
  isProductsLoading?: boolean
  onCampaignModeChange?: (isCampaign: boolean) => void
}

export const SocialPostBasicStep = ({ 
  control, 
  platforms, 
  isPlatformsLoading,
  onPlatformChange,
  products = [],
  isProductsLoading = false,
  onCampaignModeChange,
}: BasicStepProps) => {
  const isCampaign = useWatch({ control, name: "is_campaign" })
  const [productSearch, setProductSearch] = useState("")
  
  // Filter products based on search
  const filteredProducts = useMemo(() => {
    if (!productSearch) return products
    const search = productSearch.toLowerCase()
    return products.filter(p => 
      p.title.toLowerCase().includes(search) || 
      p.id.toLowerCase().includes(search)
    )
  }, [products, productSearch])
  
  return (
    <div className="flex flex-col items-center p-16">
      <div className="flex w-full max-w-[720px] flex-col gap-y-8">
        <div>
          <h2 className="text-xl font-semibold">Basic Information</h2>
          <p className="text-sm text-ui-fg-subtle mt-2">
            {isCampaign 
              ? "Set up a campaign to automatically publish multiple products on a schedule."
              : "Start by giving your post a name and selecting the platform."
            }
          </p>
        </div>

        {/* Campaign Mode Switch */}
        <Form.Field
          control={control}
          name="is_campaign"
          render={({ field: { value, onChange } }) => (
            <Form.Item>
              <div className="flex items-center justify-between p-4 border rounded-lg bg-ui-bg-subtle">
                <div>
                  <Form.Label className="mb-0">Campaign Mode</Form.Label>
                  <Text size="small" className="text-ui-fg-subtle">
                    Schedule multiple products to be posted automatically
                  </Text>
                </div>
                <Switch 
                  checked={!!value} 
                  onCheckedChange={(checked) => {
                    onChange(checked)
                    onCampaignModeChange?.(checked)
                  }} 
                />
              </div>
            </Form.Item>
          )}
        />

        <Form.Field
          control={control}
          name="name"
          render={({ field }) => (
            <Form.Item>
              <Form.Label>{isCampaign ? "Campaign Name" : "Post Name"}</Form.Label>
              <Form.Control>
                <Input 
                  {...field} 
                  placeholder={isCampaign ? "e.g. Summer Collection Launch" : "e.g. Summer Sale Post"} 
                />
              </Form.Control>
              <Form.Hint>
                {isCampaign 
                  ? "Internal name to identify this campaign"
                  : "Internal name to identify this post in your dashboard"
                }
              </Form.Hint>
              <Form.ErrorMessage />
            </Form.Item>
          )}
        />

        <Form.Field
          control={control}
          name="platform_id"
          render={({ field: { value, onChange, ...rest } }) => (
            <Form.Item>
              <Form.Label>Platform</Form.Label>
              <Form.Control>
                <Select
                  value={value}
                  onValueChange={(val) => {
                    onChange(val)
                    const plat = platforms.find((p) => p.id === val)
                    if (plat) {
                      onPlatformChange(val, plat.name)
                    }
                  }}
                  {...rest}
                  disabled={isPlatformsLoading}
                >
                  <Select.Trigger>
                    <Select.Value placeholder="Select platform" />
                  </Select.Trigger>
                  <Select.Content>
                    {platforms.map((platform) => (
                      <Select.Item key={platform.id} value={platform.id}>
                        {platform.name}
                      </Select.Item>
                    ))}
                  </Select.Content>
                </Select>
              </Form.Control>
              <Form.Hint>
                Choose the social media platform where you want to publish
              </Form.Hint>
              <Form.ErrorMessage />
            </Form.Item>
          )}
        />

        {/* Campaign-specific fields */}
        {isCampaign && (
          <>
            {/* Product Multi-Select */}
            <Form.Field
              control={control}
              name="product_ids"
              render={({ field: { value, onChange } }) => {
                const selectedIds = value || []
                return (
                  <Form.Item>
                    <Form.Label>Products</Form.Label>
                    <Form.Control>
                      <div className="space-y-3">
                        {/* Search Input */}
                        <Input
                          placeholder="Search products..."
                          value={productSearch}
                          onChange={(e) => setProductSearch(e.target.value)}
                        />
                        
                        {/* Selected Products */}
                        {selectedIds.length > 0 && (
                          <div className="flex flex-wrap gap-2 p-3 border rounded-lg bg-ui-bg-base">
                            {selectedIds.map((id: string) => {
                              const product = products.find(p => p.id === id)
                              return (
                                <Badge 
                                  key={id} 
                                  color="grey"
                                  className="cursor-pointer hover:bg-ui-bg-subtle-hover"
                                  onClick={() => onChange(selectedIds.filter((i: string) => i !== id))}
                                >
                                  {product?.title || id.slice(0, 8)}...
                                  <span className="ml-1 text-ui-fg-muted">×</span>
                                </Badge>
                              )
                            })}
                          </div>
                        )}
                        
                        {/* Product List */}
                        <div className="max-h-[200px] overflow-y-auto border rounded-lg">
                          {isProductsLoading ? (
                            <div className="p-4 text-center text-ui-fg-subtle">
                              Loading products...
                            </div>
                          ) : filteredProducts.length === 0 ? (
                            <div className="p-4 text-center text-ui-fg-subtle">
                              No products found
                            </div>
                          ) : (
                            filteredProducts.map((product) => {
                              const isSelected = selectedIds.includes(product.id)
                              return (
                                <div
                                  key={product.id}
                                  className={`flex items-center gap-3 p-3 cursor-pointer hover:bg-ui-bg-subtle border-b last:border-b-0 ${
                                    isSelected ? "bg-ui-bg-highlight" : ""
                                  }`}
                                  onClick={() => {
                                    if (isSelected) {
                                      onChange(selectedIds.filter((i: string) => i !== product.id))
                                    } else {
                                      onChange([...selectedIds, product.id])
                                    }
                                  }}
                                >
                                  {product.thumbnail && (
                                    <img 
                                      src={product.thumbnail} 
                                      alt={product.title}
                                      className="w-10 h-10 rounded object-cover"
                                    />
                                  )}
                                  <div className="flex-1 min-w-0">
                                    <Text className="font-medium truncate">
                                      {product.title}
                                    </Text>
                                    <Text size="xsmall" className="text-ui-fg-subtle">
                                      {product.id}
                                    </Text>
                                  </div>
                                  {isSelected && (
                                    <Badge color="green">Selected</Badge>
                                  )}
                                </div>
                              )
                            })
                          )}
                        </div>
                      </div>
                    </Form.Control>
                    <Form.Hint>
                      Select products to include in this campaign ({selectedIds.length} selected)
                    </Form.Hint>
                    <Form.ErrorMessage />
                  </Form.Item>
                )
              }}
            />

            {/* Interval */}
            <Form.Field
              control={control}
              name="interval_hours"
              render={({ field: { value, onChange, ...rest } }) => (
                <Form.Item>
                  <Form.Label>Publish Interval (hours)</Form.Label>
                  <Form.Control>
                    <Input
                      type="number"
                      min={1}
                      max={168}
                      value={value || 24}
                      onChange={(e) => onChange(parseInt(e.target.value) || 24)}
                      {...rest}
                    />
                  </Form.Control>
                  <Form.Hint>
                    Time between each post (e.g., 24 = one post per day)
                  </Form.Hint>
                  <Form.ErrorMessage />
                </Form.Item>
              )}
            />

            {/* Start Date */}
            <Form.Field
              control={control}
              name="start_at"
              render={({ field: { value, onChange } }) => (
                <Form.Item>
                  <Form.Label>Start Date (optional)</Form.Label>
                  <Form.Control>
                    <DatePicker
                      value={value ? new Date(value) : undefined}
                      onChange={(date) => onChange(date?.toISOString())}
                    />
                  </Form.Control>
                  <Form.Hint>
                    Leave empty to start immediately when activated
                  </Form.Hint>
                  <Form.ErrorMessage />
                </Form.Item>
              )}
            />
          </>
        )}
      </div>
    </div>
  )
}
