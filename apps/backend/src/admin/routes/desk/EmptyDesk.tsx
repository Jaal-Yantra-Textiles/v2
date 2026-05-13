import { Container, Heading, Text } from "@medusajs/ui"
import { EntityPickerGrid, type EntityKey } from "./EntityPicker"

/**
 * Centered empty state shown when the workspace has no tabs. Mirrors
 * the visual of the existing /operations + /content hub pages so it
 * feels native to the admin.
 */
export const EmptyDesk = ({
  onSelect,
}: {
  onSelect: (key: EntityKey) => void
}) => (
  <div className="flex items-center justify-center h-full p-6">
    <Container className="max-w-2xl w-full p-0">
      <div className="px-6 py-4 border-b border-ui-border-base">
        <Heading>Open a workspace tab</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          Pick what you want to work on. Each tab is its own routing
          context — you can open several side by side and drag them to
          split.
        </Text>
      </div>
      <div className="px-6 py-4">
        <EntityPickerGrid onSelect={onSelect} />
      </div>
    </Container>
  </div>
)
