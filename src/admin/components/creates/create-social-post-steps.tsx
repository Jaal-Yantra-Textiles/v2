import { useForm } from "react-hook-form"
import { useState, useEffect } from "react"
import { Button, ProgressTabs, ProgressStatus, toast } from "@medusajs/ui"
import { zodResolver } from "@hookform/resolvers/zod"
import { useRouteModal } from "../modal/use-route-modal"
import { RouteFocusModal } from "../modal/route-focus-modal"
import { KeyboundForm } from "../utilitites/key-bound-form"
import { useCreateSocialPost } from "../../hooks/api/social-posts"
import { useSocialPlatforms, useSocialPlatform } from "../../hooks/api/social-platforms"
import { CreateSocialPostSchema, CreateSocialPostForm } from "./social-post/types"
import { SocialPostBasicStep } from "./social-post/basic-step"
import { SocialPostDesignerStep } from "./social-post/designer-step"

enum Tab {
  BASIC = "basic",
  DESIGNER = "designer",
}

export const CreateSocialPostSteps = () => {
  const [tab, setTab] = useState<Tab>(Tab.BASIC)
  const [tabState, setTabState] = useState<Record<Tab, ProgressStatus>>({
    [Tab.BASIC]: "in-progress",
    [Tab.DESIGNER]: "not-started",
  })

  const form = useForm<CreateSocialPostForm>({
    resolver: zodResolver(CreateSocialPostSchema),
    defaultValues: {
      name: "",
      platform_id: "",
      platform_name: "",
      media_urls: [],
      auto_publish: false,
    },
  })

  const { handleSuccess } = useRouteModal()
  const { mutateAsync, isPending } = useCreateSocialPost()
  const { socialPlatforms = [], isLoading: isPlatformsLoading } = useSocialPlatforms()

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

  const handleSubmit = form.handleSubmit(async (data) => {
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
      const result = await mutateAsync(payload)
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
                <ProgressTabs.Trigger
                  value={Tab.DESIGNER}
                  status={tabState[Tab.DESIGNER]}
                  className="w-full max-w-[200px]"
                >
                  Post Designer
                </ProgressTabs.Trigger>
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
                />
              </ProgressTabs.Content>

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
            </div>
          </RouteFocusModal.Body>

          <RouteFocusModal.Footer>
            <div className="flex w-full items-center justify-between">
              <div className="flex items-center gap-x-2">
                {tab === Tab.DESIGNER && (
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
                {tab === Tab.BASIC && (
                  <Button
                    variant="primary"
                    size="small"
                    type="button"
                    onClick={() => handleNextTab(Tab.BASIC, Tab.DESIGNER, ["name", "platform_id"])}
                  >
                    Continue to Designer
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
              </div>
            </div>
          </RouteFocusModal.Footer>
        </ProgressTabs>
      </KeyboundForm>
    </RouteFocusModal.Form>
  )
}
