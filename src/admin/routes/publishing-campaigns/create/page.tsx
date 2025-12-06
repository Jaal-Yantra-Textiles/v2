import { 
  Container, 
  Heading, 
  Text, 
  Button,
  Input,
  Label,
  Select,
  toast,
  Textarea,
} from "@medusajs/ui"
import { useNavigate } from "react-router-dom"
import { useState, useEffect } from "react"
import { 
  useCreateCampaign, 
  useContentRules,
  ContentRule,
} from "../../../hooks/api/publishing-campaigns"
import { useSocialPlatforms } from "../../../hooks/api/social-platforms"

const CreateCampaignPage = () => {
  const navigate = useNavigate()
  const createMutation = useCreateCampaign()
  const { data: contentRulesData } = useContentRules()
  const { socialPlatforms, isLoading: platformsLoading } = useSocialPlatforms()
  
  const [name, setName] = useState("")
  const [platformId, setPlatformId] = useState("")
  const [productIds, setProductIds] = useState("")
  const [intervalHours, setIntervalHours] = useState(24)
  const [startAt, setStartAt] = useState("")
  const [useCustomRule, setUseCustomRule] = useState(false)
  const [customCaptionTemplate, setCustomCaptionTemplate] = useState("")
  
  // Get default rule when platform changes
  const selectedPlatform = socialPlatforms?.find(p => p.id === platformId)
  const platformName = (selectedPlatform as any)?.name?.toLowerCase() || ""
  const defaultRule = contentRulesData?.rules?.[platformName] || contentRulesData?.rules?.instagram
  
  useEffect(() => {
    if (defaultRule && !useCustomRule) {
      setCustomCaptionTemplate(defaultRule.caption_template)
    }
  }, [defaultRule, useCustomRule])
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!name.trim()) {
      toast.error("Campaign name is required")
      return
    }
    
    if (!platformId) {
      toast.error("Please select a platform")
      return
    }
    
    const productIdList = productIds
      .split(/[\n,]/)
      .map(id => id.trim())
      .filter(id => id.length > 0)
    
    if (productIdList.length === 0) {
      toast.error("At least one product ID is required")
      return
    }
    
    try {
      const contentRule: ContentRule | undefined = useCustomRule && customCaptionTemplate
        ? {
            ...defaultRule!,
            caption_template: customCaptionTemplate,
          }
        : undefined
      
      const campaign = await createMutation.mutateAsync({
        name,
        product_ids: productIdList,
        platform_id: platformId,
        content_rule: contentRule,
        interval_hours: intervalHours,
        start_at: startAt || undefined,
      })
      
      toast.success("Campaign created successfully")
      navigate(`/publishing-campaigns/${campaign.id}`)
    } catch (e: any) {
      toast.error(e.message || "Failed to create campaign")
    }
  }
  
  return (
    <Container className="max-w-2xl mx-auto p-6">
      <div className="mb-6">
        <Heading>Create Publishing Campaign</Heading>
        <Text className="text-ui-fg-subtle mt-1">
          Schedule automated social media posts for your products
        </Text>
      </div>
      
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Campaign Name */}
        <div>
          <Label htmlFor="name">Campaign Name</Label>
          <Input
            id="name"
            placeholder="e.g., Summer Collection Launch"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        
        {/* Platform Selection */}
        <div>
          <Label htmlFor="platform">Platform</Label>
          <Select value={platformId} onValueChange={setPlatformId}>
            <Select.Trigger>
              <Select.Value placeholder="Select a platform" />
            </Select.Trigger>
            <Select.Content>
              {socialPlatforms?.map((platform: any) => (
                <Select.Item key={platform.id} value={platform.id}>
                  {platform.name}
                </Select.Item>
              ))}
            </Select.Content>
          </Select>
        </div>
        
        {/* Product IDs */}
        <div>
          <Label htmlFor="products">Product IDs</Label>
          <Text className="text-ui-fg-subtle text-sm mb-2">
            Enter product IDs, one per line or comma-separated
          </Text>
          <Textarea
            id="products"
            placeholder="prod_01ABC123&#10;prod_02DEF456&#10;prod_03GHI789"
            value={productIds}
            onChange={(e) => setProductIds(e.target.value)}
            rows={5}
          />
        </div>
        
        {/* Interval */}
        <div>
          <Label htmlFor="interval">Publish Interval (hours)</Label>
          <Text className="text-ui-fg-subtle text-sm mb-2">
            Time between each post
          </Text>
          <Input
            id="interval"
            type="number"
            min={1}
            max={168}
            value={intervalHours}
            onChange={(e) => setIntervalHours(parseInt(e.target.value) || 24)}
          />
        </div>
        
        {/* Start Time */}
        <div>
          <Label htmlFor="startAt">Start Date/Time (optional)</Label>
          <Text className="text-ui-fg-subtle text-sm mb-2">
            Leave empty to start immediately when activated
          </Text>
          <Input
            id="startAt"
            type="datetime-local"
            value={startAt}
            onChange={(e) => setStartAt(e.target.value)}
          />
        </div>
        
        {/* Content Rule */}
        <div className="border rounded-lg p-4">
          <div className="flex items-center justify-between mb-4">
            <div>
              <Label>Caption Template</Label>
              <Text className="text-ui-fg-subtle text-sm">
                Customize how product content is formatted
              </Text>
            </div>
            <Button
              type="button"
              variant="secondary"
              size="small"
              onClick={() => setUseCustomRule(!useCustomRule)}
            >
              {useCustomRule ? "Use Default" : "Customize"}
            </Button>
          </div>
          
          {useCustomRule ? (
            <div>
              <Text className="text-ui-fg-subtle text-xs mb-2">
                Available variables: {"{{title}}"}, {"{{description}}"}, {"{{price}}"}, 
                {"{{design_name}}"}, {"{{hashtags}}"}, {"{{url}}"}
              </Text>
              <Textarea
                value={customCaptionTemplate}
                onChange={(e) => setCustomCaptionTemplate(e.target.value)}
                rows={6}
                className="font-mono text-sm"
              />
            </div>
          ) : (
            <div className="bg-ui-bg-subtle p-3 rounded text-sm font-mono whitespace-pre-wrap">
              {defaultRule?.caption_template || "Select a platform to see default template"}
            </div>
          )}
        </div>
        
        {/* Actions */}
        <div className="flex justify-end gap-3 pt-4 border-t">
          <Button
            type="button"
            variant="secondary"
            onClick={() => navigate("/publishing-campaigns")}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            isLoading={createMutation.isPending}
          >
            Create Campaign
          </Button>
        </div>
      </form>
    </Container>
  )
}

export const handle = {
  breadcrumb: () => "Create Campaign",
}

export default CreateCampaignPage
