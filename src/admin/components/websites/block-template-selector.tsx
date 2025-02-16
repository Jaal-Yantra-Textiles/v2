import { Plus } from "@medusajs/icons"
import { DropdownMenu, IconButton } from "@medusajs/ui"
import { blockTemplates } from "./block-templates"

interface BlockTemplateSelectorProps {
  onSelect: (type: keyof typeof blockTemplates) => void
}

export function BlockTemplateSelector({ onSelect }: BlockTemplateSelectorProps) {
  return (
    <DropdownMenu>
      <DropdownMenu.Trigger asChild>
        <IconButton>
          <Plus />
        </IconButton>
      </DropdownMenu.Trigger>
      <DropdownMenu.Content>
        {Object.entries(blockTemplates).map(([type, _]) => (
          <DropdownMenu.Item 
            key={type}
            className="gap-x-2"
            onClick={() => onSelect(type as keyof typeof blockTemplates)}
          >
            <Plus className="text-ui-fg-subtle" />
            {type}
          </DropdownMenu.Item>
        ))}
      </DropdownMenu.Content>
    </DropdownMenu>
  )
}
