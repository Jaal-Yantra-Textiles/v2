import { Input, Switch, Text } from "@medusajs/ui"
import type { Control } from "react-hook-form"
import { useWatch } from "react-hook-form"
import { Form } from "../common/form"
import {
  IG_CAPTION_MAX_CHARS,
  IG_CAPTION_MAX_HASHTAGS,
  countHashtags,
} from "../../../modules/social-provider/reel"

/**
 * Instagram Reels options, stored on the post as `metadata.reel` and sent to
 * Instagram with the Reel: show on the profile grid, a cover image, or the
 * cover frame. All optional — Instagram picks sensible defaults.
 */
export const ReelOptionsFields = ({ control }: { control: Control<any> }) => (
  <div className="flex flex-col gap-y-4 rounded-md border border-ui-border-base bg-ui-bg-subtle px-4 py-3">
    <Text size="small" leading="compact" weight="plus">
      Reel options
    </Text>

    <Form.Field
      control={control}
      name="reel_share_to_feed"
      render={({ field: { value, onChange } }) => (
        <Form.Item>
          <Form.Control>
            <div className="flex items-center gap-x-2">
              <Switch checked={value !== false} onCheckedChange={onChange} />
              <Text size="small" leading="compact">
                Also show on the profile grid
              </Text>
            </div>
          </Form.Control>
          <Text size="small" leading="compact" className="text-ui-fg-subtle">
            Off: the Reel appears only in the Reels tab.
          </Text>
        </Form.Item>
      )}
    />

    <Form.Field
      control={control}
      name="reel_cover_url"
      render={({ field }) => (
        <Form.Item>
          <Form.Label optional>Cover image URL</Form.Label>
          <Form.Control>
            <Input size="small" placeholder="https://automatic.jaalyantra.com/…" {...field} value={field.value || ""} />
          </Form.Control>
          <Form.ErrorMessage />
        </Form.Item>
      )}
    />

    <Form.Field
      control={control}
      name="reel_thumb_offset_s"
      render={({ field: { value, onChange } }) => (
        <Form.Item>
          <Form.Label optional>Cover frame (seconds into the video)</Form.Label>
          <Form.Control>
            <Input
              size="small"
              type="number"
              min={0}
              step={0.5}
              placeholder="e.g. 2"
              value={value ?? ""}
              onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
            />
          </Form.Control>
          <Text size="small" leading="compact" className="text-ui-fg-subtle">
            Used when there is no cover image.
          </Text>
          <Form.ErrorMessage />
        </Form.Item>
      )}
    />

    <Text size="small" leading="compact" className="text-ui-fg-subtle">
      Instagram processes a Reel before it goes live. If that takes longer than a minute, the post shows as
      “Reel processing” and publishes on its own within a few minutes.
    </Text>
  </div>
)

/** Live count against Instagram's caption limits. */
export const InstagramCaptionLimits = ({ control }: { control: Control<any> }) => {
  const caption = (useWatch({ control, name: "message" }) as string) || ""
  const chars = [...caption].length
  const tags = countHashtags(caption)
  const over = chars > IG_CAPTION_MAX_CHARS || tags > IG_CAPTION_MAX_HASHTAGS
  return (
    <Text
      size="small"
      leading="compact"
      className={over ? "text-ui-fg-error" : "text-ui-fg-subtle"}
    >
      Instagram: {chars.toLocaleString()}/{IG_CAPTION_MAX_CHARS.toLocaleString()} characters · {tags}/
      {IG_CAPTION_MAX_HASHTAGS} hashtags
    </Text>
  )
}
