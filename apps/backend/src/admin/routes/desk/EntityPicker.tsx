import { DropdownMenu, IconButton, Text } from "@medusajs/ui"
import { Plus } from "@medusajs/icons"
import { designsEntityConfig } from "./entities/designs"
import { productionRunsEntityConfig } from "./entities/production-runs"
import { partnersEntityConfig } from "./entities/partners"
import { mediasEntityConfig } from "./entities/medias"
import type { EntityPanelConfig } from "./EntityPanel"

export type EntityKey = "designs" | "production-runs" | "partners" | "medias"

export type EntityRegistryEntry = {
  label: string
  description: string
  config: EntityPanelConfig
}

export const ENTITY_REGISTRY: Record<EntityKey, EntityRegistryEntry> = {
  designs: {
    label: "Designs",
    description: "Design library, revisions, tasks, media.",
    config: designsEntityConfig,
  },
  "production-runs": {
    label: "Production Runs",
    description: "Run lifecycle, dispatch, cost, approvals.",
    config: productionRunsEntityConfig,
  },
  partners: {
    label: "Partners",
    description: "Manufacturing and supply partners, payments, feedback.",
    config: partnersEntityConfig,
  },
  medias: {
    label: "Medias",
    description: "Media library and uploads.",
    config: mediasEntityConfig,
  },
}

const ENTITY_ENTRIES = Object.entries(ENTITY_REGISTRY) as [
  EntityKey,
  EntityRegistryEntry,
][]

/**
 * Compact picker shown inside the FlexLayout tab strip — a "+" IconButton
 * that opens a DropdownMenu listing the four entities. Selecting one
 * fires `onSelect(key)`; the desk page is responsible for opening the
 * actual tab.
 */
export const EntityPickerDropdown = ({
  onSelect,
}: {
  onSelect: (key: EntityKey) => void
}) => (
  <DropdownMenu>
    <DropdownMenu.Trigger asChild>
      <IconButton
        size="small"
        variant="transparent"
        aria-label="Open new tab"
      >
        <Plus />
      </IconButton>
    </DropdownMenu.Trigger>
    <DropdownMenu.Content>
      <DropdownMenu.Label>New tab</DropdownMenu.Label>
      {ENTITY_ENTRIES.map(([key, entity]) => (
        <DropdownMenu.Item key={key} onClick={() => onSelect(key)}>
          {entity.label}
        </DropdownMenu.Item>
      ))}
    </DropdownMenu.Content>
  </DropdownMenu>
)

/**
 * Card grid shown when the workspace is empty. Each card is a click
 * target that opens the corresponding entity tab — same behaviour as
 * the dropdown picker, just with breathing room for first use.
 */
export const EntityPickerGrid = ({
  onSelect,
}: {
  onSelect: (key: EntityKey) => void
}) => (
  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
    {ENTITY_ENTRIES.map(([key, entity]) => (
      <button
        key={key}
        type="button"
        onClick={() => onSelect(key)}
        className="text-left shadow-elevation-card-rest bg-ui-bg-component hover:bg-ui-bg-component-hover rounded-lg p-5 transition-colors flex flex-col min-h-[110px] outline-none focus:shadow-borders-interactive-with-focus"
      >
        <Text size="base" leading="compact" weight="plus">
          {entity.label}
        </Text>
        <Text
          size="small"
          leading="compact"
          className="text-ui-fg-subtle mt-1 flex-1"
        >
          {entity.description}
        </Text>
      </button>
    ))}
  </div>
)
