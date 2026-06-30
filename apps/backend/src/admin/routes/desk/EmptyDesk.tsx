import { EntityPickerGrid, type EntityKey } from "./EntityPicker"

/**
 * Empty state shown when the workspace has no tabs.
 *
 * Renders only the entity-picker grid — NOT its own `<Container>` or heading.
 * It sits inside the Desk page-level `<Container>` (see page.tsx), which now
 * carries the "Open a workspace tab" heading; wrapping it again stacked two
 * `shadow-elevation-card-rest` cards (a card-in-a-card) that read as two
 * overlapping containers. The grid is centered in the available area so the
 * spacing above and below it is equal.
 */
export const EmptyDesk = ({
  onSelect,
  onOpenCore,
}: {
  onSelect: (key: EntityKey) => void
  onOpenCore?: (path: string) => void
}) => (
  <div className="flex items-center justify-center h-full p-6">
    <div className="max-w-2xl w-full">
      <EntityPickerGrid onSelect={onSelect} onOpenCore={onOpenCore} />
    </div>
  </div>
)
