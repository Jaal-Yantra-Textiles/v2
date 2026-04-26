import { useCallback, useState } from "react"
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core"
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { DropdownMenu } from "@medusajs/ui"
import {
  PlusMini,
  EllipsisHorizontal,
  SquaresPlusSolid,
  Photo,
  Newspaper,
  Component,
  Sparkles,
  ChatBubbleLeftRight,
  ShoppingCart,
  SquareTwoStack,
  CogSixTooth,
} from "@medusajs/icons"
import { AdminBlock, BlockType } from "../../../hooks/api/blocks"
import { blockTemplates } from "../../websites/block-templates"

interface BlockListPanelProps {
  blocks: AdminBlock[]
  selectedBlockId: string | null
  hoveredBlockId: string | null
  onBlockSelect: (blockId: string) => void
  onBlockHover: (blockId: string | null) => void
  onBlockReorder: (blocks: AdminBlock[]) => void
  onAddBlock: (blockData: { name: string; type: BlockType; content?: Record<string, unknown>; settings?: Record<string, unknown> }) => void
}

const BLOCK_TYPE_ICONS: Record<string, React.ElementType> = {
  Hero: Sparkles,
  Header: Newspaper,
  Footer: SquareTwoStack,
  Feature: SquaresPlusSolid,
  Gallery: Photo,
  Testimonial: ChatBubbleLeftRight,
  MainContent: Component,
  ContactForm: CogSixTooth,
  Product: ShoppingCart,
  Section: SquareTwoStack,
  Custom: Component,
}

export function BlockListPanel({
  blocks,
  selectedBlockId,
  hoveredBlockId,
  onBlockSelect,
  onBlockHover,
  onBlockReorder,
  onAddBlock,
}: BlockListPanelProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event

      if (over && active.id !== over.id) {
        const oldIndex = blocks.findIndex((b) => b.id === active.id)
        const newIndex = blocks.findIndex((b) => b.id === over.id)
        const reordered = arrayMove(blocks, oldIndex, newIndex).map((block, index) => ({
          ...block,
          order: index,
        }))
        onBlockReorder(reordered)
      }
    },
    [blocks, onBlockReorder]
  )

  const handleAddBlockFromTemplate = (type: keyof typeof blockTemplates) => {
    const template = blockTemplates[type]
    if (template) {
      onAddBlock({
        name: template.name,
        type: template.type as BlockType,
        content: template.content,
        settings: template.settings,
      })
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-ui-border-base">
        <div>
          <div className="text-ui-fg-base font-semibold text-sm">Blocks</div>
          <div className="text-ui-fg-muted text-xs">{blocks.length} blocks</div>
        </div>
      </div>

      {/* Block List */}
      <div className="visual-editor-panel-content">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={blocks.map((b) => b.id)}
            strategy={verticalListSortingStrategy}
          >
            {blocks.map((block) => (
              <SortableBlockItem
                key={block.id}
                block={block}
                isSelected={selectedBlockId === block.id}
                isHovered={hoveredBlockId === block.id}
                onSelect={() => onBlockSelect(block.id)}
                onHover={(hovered) => onBlockHover(hovered ? block.id : null)}
              />
            ))}
          </SortableContext>
        </DndContext>

        {/* Add Block Button */}
        <DropdownMenu>
          <DropdownMenu.Trigger asChild>
            <button className="w-full mt-3 px-3 py-2.5 border border-dashed border-ui-border-base rounded-md flex items-center justify-center gap-2 text-ui-fg-muted text-sm font-medium hover:border-ui-border-strong hover:text-ui-fg-subtle hover:bg-ui-bg-subtle transition-all">
              <PlusMini />
              Add Block
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Content className="w-48">
            <DropdownMenu.Label>Add Block</DropdownMenu.Label>
            <DropdownMenu.Separator />
            {Object.entries(blockTemplates).map(([key, template]) => {
              const Icon = BLOCK_TYPE_ICONS[template.type] || Component
              return (
                <DropdownMenu.Item
                  key={key}
                  onClick={() => handleAddBlockFromTemplate(key as keyof typeof blockTemplates)}
                >
                  <Icon className="mr-2" />
                  {template.name}
                </DropdownMenu.Item>
              )
            })}
          </DropdownMenu.Content>
        </DropdownMenu>
      </div>
    </div>
  )
}

interface SortableBlockItemProps {
  block: AdminBlock
  isSelected: boolean
  isHovered: boolean
  onSelect: () => void
  onHover: (hovered: boolean) => void
}

function SortableBlockItem({
  block,
  isSelected,
  isHovered,
  onSelect,
  onHover,
}: SortableBlockItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: block.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  const Icon = BLOCK_TYPE_ICONS[block.type] || Component

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-2.5 px-2.5 py-2 rounded-md cursor-pointer transition-all border mb-0.5 ${
        isSelected
          ? "bg-ui-bg-highlight border-ui-border-strong hover:bg-ui-bg-highlight-hover"
          : isHovered
          ? "bg-ui-bg-subtle border-ui-border-strong"
          : "bg-transparent border-transparent hover:bg-ui-bg-subtle"
      }`}
      onClick={onSelect}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
    >
      {/* Drag Handle */}
      <div
        className="opacity-0 hover:opacity-100 cursor-grab transition-opacity text-ui-fg-muted"
        {...attributes}
        {...listeners}
      >
        <EllipsisHorizontal />
      </div>

      {/* Icon */}
      <div className={`flex-shrink-0 ${
        isSelected ? "text-ui-fg-base" : "text-ui-fg-muted"
      }`}>
        <Icon />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate text-ui-fg-base">{block.name}</div>
        <div className="text-xs text-ui-fg-muted">{block.type}</div>
      </div>
    </div>
  )
}
