import { Input, Select, Switch, Text, Heading } from "@medusajs/ui"
import { Control, useWatch } from "react-hook-form"
import { Form } from "../../common/form"
import { CreateSocialPostForm } from "./types"
import { CaptionInputWithSuggestions } from "../../social-posts/caption-input-with-suggestions"
import FileModal from "../../../routes/inventory/[id]/raw-materials/create/media/page"
import { XMark } from "@medusajs/icons"
import { SocialPostPreview } from "./preview"


interface DesignerStepProps {
  control: Control<CreateSocialPostForm>
  platformName: string
  pages: Array<{ id: string; name?: string }>
  igAccounts: Array<{ id: string; username?: string }>
  isPagesLoading: boolean
  userProfile?: {
    name?: string
    username?: string
    profile_image_url?: string
    verified?: boolean
  }
}

export const SocialPostDesignerStep = ({
  control,
  platformName,
  pages,
  igAccounts,
  isPagesLoading,
  userProfile,
}: DesignerStepProps) => {
  const postType = useWatch({ control, name: "post_type" })
  const publishTarget = useWatch({ control, name: "publish_target" })
  const message = useWatch({ control, name: "message" })
  const mediaUrls = useWatch({ control, name: "media_urls" })
  const name = useWatch({ control, name: "name" })
  
  const platform = platformName.toLowerCase()
  const isFacebook = platform === "facebook"
  const isInstagram = platform === "instagram"
  const isFBINSTA = platform === "fbinsta" || platform === "facebook & instagram"
  const isTwitter = platform === "twitter" || platform === "x"

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left Side - Form Fields */}
      <div className="flex-1 overflow-y-auto p-16">
        <div className="mx-auto w-full max-w-[600px] flex flex-col gap-y-8">
          <div>
            <Heading level="h2">Post Designer</Heading>
            <Text size="small" className="text-ui-fg-subtle mt-2">
              Design your {platformName} post with all the details
            </Text>
          </div>

          {/* Facebook Post */}
          {isFacebook && (
            <div className="flex flex-col gap-y-6">
              <Form.Field
                control={control}
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
                          <Select.Item value="photo">📷 Photo</Select.Item>
                          <Select.Item value="feed">📝 Feed (text/link)</Select.Item>
                        </Select.Content>
                      </Select>
                    </Form.Control>
                    <Form.ErrorMessage />
                  </Form.Item>
                )}
              />

              <Form.Field
                control={control}
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

              <Form.Field
                control={control}
                name="auto_publish"
                render={({ field: { value, onChange } }) => (
                  <Form.Item>
                    <Form.Label>Auto Publish</Form.Label>
                    <Form.Control>
                      <div className="flex items-center gap-x-2">
                        <Switch checked={!!value} onCheckedChange={onChange} />
                        <Text size="small" className="text-ui-fg-subtle">
                          Publish immediately after creation
                        </Text>
                      </div>
                    </Form.Control>
                    <Form.ErrorMessage />
                  </Form.Item>
                )}
              />

              <Form.Field
                control={control}
                name="message"
                render={({ field: { value, onChange } }) => (
                  <Form.Item>
                    <Form.Label>Message</Form.Label>
                    <Form.Control>
                      <CaptionInputWithSuggestions
                        value={value || ""}
                        onChange={onChange}
                        placeholder="Say something about this post... Use # for hashtags and @ for mentions"
                        platform="facebook"
                      />
                    </Form.Control>
                    <Form.ErrorMessage />
                  </Form.Item>
                )}
              />

              {postType === "feed" && (
                <Form.Field
                  control={control}
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

              {postType === "photo" && (
                <Form.Field
                  control={control}
                  name="media_urls"
                  render={({ field: { value, onChange } }) => {
                    const urls = Array.isArray(value) ? value : []
                    return (
                      <Form.Item>
                        <Form.Label>Media</Form.Label>
                        <div className="mt-2 flex flex-wrap items-center gap-3">
                          {urls.map((url, index) => (
                            <div key={index} className="relative h-20 w-20 overflow-hidden rounded-md border">
                              <img src={url} alt={`Selected media ${index + 1}`} className="h-full w-full object-cover" />
                              <div className="absolute top-1 right-1 flex items-center justify-center rounded-full bg-white/50 p-0.5">
                                <XMark
                                  className="text-ui-fg-muted hover:text-ui-fg-subtle cursor-pointer"
                                  onClick={() => onChange(urls.filter((u) => u !== url))}
                                />
                              </div>
                            </div>
                          ))}
                          <FileModal
                            onSave={(picked: string[]) => {
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
            </div>
          )}

          {/* FBINSTA Post */}
          {isFBINSTA && (
            <div className="flex flex-col gap-y-6">
              <Form.Field
                control={control}
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
                control={control}
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
                          <Select.Item value="photo">📷 Photo</Select.Item>
                        </Select.Content>
                      </Select>
                    </Form.Control>
                    <Text size="small" className="text-ui-fg-subtle mt-1">
                      Note: Only photo posts are currently supported.
                    </Text>
                    <Form.ErrorMessage />
                  </Form.Item>
                )}
              />

              {(publishTarget === "facebook" || publishTarget === "both") && (
                <Form.Field
                  control={control}
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

              {(publishTarget === "instagram" || publishTarget === "both") && (
                <Form.Field
                  control={control}
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

              <Form.Field
                control={control}
                name="message"
                render={({ field: { value, onChange } }) => (
                  <Form.Item>
                    <Form.Label>Message/Caption</Form.Label>
                    <Form.Control>
                      <CaptionInputWithSuggestions
                        value={value || ""}
                        onChange={onChange}
                        placeholder="Write your message (will be used for both platforms)... Use # for hashtags and @ for mentions"
                        platform="all"
                      />
                    </Form.Control>
                    <Form.ErrorMessage />
                  </Form.Item>
                )}
              />

              {postType === "photo" && (
                <Form.Field
                  control={control}
                  name="media_urls"
                  render={({ field: { value, onChange } }) => {
                    const urls = Array.isArray(value) ? value : []
                    return (
                      <Form.Item>
                        <Form.Label>Media</Form.Label>
                        <div className="mt-2 flex flex-wrap items-center gap-3">
                          {urls.map((url, index) => (
                            <div key={index} className="relative h-20 w-20 overflow-hidden rounded-md border">
                              <img src={url} alt={`Selected media ${index + 1}`} className="h-full w-full object-cover" />
                              <div className="absolute top-1 right-1 flex items-center justify-center rounded-full bg-white/50 p-0.5">
                                <XMark
                                  className="text-ui-fg-muted hover:text-ui-fg-subtle cursor-pointer"
                                  onClick={() => onChange(urls.filter((u) => u !== url))}
                                />
                              </div>
                            </div>
                          ))}
                          <FileModal
                            onSave={(picked: string[]) => {
                              const next = Array.isArray(picked) ? picked.slice(0, 10) : []
                              onChange(next)
                            }}
                            initialUrls={urls}
                          />
                        </div>
                        <Text size="small" className="text-ui-fg-subtle mt-2">
                          Select 1-10 images. Single image = photo post, multiple images = carousel/album.
                        </Text>
                        <Form.ErrorMessage />
                      </Form.Item>
                    )
                  }}
                />
              )}

              <Form.Field
                control={control}
                name="auto_publish"
                render={({ field: { value, onChange } }) => (
                  <Form.Item>
                    <Form.Label>Auto Publish</Form.Label>
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

          {/* Instagram Post */}
          {isInstagram && (
            <div className="flex flex-col gap-y-6">
              <Form.Field
                control={control}
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
                          <Select.Item value="photo">📷 Photo</Select.Item>
                          <Select.Item value="reel">🎬 Reel (video)</Select.Item>
                        </Select.Content>
                      </Select>
                    </Form.Control>
                    <Form.ErrorMessage />
                  </Form.Item>
                )}
              />

              <Form.Field
                control={control}
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

              <Form.Field
                control={control}
                name="message"
                render={({ field: { value, onChange } }) => (
                  <Form.Item>
                    <Form.Label>Caption</Form.Label>
                    <Form.Control>
                      <CaptionInputWithSuggestions
                        value={value || ""}
                        onChange={onChange}
                        placeholder="Write a caption... Use # for hashtags and @ for mentions"
                        platform="instagram"
                      />
                    </Form.Control>
                    <Form.ErrorMessage />
                  </Form.Item>
                )}
              />

              <Form.Field
                control={control}
                name="media_urls"
                render={({ field: { value, onChange } }) => {
                  const urls = Array.isArray(value) ? value : []
                  return (
                    <Form.Item>
                      <Form.Label>Media</Form.Label>
                      <div className="mt-2 flex flex-wrap items-center gap-3">
                        {urls.map((url, index) => (
                          <div key={index} className="relative h-20 w-20 overflow-hidden rounded-md border">
                            <img src={url} alt={`Selected media ${index + 1}`} className="h-full w-full object-cover" />
                            <div className="absolute top-1 right-1 flex items-center justify-center rounded-full bg-white/50 p-0.5">
                              <XMark
                                className="text-ui-fg-muted hover:text-ui-fg-subtle cursor-pointer"
                                onClick={() => onChange(urls.filter((u) => u !== url))}
                              />
                            </div>
                          </div>
                        ))}
                        <FileModal
                          onSave={(picked: string[]) => {
                            const next = Array.isArray(picked) ? picked.slice(0, 10) : []
                            onChange(next)
                          }}
                          initialUrls={urls}
                        />
                      </div>
                      <Text size="small" className="text-ui-fg-subtle mt-2">
                        {postType === "photo"
                          ? "Select 1-10 images for carousel"
                          : "Select exactly one video for reel"}
                      </Text>
                      <Form.ErrorMessage />
                    </Form.Item>
                  )
                }}
              />
            </div>
          )}

          {/* Twitter/X Post */}
          {isTwitter && (
            <div className="flex flex-col gap-y-6">
              <div className="rounded-md border border-ui-border-base bg-ui-bg-subtle p-4">
                <div className="flex items-start gap-2">
                  <span className="text-2xl">🐦</span>
                  <div>
                    <Heading level="h3">Twitter/X Post</Heading>
                    <Text size="small" className="text-ui-fg-subtle mt-1">
                      Create engaging tweets with text and media. Character limit: 280 characters.
                    </Text>
                  </div>
                </div>
              </div>

              <Form.Field
                control={control}
                name="message"
                render={({ field: { value, onChange } }) => (
                  <Form.Item>
                    <Form.Label>Tweet Content</Form.Label>
                    <Form.Control>
                      <CaptionInputWithSuggestions
                        value={value || ""}
                        onChange={onChange}
                        placeholder="What's happening? Use # for hashtags and @ for mentions"
                        platform="twitter"
                      />
                    </Form.Control>
                    <div className="flex items-center justify-between mt-1">
                      <Text size="xsmall" className="text-ui-fg-subtle">
                        💡 Tip: Keep it concise and engaging
                      </Text>
                      <Text 
                        size="xsmall" 
                        className={`font-medium ${
                          (value?.length || 0) > 280 ? "text-ui-fg-error" : 
                          (value?.length || 0) > 260 ? "text-ui-fg-warning" : 
                          "text-ui-fg-subtle"
                        }`}
                      >
                        {value?.length || 0} / 280
                      </Text>
                    </div>
                    <Form.ErrorMessage />
                  </Form.Item>
                )}
              />

              <Form.Field
                control={control}
                name="media_urls"
                render={({ field: { value, onChange } }) => {
                  const urls = Array.isArray(value) ? value : []
                  return (
                    <Form.Item>
                      <Form.Label>Media (Optional)</Form.Label>
                      <div className="mt-2 flex flex-wrap items-center gap-3">
                        {urls.map((url, index) => (
                          <div key={index} className="relative h-24 w-24 overflow-hidden rounded-lg border border-ui-border-base">
                            <img src={url} alt={`Media ${index + 1}`} className="h-full w-full object-cover" />
                            <div className="absolute top-1 right-1 flex items-center justify-center rounded-full bg-ui-bg-base shadow-md p-1">
                              <XMark
                                className="h-4 w-4 text-ui-fg-muted hover:text-ui-fg-error cursor-pointer transition-colors"
                                onClick={() => onChange(urls.filter((u) => u !== url))}
                              />
                            </div>
                          </div>
                        ))}
                        {urls.length < 4 && (
                          <FileModal
                            onSave={(picked: string[]) => {
                              // Twitter allows up to 4 images
                              const next = Array.isArray(picked) ? picked.slice(0, 4) : []
                              onChange(next)
                            }}
                            initialUrls={urls}
                          />
                        )}
                      </div>
                      <Text size="small" className="text-ui-fg-subtle mt-2">
                        📸 Add up to 4 images or 1 video. Images will be displayed in a grid.
                      </Text>
                      <Form.ErrorMessage />
                    </Form.Item>
                  )
                }}
              />

              <Form.Field
                control={control}
                name="auto_publish"
                render={({ field: { value, onChange } }) => (
                  <Form.Item>
                    <Form.Label>Auto Publish</Form.Label>
                    <Form.Control>
                      <div className="flex items-center gap-x-2">
                        <Switch checked={!!value} onCheckedChange={onChange} />
                        <Text size="small" className="text-ui-fg-subtle">
                          Post immediately after creation
                        </Text>
                      </div>
                    </Form.Control>
                    <Form.ErrorMessage />
                  </Form.Item>
                )}
              />

              <div className="rounded-md border border-ui-border-base bg-ui-bg-subtle p-4">
                <Text size="small" className="text-ui-fg-subtle">
                  <strong>Twitter Best Practices:</strong>
                  <ul className="mt-2 space-y-1 list-disc list-inside">
                    <li>Keep tweets under 280 characters</li>
                    <li>Use 1-2 relevant hashtags</li>
                    <li>Add engaging visuals for better reach</li>
                    <li>Ask questions to encourage engagement</li>
                  </ul>
                </Text>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Right Side - Preview */}
      <div className="w-[400px] border-l bg-ui-bg-subtle overflow-y-auto">
        <SocialPostPreview
          platformName={platformName}
          postName={name || "Untitled Post"}
          message={message || ""}
          mediaUrls={mediaUrls || []}
          postType={postType}
          userProfile={userProfile}
        />
      </div>
    </div>
  )
}
