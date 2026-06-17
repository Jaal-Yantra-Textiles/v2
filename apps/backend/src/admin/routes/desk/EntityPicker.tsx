import { DropdownMenu, IconButton, Text } from "@medusajs/ui"
import {
  ArchiveBox,
  ArrowUpRightOnBox,
  Buildings,
  ChatBubbleLeftRight,
  Globe,
  Photo,
  Plus,
  ShoppingBag,
  Swatch,
  Tag,
  Tools,
  Trash,
  Users,
} from "@medusajs/icons"
import type { ComponentType } from "react"
import { designsEntityConfig } from "./entities/designs"
import { productionRunsEntityConfig } from "./entities/production-runs"
import { partnersEntityConfig } from "./entities/partners"
import { mediasEntityConfig } from "./entities/medias"
import { websitesEntityConfig } from "./entities/websites"
import { personsEntityConfig } from "./entities/persons"
import { messagingEntityConfig } from "./entities/messaging"
import type { EntityPanelConfig } from "./EntityPanel"

export type EntityKey =
  | "designs"
  | "production-runs"
  | "partners"
  | "medias"
  | "websites"
  | "persons"
  | "messaging"

type IconType = ComponentType<{ className?: string }>

export type EntityRegistryEntry = {
  label: string
  description: string
  icon: IconType
  config: EntityPanelConfig
}

export const ENTITY_REGISTRY: Record<EntityKey, EntityRegistryEntry> = {
  designs: {
    label: "Designs",
    description: "Design library, revisions, tasks, media.",
    icon: Swatch,
    config: designsEntityConfig,
  },
  "production-runs": {
    label: "Production Runs",
    description: "Run lifecycle, dispatch, cost, approvals.",
    icon: Tools,
    config: productionRunsEntityConfig,
  },
  partners: {
    label: "Partners",
    description: "Manufacturing and supply partners, payments, feedback.",
    icon: Buildings,
    config: partnersEntityConfig,
  },
  medias: {
    label: "Medias",
    description: "Media library and uploads.",
    icon: Photo,
    config: mediasEntityConfig,
  },
  websites: {
    label: "Websites",
    description: "Sites, pages, blog, analytics.",
    icon: Globe,
    config: websitesEntityConfig,
  },
  persons: {
    label: "People",
    description: "Person directory, contacts, addresses, agreements.",
    icon: Users,
    config: personsEntityConfig,
  },
  messaging: {
    label: "Messages",
    description: "Conversations and messaging.",
    icon: ChatBubbleLeftRight,
    config: messagingEntityConfig,
  },
}

const ENTITY_ENTRIES = Object.entries(ENTITY_REGISTRY) as [
  EntityKey,
  EntityRegistryEntry,
][]

/**
 * Medusa CORE entities. Their pages live in @medusajs/dashboard as
 * code-split chunks that depend on the core data-router + providers, so
 * they can't be mounted inside a Desk panel's MemoryRouter. We surface
 * them as deep-links that open in the full admin instead.
 */
export type CoreEntity = {
  label: string
  description: string
  icon: IconType
  /** Admin path, e.g. "/products" — opened on the shell router. */
  path: string
}

export const CORE_ENTITIES: CoreEntity[] = [
  { label: "Products", description: "Product catalog.", icon: Tag, path: "/products" },
  { label: "Orders", description: "Customer orders.", icon: ShoppingBag, path: "/orders" },
  { label: "Inventory", description: "Stock & locations.", icon: ArchiveBox, path: "/inventory" },
  { label: "Customers", description: "Customer accounts.", icon: Users, path: "/customers" },
]

/**
 * Compact picker shown inside the FlexLayout tab strip — a "+" IconButton
 * that opens a DropdownMenu listing the four entities. Selecting one
 * fires `onSelect(key)`; the desk page is responsible for opening the
 * actual tab.
 */
export const EntityPickerDropdown = ({
  onSelect,
  onOpenCore,
  onReset,
}: {
  onSelect: (key: EntityKey) => void
  /** Deep-link a Medusa core entity into the full admin. */
  onOpenCore?: (path: string) => void
  /**
   * Optional. When provided, shows a "Reset workspace" item below the
   * entity list. Used to clear local + server desk state when the layout
   * gets into a state the user wants to abandon.
   */
  onReset?: () => void
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
      {ENTITY_ENTRIES.map(([key, entity]) => {
        const Icon = entity.icon
        return (
          <DropdownMenu.Item
            key={key}
            onClick={() => onSelect(key)}
            className="gap-x-2"
          >
            <Icon className="text-ui-fg-subtle" />
            {entity.label}
          </DropdownMenu.Item>
        )
      })}
      {onOpenCore && (
        <>
          <DropdownMenu.Separator />
          <DropdownMenu.Label>Open in admin</DropdownMenu.Label>
          {CORE_ENTITIES.map((c) => {
            const Icon = c.icon
            return (
              <DropdownMenu.Item
                key={c.path}
                onClick={() => onOpenCore(c.path)}
                className="gap-x-2"
              >
                <Icon className="text-ui-fg-subtle" />
                {c.label}
                <ArrowUpRightOnBox className="text-ui-fg-muted ml-auto" />
              </DropdownMenu.Item>
            )
          })}
        </>
      )}
      {onReset && (
        <>
          <DropdownMenu.Separator />
          <DropdownMenu.Item
            onClick={onReset}
            className="text-ui-fg-error gap-x-2"
          >
            <Trash />
            Reset workspace
          </DropdownMenu.Item>
        </>
      )}
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
  onOpenCore,
}: {
  onSelect: (key: EntityKey) => void
  /** Deep-link a Medusa core entity into the full admin. */
  onOpenCore?: (path: string) => void
}) => (
  <div className="flex flex-col gap-y-4">
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {ENTITY_ENTRIES.map(([key, entity]) => {
        const Icon = entity.icon
        return (
          <button
            key={key}
            type="button"
            onClick={() => onSelect(key)}
            className="text-left shadow-elevation-card-rest bg-ui-bg-component hover:bg-ui-bg-component-hover rounded-lg p-5 transition-colors flex flex-col min-h-[110px] outline-none focus:shadow-borders-interactive-with-focus"
          >
            <div className="flex items-center gap-x-2">
              <Icon className="text-ui-fg-subtle" />
              <Text size="base" leading="compact" weight="plus">
                {entity.label}
              </Text>
            </div>
            <Text
              size="small"
              leading="compact"
              className="text-ui-fg-subtle mt-1 flex-1"
            >
              {entity.description}
            </Text>
          </button>
        )
      })}
    </div>
    {onOpenCore && (
      <div>
        <Text size="xsmall" leading="compact" className="text-ui-fg-muted mb-2">
          Open in full admin
        </Text>
        <div className="flex flex-wrap gap-2">
          {CORE_ENTITIES.map((c) => {
            const Icon = c.icon
            return (
              <button
                key={c.path}
                type="button"
                onClick={() => onOpenCore(c.path)}
                className="flex items-center gap-x-2 rounded-lg border border-ui-border-base bg-ui-bg-subtle hover:bg-ui-bg-subtle-hover px-3 py-2 text-ui-fg-subtle hover:text-ui-fg-base transition-colors outline-none focus:shadow-borders-interactive-with-focus"
              >
                <Icon />
                <Text size="small" leading="compact">
                  {c.label}
                </Text>
                <ArrowUpRightOnBox className="text-ui-fg-muted" />
              </button>
            )
          })}
        </div>
      </div>
    )}
  </div>
)
