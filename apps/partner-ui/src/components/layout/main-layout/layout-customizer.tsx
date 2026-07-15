import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core"
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { Check, DotsSix, Eye, EyeSlash } from "@medusajs/icons"
import { Button, IconButton, Text, clx, toast } from "@medusajs/ui"
import { useMemo, useState } from "react"
import { useTranslation } from "react-i18next"

import {
  useResetPartnerLayoutConfiguration,
  useSetPartnerLayoutConfiguration,
  type LayoutPreference,
  type SidebarPreset,
} from "../../../hooks/api/layout-preferences"

/** A composable item in any layout zone (a nav route, a page section, a tab…). */
export type LayoutCustomizerItem = {
  id: string
  label: string
  icon?: React.ReactNode
}

type LayoutCustomizerProps = {
  /** The zone being edited, e.g. "sidebar.main" or "home". */
  zone: string
  /** All composable items for the zone (including currently-hidden ones). */
  items: LayoutCustomizerItem[]
  /** The partner's saved personal widget overrides for this zone. */
  widgets: LayoutPreference["widgets"]
  /** The preset — bootstrap order/visibility before personal edits. */
  preset: SidebarPreset
  /** Leave edit mode. */
  onClose: () => void
}

/**
 * #338 — the generic layout personalization editor: drag to reorder, click the
 * eye to hide/show, for ANY zone (sidebar, home dashboard sections, tab strips…).
 * Persists the arrangement as the partner's personal layout configuration
 * (`/partners/layouts/:zone/configuration`) using the composer's
 * `LayoutPreference { widgets: { id: { hidden, order } } }` contract.
 *
 * A flat vertical sortable, shared by the sidebar and every page surface.
 */
export const LayoutCustomizer = ({
  zone,
  items,
  widgets,
  preset,
  onClose,
}: LayoutCustomizerProps) => {
  const { t } = useTranslation()

  const itemById = useMemo(() => {
    const m = new Map<string, LayoutCustomizerItem>()
    for (const it of items) m.set(it.id, it)
    return m
  }, [items])

  // Seed the draft with the same precedence as the surface:
  // personal override → preset → natural (index/visible).
  const [orderedIds, setOrderedIds] = useState<string[]>(() =>
    items
      .map((it, index) => ({
        id: it.id,
        order: widgets[it.id]?.order ?? preset[it.id]?.order ?? index,
      }))
      .sort((a, b) => a.order - b.order)
      .map((x) => x.id)
  )
  const [hiddenSet, setHiddenSet] = useState<Set<string>>(
    () =>
      new Set(
        items
          .filter((it) => widgets[it.id]?.hidden ?? preset[it.id]?.hidden ?? false)
          .map((it) => it.id)
      )
  )

  const { mutate: saveLayout, isPending: isSaving } =
    useSetPartnerLayoutConfiguration(zone, {
      onSuccess: () => {
        toast.success(t("app.nav.customize.saved"))
        onClose()
      },
      onError: (e) => toast.error(e.message),
    })
  const { mutate: resetLayout, isPending: isResetting } =
    useResetPartnerLayoutConfiguration(zone, {
      onSuccess: () => {
        toast.success(t("app.nav.customize.reset"))
        onClose()
      },
      onError: (e) => toast.error(e.message),
    })

  const sensors = useSensors(
    // Small activation distance so a click on the eye toggle isn't read as a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    setOrderedIds((ids) => {
      const from = ids.indexOf(String(active.id))
      const to = ids.indexOf(String(over.id))
      if (from === -1 || to === -1) return ids
      return arrayMove(ids, from, to)
    })
  }

  const toggleHidden = (id: string) => {
    setHiddenSet((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleSave = () => {
    const nextWidgets: LayoutPreference["widgets"] = {}
    orderedIds.forEach((id, index) => {
      nextWidgets[id] = { order: index, hidden: hiddenSet.has(id) }
    })
    saveLayout({ configuration: { widgets: nextWidgets } })
  }

  const busy = isSaving || isResetting

  return (
    <div className="flex flex-col gap-y-2">
      <div className="flex items-center justify-between px-1">
        <Text size="xsmall" weight="plus" className="text-ui-fg-subtle">
          {t("app.nav.customize.title")}
        </Text>
        <button
          type="button"
          onClick={() => resetLayout()}
          disabled={busy}
          className="text-ui-fg-muted hover:text-ui-fg-subtle text-xs disabled:opacity-50"
        >
          {t("app.nav.customize.resetAction")}
        </button>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={orderedIds} strategy={verticalListSortingStrategy}>
          <div className="flex flex-col gap-y-1">
            {orderedIds.map((id) => {
              const item = itemById.get(id)
              if (!item) return null
              return (
                <SortableCustomizerRow
                  key={id}
                  id={id}
                  icon={item.icon}
                  label={item.label}
                  hidden={hiddenSet.has(id)}
                  onToggleHidden={() => toggleHidden(id)}
                />
              )
            })}
          </div>
        </SortableContext>
      </DndContext>

      <div className="flex items-center justify-end gap-x-2 px-1 pt-1">
        <Button size="small" variant="secondary" onClick={onClose} disabled={busy}>
          {t("app.nav.customize.cancel")}
        </Button>
        <Button size="small" variant="primary" onClick={handleSave} isLoading={isSaving} disabled={busy}>
          <Check className="mr-1" />
          {t("app.nav.customize.save")}
        </Button>
      </div>
    </div>
  )
}

type SortableCustomizerRowProps = {
  id: string
  icon?: React.ReactNode
  label: string
  hidden: boolean
  onToggleHidden: () => void
}

const SortableCustomizerRow = ({
  id,
  icon,
  label,
  hidden,
  onToggleHidden,
}: SortableCustomizerRowProps) => {
  const { t } = useTranslation()
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id })

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={clx(
        "bg-ui-bg-base ring-ui-border-base flex items-center gap-x-2 rounded-md px-2 py-1.5 ring-1 transition-opacity",
        hidden && "opacity-40",
        isDragging && "shadow-elevation-card-rest z-10"
      )}
    >
      <button
        type="button"
        className="text-ui-fg-muted cursor-grab touch-none rounded focus:outline-none"
        {...attributes}
        {...listeners}
        aria-label={t("app.nav.customize.dragToReorder")}
      >
        <DotsSix />
      </button>
      {icon && <span className="text-ui-fg-subtle [&>svg]:h-4 [&>svg]:w-4">{icon}</span>}
      <Text size="small" leading="compact" className="flex-1 truncate">
        {label}
      </Text>
      <IconButton
        size="2xsmall"
        variant="transparent"
        onClick={onToggleHidden}
        aria-label={hidden ? t("app.nav.customize.show") : t("app.nav.customize.hide")}
      >
        {hidden ? <EyeSlash /> : <Eye />}
      </IconButton>
    </div>
  )
}
