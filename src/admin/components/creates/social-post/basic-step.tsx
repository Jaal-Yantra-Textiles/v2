import { Input, Select } from "@medusajs/ui"
import { Control } from "react-hook-form"
import { Form } from "../../common/form"
import { CreateSocialPostForm } from "./types"

interface BasicStepProps {
  control: Control<CreateSocialPostForm>
  platforms: Array<{ id: string; name: string }>
  isPlatformsLoading: boolean
  onPlatformChange: (platformId: string, platformName: string) => void
}

export const SocialPostBasicStep = ({ 
  control, 
  platforms, 
  isPlatformsLoading,
  onPlatformChange 
}: BasicStepProps) => {
  return (
    <div className="flex flex-col items-center p-16">
      <div className="flex w-full max-w-[720px] flex-col gap-y-8">
        <div>
          <h2 className="text-xl font-semibold">Basic Information</h2>
          <p className="text-sm text-ui-fg-subtle mt-2">
            Start by giving your post a name and selecting the platform.
          </p>
        </div>

        <Form.Field
          control={control}
          name="name"
          render={({ field }) => (
            <Form.Item>
              <Form.Label>Post Name</Form.Label>
              <Form.Control>
                <Input {...field} placeholder="e.g. Summer Sale Post" />
              </Form.Control>
              <Form.Hint>
                Internal name to identify this post in your dashboard
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
      </div>
    </div>
  )
}
