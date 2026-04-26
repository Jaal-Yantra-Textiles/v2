import {
  defaultDropAnimationSideEffects,
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  DropAnimation,
  KeyboardSensor,
  PointerSensor,
  UniqueIdentifier,
  useSensor,
  useSensors,
} from "@dnd-kit/core"
import {
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
  SortableContext,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { Badge, Button, Checkbox, Input, Select, Text, Textarea, clx, toast } from "@medusajs/ui"
import { PlusMini, Trash } from "@medusajs/icons"
import { useMemo, useState } from "react"
import { AdminForm, AdminFormField } from "../../hooks/api/forms"

export type FormBuilderField = AdminFormField & {
  field_id: string
}

type FormBuilderProps = {
  form: AdminForm
  initialFields: FormBuilderField[]
  onSave: (fields: AdminFormField[]) => Promise<void>
  isSaving?: boolean
}

const FIELD_TYPES: Array<{ value: FormBuilderField["type"]; label: string }> = [
  { value: "text", label: "Text" },
  { value: "email", label: "Email" },
  { value: "textarea", label: "Textarea" },
  { value: "number", label: "Number" },
  { value: "select", label: "Select" },
  { value: "checkbox", label: "Checkbox" },
  { value: "radio", label: "Radio" },
  { value: "date", label: "Date" },
  { value: "phone", label: "Phone" },
  { value: "url", label: "URL" },
]

const makeNameFromLabel = (label: string) =>
  label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")

const getDefaultField = (type: FormBuilderField["type"]): FormBuilderField => {
  const id = crypto.randomUUID()
  return {
    field_id: id,
    type,
    name: "",
    label: "",
    required: false,
    placeholder: null,
    help_text: null,
    options: null,
    validation: null,
    metadata: null,
    order: 0,
  }
}

export const FormBuilder = ({ form, initialFields, onSave, isSaving }: FormBuilderProps) => {
  const [fields, setFields] = useState<FormBuilderField[]>(initialFields)
  const [activeId, setActiveId] = useState<UniqueIdentifier | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(initialFields[0]?.field_id || null)

  const selected = useMemo(
    () => fields.find((f) => f.field_id === selectedId) || null,
    [fields, selectedId]
  )

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  const handleAdd = (type: FormBuilderField["type"]) => {
    const next = [...fields, getDefaultField(type)]
    setFields(next)
    setSelectedId(next[next.length - 1].field_id)
  }

  const handleDelete = (field_id: string) => {
    const next = fields.filter((f) => f.field_id !== field_id)
    setFields(next)
    if (selectedId === field_id) {
      setSelectedId(next[0]?.field_id || null)
    }
  }

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id)
  }

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveId(null)
    const { active, over } = event

    if (!over) {
      return
    }

    if (active.id !== over.id) {
      const oldIndex = fields.findIndex((item) => item.field_id === active.id)
      const newIndex = fields.findIndex((item) => item.field_id === over.id)
      setFields(arrayMove(fields, oldIndex, newIndex))
    }
  }

  const handleSave = async () => {
    const normalized = fields.map((f, idx) => {
      const name = (f.name || "").trim() || makeNameFromLabel(f.label || "")
      return {
        name,
        label: (f.label || "").trim(),
        type: f.type,
        required: !!f.required,
        placeholder: f.placeholder ?? null,
        help_text: f.help_text ?? null,
        options: (f.options as any) ?? null,
        validation: (f.validation as any) ?? null,
        order: idx,
        metadata: (f.metadata as any) ?? null,
      } as AdminFormField
    })

    const invalid = normalized.find((f) => !f.name || !f.label)
    if (invalid) {
      toast.error("Each field must have a name and label")
      return
    }

    await onSave(normalized)
  }

  const updateSelected = (patch: Partial<FormBuilderField>) => {
    if (!selected) {
      return
    }

    setFields((prev) =>
      prev.map((f) => (f.field_id === selected.field_id ? { ...f, ...patch } : f))
    )
  }

  return (
    <div className="flex h-full">
      <div className="w-64 border-r bg-ui-bg-subtle overflow-y-auto">
        <div className="p-4 border-b">
          <Text weight="plus">Field types</Text>
          <Text size="small" className="text-ui-fg-subtle">
            Add fields to {form.title}
          </Text>
        </div>
        <div className="p-4 flex flex-col gap-y-2">
          {FIELD_TYPES.map((t) => (
            <Button
              key={t.value}
              size="small"
              variant="secondary"
              onClick={() => handleAdd(t.value)}
            >
              <PlusMini className="mr-1" />
              {t.label}
            </Button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="flex items-center justify-between border-b px-6 py-4">
          <div className="flex items-center gap-x-2">
            <Text weight="plus">Builder</Text>
            <Badge size="2xsmall">{fields.length}</Badge>
          </div>
          <Button
            size="small"
            variant="primary"
            onClick={handleSave}
            isLoading={isSaving}
          >
            Save
          </Button>
        </div>

        <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
          <div className="p-6">
            <SortableContext items={fields.map((f) => f.field_id)} strategy={verticalListSortingStrategy}>
              <div className="flex flex-col gap-y-2">
                {fields.map((f) => (
                  <SortableFieldRow
                    key={f.field_id}
                    field={f}
                    selected={f.field_id === selectedId}
                    onSelect={() => setSelectedId(f.field_id)}
                    onDelete={() => handleDelete(f.field_id)}
                  />
                ))}
              </div>
            </SortableContext>

            <DragOverlay dropAnimation={dropAnimationConfig}>
              {activeId
                ? (() => {
                    const f = fields.find((x) => x.field_id === activeId)
                    if (!f) return null
                    return <FieldRowOverlay field={f} />
                  })()
                : null}
            </DragOverlay>
          </div>
        </DndContext>
      </div>

      <div className="w-96 border-l bg-ui-bg-subtle overflow-y-auto">
        {!selected ? (
          <div className="p-6">
            <Text className="text-ui-fg-subtle">Select a field to edit</Text>
          </div>
        ) : (
          <div className="p-6 flex flex-col gap-y-4">
            <Text weight="plus">Field</Text>

            <div className="grid gap-y-2">
              <Text size="small" className="text-ui-fg-subtle">Label</Text>
              <Input
                value={selected.label || ""}
                onChange={(e) => updateSelected({ label: e.target.value })}
              />
            </div>

            <div className="grid gap-y-2">
              <Text size="small" className="text-ui-fg-subtle">Name</Text>
              <Input
                value={selected.name || ""}
                onChange={(e) => updateSelected({ name: e.target.value })}
              />
              <Text size="small" className="text-ui-fg-subtle">
                If empty, we auto-generate from label when saving.
              </Text>
            </div>

            <div className="grid gap-y-2">
              <Text size="small" className="text-ui-fg-subtle">Type</Text>
              <Select
                value={selected.type}
                onValueChange={(v) => updateSelected({ type: v as any })}
              >
                <Select.Trigger>
                  <Select.Value />
                </Select.Trigger>
                <Select.Content>
                  {FIELD_TYPES.map((t) => (
                    <Select.Item key={t.value} value={t.value}>
                      {t.label}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select>
            </div>

            <div className="flex items-center gap-x-2">
              <Checkbox
                checked={!!selected.required}
                onCheckedChange={(v) => updateSelected({ required: !!v })}
              />
              <Text size="small">Required</Text>
            </div>

            <div className="grid gap-y-2">
              <Text size="small" className="text-ui-fg-subtle">Placeholder</Text>
              <Input
                value={(selected.placeholder as any) || ""}
                onChange={(e) => updateSelected({ placeholder: e.target.value })}
              />
            </div>

            <div className="grid gap-y-2">
              <Text size="small" className="text-ui-fg-subtle">Help text</Text>
              <Textarea
                value={(selected.help_text as any) || ""}
                onChange={(e) => updateSelected({ help_text: e.target.value })}
              />
            </div>

            {(selected.type === "select" || selected.type === "radio") && (
              <div className="grid gap-y-2">
                <Text size="small" className="text-ui-fg-subtle">Options (one per line)</Text>
                <Textarea
                  value={getOptionsText(selected.options)}
                  onChange={(e) => updateSelected({ options: setOptionsFromText(e.target.value) })}
                />
              </div>
            )}

            <Button
              size="small"
              variant="secondary"
              onClick={() => handleDelete(selected.field_id)}
            >
              <Trash className="mr-1" />
              Delete field
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

const getOptionsText = (options: any) => {
  const choices = options?.choices
  if (!Array.isArray(choices)) {
    return ""
  }
  return choices
    .map((c: any) => (typeof c === "string" ? c : c?.label || c?.value || ""))
    .filter(Boolean)
    .join("\n")
}

const setOptionsFromText = (text: string) => {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
  if (!lines.length) {
    return null
  }
  return {
    choices: lines.map((l) => ({ label: l, value: makeNameFromLabel(l) || l })),
  }
}

type SortableFieldRowProps = {
  field: FormBuilderField
  selected: boolean
  onSelect: () => void
  onDelete: () => void
}

const SortableFieldRow = ({ field, selected, onSelect, onDelete }: SortableFieldRowProps) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: field.field_id,
  })

  const style = {
    opacity: isDragging ? 0.4 : undefined,
    transform: CSS.Transform.toString(transform),
    transition,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={clx(
        "rounded-lg border bg-ui-bg-base px-4 py-3 cursor-pointer",
        selected ? "border-ui-border-interactive" : "border-ui-border-base",
        isDragging && "shadow-elevation-card-rest"
      )}
      onClick={onSelect}
    >
      <div className="flex items-center justify-between gap-x-2">
        <div className="flex items-center gap-x-2">
          <div
            className="h-6 w-6 rounded bg-ui-bg-subtle flex items-center justify-center"
            {...attributes}
            {...listeners}
            onClick={(e) => e.stopPropagation()}
          >
            <Text size="small" className="text-ui-fg-subtle">::</Text>
          </div>
          <div className="flex flex-col">
            <Text size="small" weight="plus">
              {field.label || "(no label)"}
            </Text>
            <Text size="small" className="text-ui-fg-subtle">
              {field.type} {field.required ? "• required" : ""}
            </Text>
          </div>
        </div>
        <Button
          size="small"
          variant="secondary"
          onClick={(e) => {
            e.stopPropagation()
            onDelete()
          }}
        >
          Delete
        </Button>
      </div>
    </div>
  )
}

const FieldRowOverlay = ({ field }: { field: FormBuilderField }) => {
  return (
    <div className="rounded-lg border border-ui-border-base bg-ui-bg-base px-4 py-3 shadow-elevation-card-rest">
      <Text size="small" weight="plus">
        {field.label || "(no label)"}
      </Text>
      <Text size="small" className="text-ui-fg-subtle">
        {field.type}
      </Text>
    </div>
  )
}

const dropAnimationConfig: DropAnimation = {
  sideEffects: defaultDropAnimationSideEffects({
    styles: {
      active: {
        opacity: "0.5",
      },
    },
  }),
}
