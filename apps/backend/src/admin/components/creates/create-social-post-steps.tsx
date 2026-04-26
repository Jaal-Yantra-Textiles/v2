import { useForm } from "react-hook-form"
import { useState, useEffect } from "react"
import { Button, ProgressTabs, ProgressStatus, toast } from "@medusajs/ui"
import { zodResolver } from "@hookform/resolvers/zod"
import { useSearchParams } from "react-router-dom"
import { useRouteModal } from "../modal/use-route-modal"
import { RouteFocusModal } from "../modal/route-focus-modal"
import { KeyboundForm } from "../utilitites/key-bound-form"
import { useCreateSocialPost } from "../../hooks/api/social-posts"
import { useSocialPlatforms, useSocialPlatform } from "../../hooks/api/social-platforms"
import { useProducts } from "../../hooks/api/products"
import { useCreateCampaign, useContentRules } from "../../hooks/api/publishing-campaigns"
import { CreateSocialPostSchema, CreateSocialPostForm } from "./social-post/types"
import { SocialPostBasicStep } from "./social-post/basic-step"
import { SocialPostDesignerStep } from "./social-post/designer-step"
import { CampaignSettingsStep } from "./social-post/campaign-settings-step"

enum Tab {
  BASIC = "basic",
  DESIGNER = "designer",
  CAMPAIGN = "campaign",
}

