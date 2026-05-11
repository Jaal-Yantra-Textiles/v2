import { Select, Text } from "@medusajs/ui"
import { type AdsPlatformKind, useAdsPlatforms } from "../../../hooks/api/ads"

type Props = {
  value: string
  onChange: (platformId: string, kind: AdsPlatformKind) => void
}

/**
 * Top-bar dropdown listing every ads-capable SocialPlatform (Google + Meta).
 * On change, we fire both the platform_id (for the API) and the resolved
 * `kind` (so callers can render kind-specific copy without re-fetching).
 *
 * Picker is empty-state-aware: zero connected platforms shows guidance
 * rather than a useless empty dropdown.
 */
export const PlatformPicker = ({ value, onChange }: Props) => {
  const { data: platforms = [], isLoading } = useAdsPlatforms()

  if (!isLoading && platforms.length === 0) {
    return (
      <Text size="small" className="text-ui-fg-subtle">
        No ad platforms connected — connect Google or Meta in Settings → Social
        Platforms first.
      </Text>
    )
  }

  return (
    <Select
      value={value}
      onValueChange={(v) => {
        const match = platforms.find((p) => p.id === v)
        if (match) onChange(match.id, match.kind)
      }}
    >
      <Select.Trigger className="min-w-[220px]">
        <Select.Value placeholder={isLoading ? "Loading…" : "Select platform"} />
      </Select.Trigger>
      <Select.Content>
        {platforms.map((p) => (
          <Select.Item key={p.id} value={p.id}>
            <span className="flex items-center gap-2">
              <KindBadge kind={p.kind} />
              {p.name}
            </span>
          </Select.Item>
        ))}
      </Select.Content>
    </Select>
  )
}

const KindBadge = ({ kind }: { kind: AdsPlatformKind }) => {
  const label = kind === "google" ? "Google" : "Meta"
  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium ${
        kind === "google"
          ? "bg-ui-tag-blue-bg text-ui-tag-blue-text"
          : "bg-ui-tag-purple-bg text-ui-tag-purple-text"
      }`}
    >
      {label}
    </span>
  )
}
