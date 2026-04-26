import { useState, useMemo } from "react"
import {
  Drawer,
  Button,
  Text,
  Input,
  Checkbox,
  Badge,
  StatusBadge,
  toast,
} from "@medusajs/ui"
import { useDesigns, useLinkDesignsToCustomer } from "../../hooks/api/designs"

const designStatusColor = (status: string): "green" | "blue" | "orange" | "grey" | "red" | "purple" => {
  switch (status) {
    case "Commerce_Ready": return "green"
    case "Approved": return "blue"
    case "In_Development": return "orange"
    case "Conceptual": return "grey"
    case "Rejected": return "red"
    case "On_Hold": return "purple"
    default: return "grey"
  }
}

type LinkDesignToCustomerDrawerProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  customerId: string
  linkedDesignIds: string[]
}

export const LinkDesignToCustomerDrawer = ({
  open,
  onOpenChange,
  customerId,
  linkedDesignIds,
}: LinkDesignToCustomerDrawerProps) => {
  const [search, setSearch] = useState("")
  const [selected, setSelected] = useState<Record<string, boolean>>({})

  const { designs, isLoading } = useDesigns({ q: search || undefined, limit: 50 })

  const { mutate: linkDesigns, isPending } = useLinkDesignsToCustomer(customerId, {
    onSuccess: () => {
      toast.success("Designs linked", {
        description: `${Object.keys(selected).length} design(s) linked to customer.`,
      })
      setSelected({})
      onOpenChange(false)
    },
    onError: (err: any) => {
      toast.error("Failed to link designs", {
        description: err?.message || "An unexpected error occurred.",
      })
    },
  })

  const linkedSet = useMemo(() => new Set(linkedDesignIds), [linkedDesignIds])

  const availableDesigns = useMemo(
    () => designs.filter((d: any) => !linkedSet.has(d.id)),
    [designs, linkedSet]
  )

  const selectedIds = Object.keys(selected).filter((id) => selected[id])

  const toggleDesign = (id: string) => {
    setSelected((prev) => {
      const next = { ...prev }
      if (next[id]) {
        delete next[id]
      } else {
        next[id] = true
      }
      return next
    })
  }

  const handleLink = () => {
    if (selectedIds.length === 0) return
    linkDesigns({ design_ids: selectedIds })
  }

  const handleOpenChange = (o: boolean) => {
    if (!o) {
      setSelected({})
      setSearch("")
    }
    onOpenChange(o)
  }

  return (
    <Drawer open={open} onOpenChange={handleOpenChange}>
      <Drawer.Content className="max-w-md">
        <Drawer.Header>
          <Drawer.Title>Link Designs to Customer</Drawer.Title>
          <Drawer.Description>
            Search and select designs to link to this customer.
          </Drawer.Description>
        </Drawer.Header>

        <Drawer.Body className="overflow-y-auto">
          <div className="mb-4">
            <Input
              placeholder="Search designs..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              size="small"
            />
          </div>

          {isLoading ? (
            <Text className="text-ui-fg-subtle">Loading designs...</Text>
          ) : availableDesigns.length === 0 ? (
            <Text className="text-ui-fg-subtle">No unlinked designs found.</Text>
          ) : (
            <div className="divide-y">
              {availableDesigns.map((design: any) => (
                <label
                  key={design.id}
                  className="flex items-center gap-x-3 py-3 cursor-pointer hover:bg-ui-bg-base-hover px-2 rounded"
                >
                  <Checkbox
                    checked={!!selected[design.id]}
                    onCheckedChange={() => toggleDesign(design.id)}
                  />
                  <div className="flex-1 min-w-0">
                    <Text size="small" weight="plus" className="truncate">
                      {design.name}
                    </Text>
                    <div className="flex items-center gap-x-2 mt-1">
                      {design.status && (
                        <StatusBadge color={designStatusColor(design.status)}>
                          {design.status}
                        </StatusBadge>
                      )}
                      {design.design_type && (
                        <Badge size="2xsmall" color="grey">
                          {design.design_type}
                        </Badge>
                      )}
                    </div>
                  </div>
                </label>
              ))}
            </div>
          )}
        </Drawer.Body>

        <Drawer.Footer>
          <Drawer.Close asChild>
            <Button variant="secondary" size="small">
              Cancel
            </Button>
          </Drawer.Close>
          <Button
            size="small"
            onClick={handleLink}
            isLoading={isPending}
            disabled={selectedIds.length === 0}
          >
            Link Selected ({selectedIds.length})
          </Button>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer>
  )
}
