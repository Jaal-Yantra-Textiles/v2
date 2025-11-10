import { Button, Heading, Input, Select, Switch, Text } from "@medusajs/ui"
import { useForm, useWatch } from "react-hook-form"
import { z } from "zod"
import { zodResolver } from "@hookform/resolvers/zod"
import { useCreateSocialPost } from "../../hooks/api/social-posts"
import { useSocialPlatforms, useSocialPlatform } from "../../hooks/api/social-platforms"
import { useFacebookPages } from "../../hooks/api/social-facebook"
import { RouteFocusModal } from "../modal/route-focus-modal"
import { KeyboundForm } from "../utilitites/key-bound-form"
import { Form } from "../common/form"
import { useRouteModal } from "../modal/use-route-modal"
import { XMark } from "@medusajs/icons"
import RawMaterialMediaModal from "../../routes/inventory/[id]/raw-materials/create/media/page"
import { useEffect } from "react"


const BaseSchema = z.object({
  name: z.string().min(1, "Name is required"),
  platform_id: z.string().min(1, "Platform is required"),
  platform_name: z.string().optional(),
  // Optional fields for platform-specific payload
  post_type: z.enum(["photo", "feed", "reel"]).optional(),
  message: z.string().optional(),
  link: z.string().url().optional(),
  media_urls: z.array(z.string().url()).optional(),
  // Chosen page to target (stored into metadata.page_id on submit)
  page_id: z.string().optional(),
  // Instagram target account (stored into metadata.ig_user_id)
  ig_user_id: z.string().optional(),
  // Publish target for FBINSTA: "facebook", "instagram", or "both"
  publish_target: z.enum(["facebook", "instagram", "both"]).optional(),
  // Automation
  auto_publish: z.boolean().optional(),
})

const CreateSocialPostSchema = BaseSchema.superRefine((data, ctx) => {
  const platform = (data.platform_name || "").toLowerCase()
  
  // FBINSTA validation
  if (platform === "fbinsta" || platform === "facebook & instagram") {
    if (!data.publish_target) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["publish_target"],
        message: "Please select where to publish",
      })
      return
    }
    if (!data.post_type) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["post_type"],
        message: "Post type is required",
      })
      return
    }
    
    // Validate Facebook Page if publishing to Facebook or Both
    if (data.publish_target === "facebook" || data.publish_target === "both") {
      if (!data.page_id) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["page_id"],
          message: "Facebook page is required",
        })
      }
    } else if (data.publish_target === "instagram") {
      // For Instagram-only, page_id is not required
      // Instagram uses ig_user_id only
    }
    
    // Validate Instagram Account if publishing to Instagram or Both
    if (data.publish_target === "instagram" || data.publish_target === "both") {
      if (!data.ig_user_id) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["ig_user_id"],
          message: "Instagram account is required",
        })
      }
    }
    
    const urls = data.media_urls ?? []
    if (data.post_type === "photo") {
      if (urls.length < 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["media_urls"],
          message: "Select at least one image",
        })
      } else if (urls.length > 10) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["media_urls"],
          message: "Maximum 10 images allowed for carousel",
        })
      }
    }
    return
  }
  
  if (platform === "facebook") {
    if (!data.post_type) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["post_type"],
        message: "Post type is required for Facebook",
      })
      return
    }
    if (data.post_type === "photo") {
      const urls = data.media_urls ?? []
      if (urls.length < 1 || urls.length > 10) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["media_urls"],
          message: "Select between 1 and 10 images",
        })
      }
    }
    if (data.post_type === "feed") {
      if (!data.message || !data.message.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["message"],
          message: "Message is required for feed posts",
        })
      }
    }
    // If we have pages fetched, we will require page selection client-side optionally later
  }
  if (platform === "instagram") {
    if (!data.post_type) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["post_type"], message: "Post type is required for Instagram" })
      return
    }
    if (!data.ig_user_id) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["ig_user_id"], message: "Select an Instagram account" })
    }
    const urls = data.media_urls ?? []
    if (data.post_type === "photo") {
      if (urls.length < 1) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["media_urls"], message: "Select at least one image" })
      } else if (urls.length > 10) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["media_urls"], message: "Maximum 10 images for carousel" })
      }
    }
    if (data.post_type === "reel") {
      if (urls.length !== 1) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["media_urls"], message: "Select exactly one video" })
      }
    }
  }
})