export const CreateSocialPostSteps = () => {
  const [searchParams] = useSearchParams()
  const startInCampaignMode = searchParams.get("campaign") === "true"
  
  const [tab, setTab] = useState<Tab>(Tab.BASIC)
  const [tabState, setTabState] = useState<Record<Tab, ProgressStatus>>({
    [Tab.BASIC]: "in-progress",
    [Tab.DESIGNER]: "not-started",
    [Tab.CAMPAIGN]: "not-started",
  })
  const [isCampaignMode, setIsCampaignMode] = useState(startInCampaignMode)

  const form = useForm<CreateSocialPostForm>({
    resolver: zodResolver(CreateSocialPostSchema),
    defaultValues: {
      name: "",
      platform_id: "",
      platform_name: "",
      media_urls: [],
      auto_publish: false,
      is_campaign: startInCampaignMode,
      product_ids: [],
      interval_hours: 24,
    },
  })
  
  // Sync campaign mode from URL param on mount
  useEffect(() => {
    if (startInCampaignMode) {
      form.setValue("is_campaign", true)
      setIsCampaignMode(true)
    }
  }, [startInCampaignMode, form])

  const { handleSuccess } = useRouteModal()
  const { mutateAsync: createPost, isPending: isPostPending } = useCreateSocialPost()
  const { mutateAsync: createCampaign, isPending: isCampaignPending } = useCreateCampaign()
  const { socialPlatforms = [], isLoading: isPlatformsLoading } = useSocialPlatforms()
  const { products = [], isLoading: isProductsLoading } = useProducts({ limit: 100 })
  const { data: contentRulesData } = useContentRules()
  
  const isPending = isPostPending || isCampaignPending

  // Watch platform selection
  const platformId = form.watch("platform_id")
  const platformName = form.watch("platform_name")
  const selectedPlatform = socialPlatforms.find((p) => p.id === platformId)
  const platform = (platformName || "").toLowerCase()
  const isFacebook = platform === "facebook"
  const isFBINSTA = platform === "fbinsta" || platform === "facebook & instagram"

  // Facebook pages - use cached data from OAuth callback (stored in api_config.metadata)
  const shouldFetchPlatformData = isFacebook || isFBINSTA
  const { socialPlatform, isLoading: isPlatformLoading } = useSocialPlatform(shouldFetchPlatformData ? (platformId || "") : "")
  
  // Extract cached metadata from platform
  const pages = ((socialPlatform as any)?.api_config?.metadata?.pages || []) as Array<{ id: string; name?: string }>
  const igAccounts = ((socialPlatform as any)?.api_config?.metadata?.ig_accounts || []) as Array<{ id: string; username?: string }>
  const userProfile = (socialPlatform as any)?.api_config?.metadata?.user_profile
  
  // Loading state for pages (only while fetching platform data)
  const isPagesLoading = shouldFetchPlatformData && isPlatformLoading

  // Auto-select single page/IG account
  useEffect(() => {
    if (isFacebook && pages.length === 1) {
      form.setValue("page_id", pages[0].id)
    }
  }, [isFacebook, pages, form])

  useEffect(() => {
    if (platform === "instagram" && igAccounts.length === 1) {
      form.setValue("ig_user_id", igAccounts[0].id)
    }
  }, [platform, igAccounts, form])

  const handlePlatformChange = (_platformId: string, platformName: string) => {
    form.setValue("platform_name", platformName)
    // Reset platform-specific fields
    form.setValue("post_type", undefined)
    form.setValue("message", undefined)
    form.setValue("link", undefined)
    form.setValue("media_urls", [])
    form.setValue("page_id", undefined)
    form.setValue("ig_user_id", undefined)
    form.setValue("publish_target", undefined)
  }

  const handleNextTab = async (currentTab: Tab, nextTab: Tab, fieldsToValidate?: (keyof CreateSocialPostForm)[]) => {
    let validationResult = true
    if (fieldsToValidate) {
      validationResult = await form.trigger(fieldsToValidate)
    }

    if (validationResult) {
      setTabState((prev) => ({
        ...prev,
        [currentTab]: "completed",
        [nextTab]: "in-progress",
      }))
      setTab(nextTab)
    }
  }

  const handleCampaignModeChange = (isCampaign: boolean) => {
    setIsCampaignMode(isCampaign)
    // Reset tab state when switching modes
    setTabState({
      [Tab.BASIC]: "in-progress",
      [Tab.DESIGNER]: "not-started",
      [Tab.CAMPAIGN]: "not-started",
    })
  }

  const handleSubmit = form.handleSubmit(async (data) => {
    console.log("=== handleSubmit called ===")
    console.log("Data received:", data)
    
    // Campaign mode submission
    if (data.is_campaign) {
      console.log("Campaign mode detected")
      try {
        // Build content rule from form data
        const platformKey = (data.platform_name || "").toLowerCase()
        const defaultRule = contentRulesData?.rules?.[platformKey]
        console.log("Platform key:", platformKey)
        console.log("Default rule:", defaultRule)
        
        const contentRule = {
          id: `custom_${Date.now()}`,
          name: "Custom Rule",
          caption_template: data.custom_caption_template || defaultRule?.caption_template || "",
          description_max_length: defaultRule?.description_max_length || 200,
          hashtag_strategy: (data as any).content_rule?.hashtag_strategy || "from_product",
          image_selection: (data as any).content_rule?.image_selection || "all",
          include_price: (data as any).content_rule?.include_price || false,
          include_design: (data as any).content_rule?.include_design !== false,
          custom_hashtags: defaultRule?.custom_hashtags || [],
          max_images: defaultRule?.max_images || 10,
        }
        
        const campaignPayload = {
          name: data.name,
          product_ids: data.product_ids || [],
          platform_id: data.platform_id,
          content_rule: contentRule as any,
          interval_hours: data.interval_hours || 24,
          start_at: data.start_at || undefined,
        }
        console.log("Campaign payload:", campaignPayload)

        const campaign = await createCampaign(campaignPayload)
        console.log("Campaign created:", campaign)
        
        toast.success("Campaign created successfully!")
        handleSuccess(`/publishing-campaigns/${campaign.id}`)
      } catch (error) {
        console.error("Create campaign error:", error)
        toast.error("Failed to create campaign")
      }
      return
    }

    // Single post mode submission
    const payload: any = {
      ...data,
      caption: data.message,
      media_urls: data.media_urls,
      metadata: {
        ...(data.page_id ? { page_id: data.page_id } : {}),
        ...(data.ig_user_id ? { ig_user_id: data.ig_user_id } : {}),
        ...(data.publish_target ? { publish_target: data.publish_target } : {}),
        ...(typeof data.auto_publish === "boolean" ? { auto_publish: data.auto_publish } : {}),
      },
    }

    try {
      const result = await createPost(payload)
      toast.success("Social post created successfully!")
      handleSuccess(`/social-posts/${result.socialPost.id}`)
    } catch (error) {
      console.error("Create social post error:", error)
      toast.error("Failed to create social post")
    }
  })

  return (
    <RouteFocusModal.Form form={form}>
      <KeyboundForm
        onSubmit={handleSubmit}
        className="flex h-full flex-col overflow-hidden"
      >
        <ProgressTabs
          value={tab}
          onValueChange={async (value) => {
            const valid = await form.trigger()
            if (!valid) {
              return
            }
            setTab(value as Tab)
          }}
          className="flex h-full flex-col overflow-hidden"
        >
          <RouteFocusModal.Header>
            <div className="-my-2 w-full border-l">
              <ProgressTabs.List className="flex w-full items-center justify-start">
                <ProgressTabs.Trigger
                  value={Tab.BASIC}
                  status={tabState[Tab.BASIC]}
                  className="w-full max-w-[200px]"
                >
                  Basic Info
                </ProgressTabs.Trigger>
                {!isCampaignMode && (
                  <ProgressTabs.Trigger
                    value={Tab.DESIGNER}
                    status={tabState[Tab.DESIGNER]}
                    className="w-full max-w-[200px]"
                  >
                    Post Designer
                  </ProgressTabs.Trigger>
                )}
                {isCampaignMode && (
                  <ProgressTabs.Trigger
                    value={Tab.CAMPAIGN}
                    status={tabState[Tab.CAMPAIGN]}
                    className="w-full max-w-[200px]"
                  >
                    Campaign Settings
                  </ProgressTabs.Trigger>
                )}
              </ProgressTabs.List>
            </div>
          </RouteFocusModal.Header>

          <RouteFocusModal.Body className="size-full overflow-hidden p-0">
            <div className="flex size-full flex-col overflow-hidden">
              <ProgressTabs.Content
                value={Tab.BASIC}
                className="size-full overflow-y-auto data-[state=inactive]:hidden"
              >
                <SocialPostBasicStep
                  control={form.control}
                  platforms={socialPlatforms}
                  isPlatformsLoading={isPlatformsLoading}
                  onPlatformChange={handlePlatformChange}
                  products={products.map((p: any) => ({ id: p.id, title: p.title, thumbnail: p.thumbnail }))}
                  isProductsLoading={isProductsLoading}
                  onCampaignModeChange={handleCampaignModeChange}
                />
              </ProgressTabs.Content>

              {!isCampaignMode && (
                <ProgressTabs.Content
                  value={Tab.DESIGNER}
                  className="size-full overflow-hidden data-[state=inactive]:hidden"
                >
                  <SocialPostDesignerStep
                    control={form.control}
                    platformName={selectedPlatform?.name || ""}
                    pages={pages}
                    igAccounts={igAccounts}
                    isPagesLoading={isPagesLoading}
                    userProfile={userProfile}
                  />
                </ProgressTabs.Content>
              )}

              {isCampaignMode && (
                <ProgressTabs.Content
                  value={Tab.CAMPAIGN}
                  className="size-full overflow-hidden data-[state=inactive]:hidden"
                >
                  <CampaignSettingsStep
                    control={form.control}
                    platformName={selectedPlatform?.name || ""}
                    defaultContentRule={contentRulesData?.rules?.[(selectedPlatform?.name || "").toLowerCase()]}
                    products={products.map((p: any) => ({ id: p.id, title: p.title, thumbnail: p.thumbnail }))}
                  />
                </ProgressTabs.Content>
              )}
            </div>
          </RouteFocusModal.Body>

          <RouteFocusModal.Footer>
            <div className="flex w-full items-center justify-between">
              <div className="flex items-center gap-x-2">
                {(tab === Tab.DESIGNER || tab === Tab.CAMPAIGN) && (
                  <Button
                    variant="secondary"
                    size="small"
                    type="button"
                    onClick={() => setTab(Tab.BASIC)}
                  >
                    Back
                  </Button>
                )}
              </div>
              <div className="flex items-center gap-x-2">
                {tab === Tab.BASIC && !isCampaignMode && (
                  <Button
                    variant="primary"
                    size="small"
                    type="button"
                    onClick={() => handleNextTab(Tab.BASIC, Tab.DESIGNER, ["name", "platform_id"])}
                  >
                    Continue to Designer
                  </Button>
                )}
                {tab === Tab.BASIC && isCampaignMode && (
                  <Button
                    variant="primary"
                    size="small"
                    type="button"
                    onClick={async () => {
                      console.log("=== Campaign Continue Button Clicked ===")
                      console.log("Form values:", form.getValues())
                      console.log("Form errors before trigger:", form.formState.errors)
                      
                      // Validate basic fields first
                      const basicValid = await form.trigger(["name", "platform_id"])
                      console.log("Basic validation result:", basicValid)
                      console.log("Form errors after trigger:", form.formState.errors)
                      
                      if (!basicValid) {
                        console.log("Basic validation failed, stopping")
                        return
                      }
                      
                      // Check product_ids manually since superRefine handles it
                      const productIds = form.getValues("product_ids") || []
                      console.log("Product IDs:", productIds)
                      if (productIds.length === 0) {
                        console.log("No products selected, setting error")
                        form.setError("product_ids", { message: "Select at least one product for the campaign" })
                        return
                      }
                      
                      console.log("All validations passed, proceeding to campaign tab")
                      handleNextTab(Tab.BASIC, Tab.CAMPAIGN)
                    }}
                  >
                    Continue to Settings
                  </Button>
                )}
                {tab === Tab.DESIGNER && (
                  <Button
                    variant="primary"
                    type="submit"
                    size="small"
                    isLoading={isPending}
                    disabled={isPending}
                  >
                    Create Post
                  </Button>
                )}
                {tab === Tab.CAMPAIGN && (
                  <Button
                    variant="primary"
                    type="button"
                    size="small"
                    isLoading={isPending}
                    disabled={isPending}
                    onClick={async () => {
                      console.log("=== Create Campaign Button Clicked ===")
                      const values = form.getValues()
                      console.log("Form values:", values)
                      console.log("Form errors:", form.formState.errors)
                      
                      // Manually trigger submit for campaign
                      handleSubmit()
                    }}
                  >
                    Create Campaign
                  </Button>
                )}
              </div>
            </div>
          </RouteFocusModal.Footer>
        </ProgressTabs>
      </KeyboundForm>
    </RouteFocusModal.Form>
  )
}
