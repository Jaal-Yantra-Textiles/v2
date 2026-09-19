import { Badge, Select, Text } from "@medusajs/ui"

import type { PartnerMoodboard } from "../../hooks/api/partner-designs"

/**
 * Pick which board to look at (#2017 / #2019).
 *
 * A design now has one board per OWNER — ours and each partner's — instead of
 * one blob everybody overwrote. That only means anything if you can see the
 * other ones, so this is the switcher, and it is the component that carries
 * the read-only distinction into the UI.
 *
 * Deliberately dumb: it takes boards and a selection and emits a selection.
 * The editor owns loading the scene, because "which board" and "what is on it"
 * fail differently and a switcher that also fetched would hide one behind the
 * other.
 */

export type BoardOption = PartnerMoodboard

export const boardLabel = (board: BoardOption): string => {
  if (board.title) {
    return board.title
  }
  if (board.is_legacy) {
    return "Shared board (before separate boards)"
  }
  if (board.owner_type === "core") {
    return "Jaal Yantra"
  }
  return board.is_own ? "Your board" : "Partner board"
}

export const BoardSwitcher = ({
  own,
  others,
  selectedId,
  onSelect,
  usedLegacyFallback,
}: {
  own: BoardOption | null
  others: BoardOption[]
  selectedId?: string | null
  onSelect: (board: BoardOption) => void
  usedLegacyFallback?: boolean
}) => {
  const all = [...(own ? [own] : []), ...others]

  // One board and it is yours: there is nothing to switch between, and a
  // select with a single option is furniture.
  if (all.length <= 1 && !usedLegacyFallback) {
    return null
  }

  const current = all.find((b) => b.id === selectedId) ?? all[0]

  return (
    <div className="flex flex-col gap-y-1">
      <div className="flex items-center gap-x-2">
        <Select
          size="small"
          value={current?.id}
          onValueChange={(id) => {
            const next = all.find((b) => b.id === id)
            if (next) {
              onSelect(next)
            }
          }}
        >
          <Select.Trigger className="w-64">
            <Select.Value placeholder="Select a board" />
          </Select.Trigger>
          <Select.Content>
            {all.map((b) => (
              <Select.Item key={b.id} value={b.id}>
                {boardLabel(b)}
              </Select.Item>
            ))}
          </Select.Content>
        </Select>

        {/*
          The one thing the partner must not have to infer. Editing someone
          else's board was the old behaviour — silently, with a 200 — so the
          read-only state is stated, not implied by a disabled cursor.
        */}
        {current && !current.is_own && (
          <Badge size="2xsmall" color="grey">
            View only
          </Badge>
        )}
      </div>

      {usedLegacyFallback && (
        <Text size="xsmall" className="text-ui-fg-subtle">
          This board was made before boards had owners, so it is shown as the
          shared one. Saving creates your own.
        </Text>
      )}
    </div>
  )
}