type CreateSocialPostForm = z.infer<typeof CreateSocialPostSchema>

export const CreateSocialPostComponent = () => {
  const { handleSuccess } = useRouteModal()

  const form = useForm<CreateSocialPostForm>({
    resolver: zodResolver(CreateSocialPostSchema),
    defaultValues: {
      media_urls: [],
      auto_publish: false,
    },
  })

  const { mutateAsync, isPending } = useCreateSocialPost()
  const {
    socialPlatforms = [],
    isLoading: isPlatformsLoading,
  } = useSocialPlatforms()

  // Watch selected platform and post_type to conditionally render fields
  const platformId = useWatch({ control: form.control, name: "platform_id" })
  const postType = useWatch({ control: form.control, name: "post_type" })
  const publishTarget = useWatch({ control: form.control, name: "publish_target" })
  const selectedPlatform = socialPlatforms.find((p) => p.id === platformId)
  const platformName = (selectedPlatform?.name || "").toLowerCase()
  const isFacebook = platformName === "facebook"
  const isInstagram = platformName === "instagram"
  const isFBINSTA = platformName === "fbinsta" || platformName === "facebook & instagram"

  // Facebook pages via reusable hook
  const { socialPlatform } = useSocialPlatform(platformId || "")
  const cachedPages = ((socialPlatform as any)?.api_config?.metadata?.pages || []) as Array<{ id: string; name?: string }>
  const useCache = Array.isArray(cachedPages) && cachedPages.length > 0
  const { pages: livePages, isLoading: isPagesLoading } = useFacebookPages(useCache ? undefined : platformId)
  const pages = useCache ? cachedPages : livePages
  // Instagram accounts from cached metadata
  const igAccounts = (((socialPlatform as any)?.api_config?.metadata?.ig_accounts || []) as Array<{ id: string; username?: string }>) || []

  // Preselect single page and clear when context invalid
  useEffect(() => {
    if (!isFacebook || !platformId) {
      form.setValue("page_id", undefined)
      return
    }
    if (Array.isArray(pages) && pages.length === 1) {
      form.setValue("page_id", pages[0].id)
    }
  }, [isFacebook, platformId, pages, form])

  // Preselect single IG account and clear when context invalid
  useEffect(() => {
    if (!isInstagram || !platformId) {
      form.setValue("ig_user_id", undefined)
      return
    }
    if (Array.isArray(igAccounts) && igAccounts.length === 1) {
      form.setValue("ig_user_id", igAccounts[0].id)
    }
  }, [isInstagram, platformId, igAccounts, form])

  const onSubmit = form.handleSubmit(async (data) => {
    // Map UI fields to creation payload; backend hooks will normalize as well
    const payload: any = {
      ...data,
      // prefer caption from message
      caption: data.message,
      // include media urls so backend can build media_attachments
      media_urls: data.media_urls,
      // pass selected page into metadata for workflow hook to store
      metadata: {
        ...(data.page_id ? { page_id: data.page_id } : {}),
        ...(data.ig_user_id ? { ig_user_id: data.ig_user_id } : {}),
        ...(data.publish_target ? { publish_target: data.publish_target } : {}),
        ...(typeof data.auto_publish === "boolean" ? { auto_publish: data.auto_publish } : {}),
      },
    }
    await mutateAsync(payload, {
      onSuccess: ({ socialPost }) => {
        handleSuccess(`/social-posts/${socialPost.id}`)
      },
    })
  })

  return (
    <RouteFocusModal.Form form={form}>
      <KeyboundForm onSubmit={onSubmit} className="flex flex-1 flex-col overflow-hidden">
        <RouteFocusModal.Header />
        <RouteFocusModal.Body className="flex flex-1 flex-col items-center overflow-y-auto py-16">
          <div className="flex w-full max-w-[720px] flex-col gap-y-8">
            <div>
              <Heading>Create Social Post</Heading>
              <Text size="small" className="text-ui-fg-subtle">
                Define a new social post for your brand.
              </Text>
            </div>

            <Form.Field
              control={form.control}
              name="name"
              render={({ field }) => (
                <Form.Item>
                  <Form.Label>Name</Form.Label>
                  <Form.Control>
                    <Input {...field} placeholder="e.g. Summer Sale Post" />
                  </Form.Control>
                  <Form.ErrorMessage />
                </Form.Item>
              )}
            />

            <Form.Field
              control={form.control}
              name="platform_id"
              render={({ field: { value, onChange, ...rest } }) => (
                <Form.Item>
                  <Form.Label>Platform</Form.Label>
                  <Form.Control>
                    <Select
                      value={value}
                      onValueChange={(val) => {
                        onChange(val)
                        const plat = socialPlatforms.find((p) => p.id === val)
                        form.setValue("platform_name", plat?.name || "")
                        // Reset platform-specific fields on platform change
                        form.setValue("post_type", undefined)
                        form.setValue("message", undefined)
                        form.setValue("link", undefined)
                        form.setValue("media_urls", [])
                        form.setValue("page_id", undefined)
                      }}
                      {...rest}
                      disabled={isPlatformsLoading}
                    >
                      <Select.Trigger>
                        <Select.Value placeholder="Select platform" />
                      </Select.Trigger>
                      <Select.Content>
                        {socialPlatforms.map((platform) => (
                          <Select.Item key={platform.id} value={platform.id}>
                            {platform.name}
                          </Select.Item>
                        ))}
                      </Select.Content>
                    </Select>
                  </Form.Control>
                  <Form.ErrorMessage />
                </Form.Item>
              )}
            />

            {isFacebook && (
              <div className="flex flex-col gap-y-6 rounded-md border p-4">
                <Heading level="h2">Facebook Page Post</Heading>

                <Form.Field
                  control={form.control}
                  name="post_type"
                  render={({ field: { value, onChange } }) => (
                    <Form.Item>
                      <Form.Label>Post Type</Form.Label>
                      <Form.Control>
                        <Select value={value} onValueChange={onChange}>
                          <Select.Trigger>
                            <Select.Value placeholder="Select post type" />
                          </Select.Trigger>
                          <Select.Content>
                            <Select.Item value="photo">Photo</Select.Item>
                            <Select.Item value="feed">Feed (text/link)</Select.Item>
                          </Select.Content>
                        </Select>
                      </Form.Control>
                      <Form.ErrorMessage />
                    </Form.Item>
                  )}
                />

                {/* Page selection */}
                <Form.Field
                  control={form.control}
                  name="page_id"
                  render={({ field: { value, onChange } }) => (
                    <Form.Item>
                      <Form.Label>Facebook Page</Form.Label>
                      <Form.Control>
                        <Select value={value} onValueChange={onChange} disabled={isPagesLoading}>
                          <Select.Trigger>
                            <Select.Value placeholder={isPagesLoading ? "Loading pages..." : "Select page"} />
                          </Select.Trigger>
                          <Select.Content>
                            {pages.map((p) => (
                              <Select.Item key={p.id} value={p.id}>
                                {p.name || p.id}
                              </Select.Item>
                            ))}
                          </Select.Content>
                        </Select>
                      </Form.Control>
                      <Form.ErrorMessage />
                    </Form.Item>
                  )}
                />

                {/* Auto publish toggle */}
                <Form.Field
                  control={form.control}
                  name="auto_publish"
                  render={({ field: { value, onChange } }) => (
                    <Form.Item>
                      <Form.Label>Auto publish</Form.Label>
                      <Form.Control>
                        <div className="flex items-center gap-x-2">
                          <Switch checked={!!value} onCheckedChange={onChange} />
                          <Text size="small" className="text-ui-fg-subtle">Publish immediately after creation</Text>
                        </div>
                      </Form.Control>
                      <Form.ErrorMessage />
                    </Form.Item>
                  )}
                />

                {/* Message field for both types */}
                <Form.Field
                  control={form.control}
                  name="message"
                  render={({ field }) => (
                    <Form.Item>
                      <Form.Label>Message</Form.Label>
                      <Form.Control>
                        <Input {...field} placeholder="Say something about this post" />
                      </Form.Control>
                      <Form.ErrorMessage />
                    </Form.Item>
                  )}
                />

                {/* Link only for feed posts */}
                {postType === "feed" && (
                  <Form.Field
                    control={form.control}
                    name="link"
                    render={({ field }) => (
                      <Form.Item>
                        <Form.Label>Link (optional)</Form.Label>
                        <Form.Control>
                          <Input {...field} placeholder="https://example.com" />
                        </Form.Control>
                        <Form.ErrorMessage />
                      </Form.Item>
                    )}
                  />
                )}

                {/* Media picker for photo posts: pick 1 image URL using stacked modal */}
                {postType === "photo" && (
                  <Form.Field
                    control={form.control}
                    name="media_urls"
                    render={({ field: { value, onChange } }) => {
                      const urls = Array.isArray(value) ? value : []
                      return (
                        <Form.Item>
                          <Form.Label>Media</Form.Label>
                          <div className="mt-2 flex flex-wrap items-center gap-3">
                            {urls.map((url, index) => (
                              <div key={index} className="relative h-20 w-20 overflow-hidden rounded-md border">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={url} alt={`Selected media ${index + 1}`} className="h-full w-full object-cover" />
                                <div className="absolute top-1 right-1 flex items-center justify-center rounded-full bg-white/50 p-0.5">
                                  <XMark
                                    className="text-ui-fg-muted hover:text-ui-fg-subtle cursor-pointer"
                                    onClick={() => onChange(urls.filter((u) => u !== url))}
                                  />
                                </div>
                              </div>
                            ))}
                            <RawMaterialMediaModal
                              onSave={(picked) => {
                                // Allow multiple images (up to 10 for carousel)
                                const next = Array.isArray(picked) ? picked.slice(0, 10) : []
                                onChange(next)
                              }}
                              initialUrls={urls}
                            />
                          </div>
                          <Text size="small" className="text-ui-fg-subtle mt-2">
                            Select 1-10 images. Single image = photo post, multiple images = album.
                          </Text>
                          <Form.ErrorMessage />
                        </Form.Item>
                      )
                    }}
                  />
                )}

                <Text size="small" className="text-ui-fg-subtle">
                  This section configures a Facebook Page post. After creating, you can trigger publishing via the admin action.
                </Text>
              </div>
            )}

            {isFBINSTA && (
              <div className="flex flex-col gap-y-6 rounded-md border p-4">
                <Heading level="h2">Facebook & Instagram Post</Heading>
                <Text size="small" className="text-ui-fg-subtle">
                  Choose where to publish: Facebook only, Instagram only, or both platforms.
                </Text>

                {/* Publish Target Selection */}
                <Form.Field
                  control={form.control}
                  name="publish_target"
                  render={({ field: { value, onChange } }) => (
                    <Form.Item>
                      <Form.Label>Publish To</Form.Label>
                      <Form.Control>
                        <Select value={value} onValueChange={onChange}>
                          <Select.Trigger>
                            <Select.Value placeholder="Select platform(s)" />
                          </Select.Trigger>
                          <Select.Content>
                            <Select.Item value="facebook">📘 Facebook Only</Select.Item>
                            <Select.Item value="instagram">📷 Instagram Only</Select.Item>
                            <Select.Item value="both">📘 + 📷 Both Platforms</Select.Item>
                          </Select.Content>
                        </Select>
                      </Form.Control>
                      <Form.ErrorMessage />
                    </Form.Item>
                  )}
                />

                <Form.Field
                  control={form.control}
                  name="post_type"
                  render={({ field: { value, onChange } }) => (
                    <Form.Item>
                      <Form.Label>Post Type</Form.Label>
                      <Form.Control>
                        <Select value={value} onValueChange={onChange}>
                          <Select.Trigger>
                            <Select.Value placeholder="Select post type" />
                          </Select.Trigger>
                          <Select.Content>
                            <Select.Item value="photo">Photo</Select.Item>
                          </Select.Content>
                        </Select>
                      </Form.Control>
                      <Form.ErrorMessage />
                      <Text size="small" className="text-ui-fg-subtle mt-1">
                        Note: Only photo posts are currently supported.
                      </Text>
                    </Form.Item>
                  )}
                />

                {/* Facebook Page selection - only show if publishing to Facebook or Both */}
                {(publishTarget === "facebook" || publishTarget === "both") && (
                  <Form.Field
                    control={form.control}
                    name="page_id"
                    render={({ field: { value, onChange } }) => (
                      <Form.Item>
                        <Form.Label>Facebook Page</Form.Label>
                        <Form.Control>
                          <Select value={value} onValueChange={onChange} disabled={isPagesLoading}>
                            <Select.Trigger>
                              <Select.Value placeholder={isPagesLoading ? "Loading pages..." : "Select page"} />
                            </Select.Trigger>
                            <Select.Content>
                              {pages.map((p) => (
                                <Select.Item key={p.id} value={p.id}>
                                  {p.name || p.id}
                                </Select.Item>
                              ))}
                            </Select.Content>
                          </Select>
                        </Form.Control>
                        <Form.ErrorMessage />
                      </Form.Item>
                    )}
                  />
                )}

                {/* Instagram account selection - only show if publishing to Instagram or Both */}
                {(publishTarget === "instagram" || publishTarget === "both") && (
                  <Form.Field
                    control={form.control}
                    name="ig_user_id"
                    render={({ field: { value, onChange } }) => (
                      <Form.Item>
                        <Form.Label>Instagram Account</Form.Label>
                        <Form.Control>
                          <Select value={value} onValueChange={onChange}>
                            <Select.Trigger>
                              <Select.Value placeholder="Select IG account" />
                            </Select.Trigger>
                            <Select.Content>
                              {igAccounts.map((acc) => (
                                <Select.Item key={acc.id} value={acc.id}>
                                  {acc.username || acc.id}
                                </Select.Item>
                              ))}
                            </Select.Content>
                          </Select>
                        </Form.Control>
                        <Form.ErrorMessage />
                      </Form.Item>
                    )}
                  />
                )}

                {/* Message/Caption */}
                <Form.Field
                  control={form.control}
                  name="message"
                  render={({ field }) => (
                    <Form.Item>
                      <Form.Label>Message/Caption</Form.Label>
                      <Form.Control>
                        <Input {...field} placeholder="Write your message (will be used for both platforms)" />
                      </Form.Control>
                      <Form.ErrorMessage />
                    </Form.Item>
                  )}
                />

                {/* Media picker for photo posts */}
                {postType === "photo" && (
                  <Form.Field
                    control={form.control}
                    name="media_urls"
                    render={({ field: { value, onChange } }) => {
                      const urls = Array.isArray(value) ? value : []
                      return (
                        <Form.Item>
                          <Form.Label>Media</Form.Label>
                          <div className="mt-2 flex flex-wrap items-center gap-3">
                            {urls.map((url, index) => (
                              <div key={index} className="relative h-20 w-20 overflow-hidden rounded-md border">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={url} alt={`Selected media ${index + 1}`} className="h-full w-full object-cover" />
                                <div className="absolute top-1 right-1 flex items-center justify-center rounded-full bg-white/50 p-0.5">
                                  <XMark
                                    className="text-ui-fg-muted hover:text-ui-fg-subtle cursor-pointer"
                                    onClick={() => onChange(urls.filter((u) => u !== url))}
                                  />
                                </div>
                              </div>
                            ))}
                            <RawMaterialMediaModal
                              onSave={(picked) => {
                                // Allow multiple images (up to 10 for carousel)
                                const next = Array.isArray(picked) ? picked.slice(0, 10) : []
                                onChange(next)
                              }}
                              initialUrls={urls}
                            />
                          </div>
                          <Text size="small" className="text-ui-fg-subtle mt-2">
                            Select 1-10 images. Single image = photo post, multiple images = carousel/album. All images automatically transformed for Instagram.
                          </Text>
                          <Form.ErrorMessage />
                        </Form.Item>
                      )
                    }}
                  />
                )}

                {/* Auto publish toggle */}
                <Form.Field
                  control={form.control}
                  name="auto_publish"
                  render={({ field: { value, onChange } }) => (
                    <Form.Item>
                      <Form.Label>Auto publish</Form.Label>
                      <Form.Control>
                        <div className="flex items-center gap-x-2">
                          <Switch checked={!!value} onCheckedChange={onChange} />
                          <Text size="small" className="text-ui-fg-subtle">
                            {publishTarget === "both" 
                              ? "Publish to both platforms immediately after creation"
                              : "Publish immediately after creation"}
                          </Text>
                        </div>
                      </Form.Control>
                      <Form.ErrorMessage />
                    </Form.Item>
                  )}
                />
              </div>
            )}

            {isInstagram && (
              <div className="flex flex-col gap-y-6 rounded-md border p-4">
                <Heading level="h2">Instagram Post</Heading>

                <Form.Field
                  control={form.control}
                  name="post_type"
                  render={({ field: { value, onChange } }) => (
                    <Form.Item>
                      <Form.Label>Post Type</Form.Label>
                      <Form.Control>
                        <Select value={value} onValueChange={onChange}>
                          <Select.Trigger>
                            <Select.Value placeholder="Select post type" />
                          </Select.Trigger>
                          <Select.Content>
                            <Select.Item value="photo">Photo</Select.Item>
                            <Select.Item value="reel">Reel (video)</Select.Item>
                          </Select.Content>
                        </Select>
                      </Form.Control>
                      <Form.ErrorMessage />
                    </Form.Item>
                  )}
                />

                {/* IG account selection */}
                <Form.Field
                  control={form.control}
                  name="ig_user_id"
                  render={({ field: { value, onChange } }) => (
                    <Form.Item>
                      <Form.Label>Instagram Account</Form.Label>
                      <Form.Control>
                        <Select value={value} onValueChange={onChange}>
                          <Select.Trigger>
                            <Select.Value placeholder="Select IG account" />
                          </Select.Trigger>
                          <Select.Content>
                            {igAccounts.map((acc) => (
                              <Select.Item key={acc.id} value={acc.id}>
                                {acc.username || acc.id}
                              </Select.Item>
                            ))}
                          </Select.Content>
                        </Select>
                      </Form.Control>
                      <Form.ErrorMessage />
                    </Form.Item>
                  )}
                />

                {/* Caption */}
                <Form.Field
                  control={form.control}
                  name="message"
                  render={({ field }) => (
                    <Form.Item>
                      <Form.Label>Caption</Form.Label>
                      <Form.Control>
                        <Input {...field} placeholder="Write a caption" />
                      </Form.Control>
                      <Form.ErrorMessage />
                    </Form.Item>
                  )}
                />

                {/* Media picker - photo (image) or reel (video). UI picker returns images; if video URLs needed, paste manually via modal or future enhancement */}
                <Form.Field
                  control={form.control}
                  name="media_urls"
                  render={({ field: { value, onChange } }) => {
                    const urls = Array.isArray(value) ? value : []
                    return (
                      <Form.Item>
                        <Form.Label>Media</Form.Label>
                        <div className="mt-2 flex flex-wrap items-center gap-3">
                          {urls.map((url, index) => (
                            <div key={index} className="relative h-20 w-20 overflow-hidden rounded-md border">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={url} alt={`Selected media ${index + 1}`} className="h-full w-full object-cover" />
                              <div className="absolute top-1 right-1 flex items-center justify-center rounded-full bg-white/50 p-0.5">
                                <XMark
                                  className="text-ui-fg-muted hover:text-ui-fg-subtle cursor-pointer"
                                  onClick={() => onChange(urls.filter((u) => u !== url))}
                                />
                              </div>
                            </div>
                          ))}
                          <RawMaterialMediaModal
                            onSave={(picked) => {
                              // Allow multiple images (up to 10 for carousel)
                              const next = Array.isArray(picked) ? picked.slice(0, 10) : []
                              onChange(next)
                            }}
                            initialUrls={urls}
                          />
                        </div>
                        <Text size="small" className="text-ui-fg-subtle">
                          {postType === "reel" 
                            ? "For reels, provide a video URL supported by Instagram. Media library video selection can be added later."
                            : `Select 1-10 images. Single image = photo post, multiple images = carousel. All images are automatically transformed to 1:1 square (1080x1080) for Instagram compatibility.`}
                        </Text>
                        <Form.ErrorMessage />
                      </Form.Item>
                    )
                  }}
                />

                {/* Auto publish */}
                <Form.Field
                  control={form.control}
                  name="auto_publish"
                  render={({ field: { value, onChange } }) => (
                    <Form.Item>
                      <Form.Label>Auto publish</Form.Label>
                      <Form.Control>
                        <div className="flex items-center gap-x-2">
                          <Switch checked={!!value} onCheckedChange={onChange} />
                          <Text size="small" className="text-ui-fg-subtle">Publish immediately after creation</Text>
                        </div>
                      </Form.Control>
                      <Form.ErrorMessage />
                    </Form.Item>
                  )}
                />

                <Text size="small" className="text-ui-fg-subtle">
                  Instagram publishing uses the linked Business/Creator account via Facebook OAuth.
                </Text>
              </div>
            )}
          </div>
        </RouteFocusModal.Body>
        <RouteFocusModal.Footer>
          <div className="flex justify-end items-center gap-x-2 px-6">
            <RouteFocusModal.Close asChild>
              <Button size="small" variant="secondary">
                Cancel
              </Button>
            </RouteFocusModal.Close>
            <Button size="small" variant="primary" type="submit" isLoading={isPending}>
              Save
            </Button>
          </div>
        </RouteFocusModal.Footer>
      </KeyboundForm>
    </RouteFocusModal.Form>
  )
}

export default CreateSocialPostComponent
