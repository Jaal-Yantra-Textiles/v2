import { useState, useRef, useEffect } from "react"
import { useParams } from "react-router-dom"
import { Button, Heading, Input, Select, Text, toast } from "@medusajs/ui"
import { CheckMini, XMark } from "@medusajs/icons"
import { RouteFocusModal } from "../../../../components/modal/route-focus-modal"
import { useRouteModal } from "../../../../components/modal/use-route-modal"
import { useDesigns, useAddDesignComponent, AdminDesign } from "../../../../hooks/api/designs"

const ROLE_OPTIONS = [
  { label: "Embroidery", value: "embroidery" },
  { label: "Lining", value: "lining" },
  { label: "Trim", value: "trim" },
  { label: "Main Fabric", value: "main_fabric" },
  { label: "Print", value: "print" },
  { label: "Patch", value: "patch" },
  { label: "Other", value: "other" },
]

const AddComponentForm = ({ designId }: { designId: string }) => {
  const { handleSuccess } = useRouteModal()

  const [search, setSearch] = useState("")
  const [showDropdown, setShowDropdown] = useState(false)
  const [selectedDesign, setSelectedDesign] = useState<AdminDesign | null>(null)
  const [quantity, setQuantity] = useState(1)
  const [role, setRole] = useState("")
  const [notes, setNotes] = useState("")
  const dropdownRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const { designs, isLoading: searching } = useDesigns({
    q: search || undefined,
    limit: 10,
  })

  const { mutateAsync: addComponent, isPending } = useAddDesignComponent(designId)

  const filteredDesigns = designs.filter((d) => d.id !== designId)

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false)
      }
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [])

  const handleSelect = (design: AdminDesign) => {
    setSelectedDesign(design)
    setSearch("")
    setShowDropdown(false)
  }

  const handleClearSelection = () => {
    setSelectedDesign(null)
    setSearch("")
    setTimeout(() => inputRef.current?.focus(), 0)
  }

  const handleAdd = async () => {
    if (!selectedDesign) {
      toast.error("Please select a design")
      return
    }
    try {
      await addComponent({
        component_design_id: selectedDesign.id,
        quantity,
        role: role || undefined,
        notes: notes || undefined,
      })
      toast.success("Component added")
      handleSuccess()
    } catch (e: any) {
      toast.error(e?.message || "Failed to add component")
    }
  }

  return (
    <>
      <RouteFocusModal.Header>
        <div className="flex items-center gap-x-2">
          <RouteFocusModal.Title asChild>
            <Heading>Add Component</Heading>
          </RouteFocusModal.Title>
        </div>
      </RouteFocusModal.Header>

      <RouteFocusModal.Body className="flex flex-col items-center py-16">
        <div className="flex w-full max-w-[720px] flex-col gap-y-8">

          {/* Design Search */}
          <div className="flex flex-col gap-y-2">
            <Text size="small" weight="plus" leading="compact">
              Component Design
            </Text>
            <Text size="small" className="text-ui-fg-subtle">
              Search and select the design to bundle as a component
            </Text>

            {selectedDesign ? (
              // Selected state — show the chosen design as a card
              <div className="flex items-center justify-between rounded-lg border border-ui-border-strong bg-ui-bg-subtle px-4 py-3">
                <div className="flex flex-col gap-y-0.5">
                  <Text size="small" weight="plus" className="text-ui-fg-base">
                    {selectedDesign.name}
                  </Text>
                  {selectedDesign.status && (
                    <Text size="xsmall" className="text-ui-fg-subtle">
                      {selectedDesign.status}
                    </Text>
                  )}
                </div>
                <div className="flex items-center gap-x-2">
                  <CheckMini className="text-ui-fg-interactive" />
                  <button
                    type="button"
                    onClick={handleClearSelection}
                    className="text-ui-fg-subtle hover:text-ui-fg-base transition-colors"
                  >
                    <XMark />
                  </button>
                </div>
              </div>
            ) : (
              // Search state
              <div className="relative" ref={dropdownRef}>
                <Input
                  ref={inputRef}
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value)
                    setShowDropdown(true)
                  }}
                  onFocus={() => setShowDropdown(true)}
                  placeholder="Search designs by name..."
                  autoComplete="off"
                />

                {showDropdown && (
                  <div className="absolute top-full left-0 z-50 mt-1 w-full rounded-lg border border-ui-border-base bg-ui-bg-base shadow-elevation-flyout overflow-hidden">
                    {searching ? (
                      <div className="px-4 py-3 text-ui-fg-subtle text-sm">
                        Searching...
                      </div>
                    ) : filteredDesigns.length > 0 ? (
                      <ul className="max-h-64 overflow-y-auto py-1">
                        {filteredDesigns.map((design) => {
                          const searchLower = search.toLowerCase()
                          const nameLower = design.name.toLowerCase()
                          const matchIdx = nameLower.indexOf(searchLower)

                          return (
                            <li
                              key={design.id}
                              className="flex items-center justify-between gap-x-3 cursor-pointer px-4 py-2.5 hover:bg-ui-bg-base-hover transition-colors"
                              onMouseDown={(e) => {
                                e.preventDefault()
                                handleSelect(design)
                              }}
                            >
                              <div className="flex flex-col gap-y-0.5 min-w-0">
                                <span className="text-sm text-ui-fg-base truncate">
                                  {search && matchIdx !== -1 ? (
                                    <>
                                      {design.name.slice(0, matchIdx)}
                                      <span className="font-semibold text-ui-fg-interactive">
                                        {design.name.slice(matchIdx, matchIdx + search.length)}
                                      </span>
                                      {design.name.slice(matchIdx + search.length)}
                                    </>
                                  ) : (
                                    design.name
                                  )}
                                </span>
                                {design.status && (
                                  <span className="text-xs text-ui-fg-subtle">
                                    {design.status}
                                  </span>
                                )}
                              </div>
                              {design.design_type && (
                                <span className="text-xs text-ui-fg-muted shrink-0">
                                  {design.design_type}
                                </span>
                              )}
                            </li>
                          )
                        })}
                      </ul>
                    ) : search ? (
                      <div className="px-4 py-3 text-ui-fg-subtle text-sm">
                        No designs found for "{search}"
                      </div>
                    ) : (
                      <div className="px-4 py-3 text-ui-fg-subtle text-sm">
                        Start typing to search designs
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Quantity + Role */}
          <div className="grid grid-cols-2 gap-x-4">
            <div className="flex flex-col gap-y-2">
              <Text size="small" weight="plus" leading="compact">Quantity</Text>
              <Input
                type="number"
                min={1}
                value={String(quantity)}
                onChange={(e) => setQuantity(Math.max(1, Number(e.target.value)))}
              />
            </div>
            <div className="flex flex-col gap-y-2">
              <Text size="small" weight="plus" leading="compact">Role</Text>
              <Select value={role} onValueChange={setRole}>
                <Select.Trigger>
                  <Select.Value placeholder="Optional role..." />
                </Select.Trigger>
                <Select.Content>
                  {ROLE_OPTIONS.map((r) => (
                    <Select.Item key={r.value} value={r.value}>
                      {r.label}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select>
            </div>
          </div>

          {/* Notes */}
          <div className="flex flex-col gap-y-2">
            <Text size="small" weight="plus" leading="compact">Notes</Text>
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional notes about this component..."
            />
          </div>

        </div>
      </RouteFocusModal.Body>

      <RouteFocusModal.Footer>
        <div className="flex items-center gap-x-2">
          <RouteFocusModal.Close asChild>
            <Button variant="secondary" size="small">Cancel</Button>
          </RouteFocusModal.Close>
          <Button
            size="small"
            onClick={handleAdd}
            isLoading={isPending}
            disabled={!selectedDesign}
          >
            Add Component
          </Button>
        </div>
      </RouteFocusModal.Footer>
    </>
  )
}

export default function AddComponentPage() {
  const { id } = useParams()

  return (
    <RouteFocusModal>
      <AddComponentForm designId={id!} />
    </RouteFocusModal>
  )
}
