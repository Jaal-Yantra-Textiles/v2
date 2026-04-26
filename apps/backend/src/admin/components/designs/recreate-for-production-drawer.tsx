import { useState, useMemo } from "react"
import {
  Badge,
  Button,
  Drawer,
  Input,
  Label,
  Select,
  Text,
  Textarea,
  toast,
} from "@medusajs/ui"
import { ArrowPath } from "@medusajs/icons"
import { AdminDesign } from "../../hooks/api/designs"
import { usePartners, AdminPartner } from "../../hooks/api/partners"
import { useRecreateProductionRun } from "../../hooks/api/production-runs"

interface DesignQuantity {
  design_id: string
  quantity: number
  notes: string
}

interface RecreateForProductionDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  selectedDesigns: AdminDesign[]
  onComplete: () => void
}

export const RecreateForProductionDrawer = ({
  open,
  onOpenChange,
  selectedDesigns,
  onComplete,
}: RecreateForProductionDrawerProps) => {
  const { partners = [] } = usePartners({ limit: 100, offset: 0 })
  const recreateMutation = useRecreateProductionRun()

  const [partnerSearch, setPartnerSearch] = useState("")
  const [selectedPartnerId, setSelectedPartnerId] = useState("")
  const [runType, setRunType] = useState<"production" | "sample">("production")
  const [globalNotes, setGlobalNotes] = useState("")
  const [designQuantities, setDesignQuantities] = useState<
    Record<string, DesignQuantity>
  >({})

  const getDesignQty = (designId: string): DesignQuantity => {
    return (
      designQuantities[designId] || {
        design_id: designId,
        quantity: 1,
        notes: "",
      }
    )
  }

  const updateDesignQty = (
    designId: string,
    field: "quantity" | "notes",
    value: string | number
  ) => {
    setDesignQuantities((prev) => ({
      ...prev,
      [designId]: {
        ...getDesignQty(designId),
        [field]: value,
      },
    }))
  }

  const filteredPartners = useMemo(() => {
    if (!partnerSearch) return partners
    const q = partnerSearch.toLowerCase()
    return partners.filter(
      (p: AdminPartner) =>
        p.name?.toLowerCase().includes(q) ||
        p.handle?.toLowerCase().includes(q)
    )
  }, [partners, partnerSearch])

  const selectedPartner = partners.find(
    (p: AdminPartner) => p.id === selectedPartnerId
  )

  const totalQuantity = selectedDesigns.reduce(
    (sum, d) => sum + (getDesignQty(d.id).quantity || 1),
    0
  )

  const handleSubmit = async () => {
    if (!selectedPartnerId) {
      toast.error("Please select a partner")
      return
    }

    const designs = selectedDesigns.map((d) => {
      const dq = getDesignQty(d.id)
      return {
        design_id: d.id,
        quantity: dq.quantity || 1,
        notes: dq.notes || undefined,
      }
    })

    recreateMutation.mutate(
      {
        designs,
        partner_id: selectedPartnerId,
        run_type: runType,
        notes: globalNotes || undefined,
      },
      {
        onSuccess: (data) => {
          const childCount = data.children?.length || 0
          toast.success(
            `Production run created with ${childCount} design${childCount !== 1 ? "s" : ""} for ${selectedPartner?.name || "partner"}`
          )
          handleClose()
          onComplete()
        },
        onError: (error) => {
          toast.error(
            `Failed to create production run: ${error.message || "Unknown error"}`
          )
        },
      }
    )
  }

  const handleClose = () => {
    if (recreateMutation.isPending) return
    setSelectedPartnerId("")
    setPartnerSearch("")
    setGlobalNotes("")
    setRunType("production")
    setDesignQuantities({})
    onOpenChange(false)
  }

  return (
    <Drawer open={open} onOpenChange={handleClose}>
      <Drawer.Content>
        <Drawer.Header>
          <Drawer.Title>Re-Create for Production</Drawer.Title>
          <Drawer.Description>
            Bundle {selectedDesigns.length} design
            {selectedDesigns.length > 1 ? "s" : ""} into a production run for a
            partner
          </Drawer.Description>
        </Drawer.Header>
        <Drawer.Body className="flex flex-col gap-y-5 overflow-y-auto">
          {/* Designs with quantities */}
          <div>
            <Text
              size="small"
              weight="plus"
              className="text-ui-fg-subtle mb-2"
            >
              Designs & Quantities
            </Text>
            <div className="flex flex-col gap-2">
              {selectedDesigns.map((design) => {
                const dq = getDesignQty(design.id)
                return (
                  <div
                    key={design.id}
                    className="rounded-md border border-ui-border-base bg-ui-bg-subtle p-3"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <Text size="small" weight="plus" className="truncate">
                          {design.name || design.id}
                        </Text>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          {design.status && (
                            <Badge size="2xsmall" color="grey">
                              {design.status}
                            </Badge>
                          )}
                          {design.design_type && (
                            <Badge size="2xsmall" color="blue">
                              {design.design_type}
                            </Badge>
                          )}
                        </div>
                      </div>
                      <div className="w-20 shrink-0">
                        <Input
                          type="number"
                          min={1}
                          placeholder="Qty"
                          size="small"
                          value={dq.quantity}
                          onChange={(e) =>
                            updateDesignQty(
                              design.id,
                              "quantity",
                              Math.max(1, parseInt(e.target.value) || 1)
                            )
                          }
                        />
                      </div>
                    </div>
                    <Input
                      className="mt-2"
                      size="small"
                      placeholder="Notes for this design (optional)"
                      value={dq.notes}
                      onChange={(e) =>
                        updateDesignQty(design.id, "notes", e.target.value)
                      }
                    />
                  </div>
                )
              })}
            </div>
            <Text size="xsmall" className="text-ui-fg-muted mt-1.5">
              Total quantity: {totalQuantity}
            </Text>
          </div>

          {/* Run type */}
          <div>
            <Label className="mb-1.5">Run Type</Label>
            <Select
              value={runType}
              onValueChange={(v) =>
                setRunType(v as "production" | "sample")
              }
            >
              <Select.Trigger>
                <Select.Value />
              </Select.Trigger>
              <Select.Content>
                <Select.Item value="production">Production</Select.Item>
                <Select.Item value="sample">Sample</Select.Item>
              </Select.Content>
            </Select>
          </div>

          {/* Partner selection */}
          <div>
            <Label className="mb-1.5">Select Partner</Label>
            <Input
              placeholder="Search partners..."
              value={partnerSearch}
              onChange={(e) => setPartnerSearch(e.target.value)}
              className="mb-2"
            />
            <div className="flex flex-col gap-1.5 max-h-[250px] overflow-y-auto">
              {filteredPartners.length === 0 ? (
                <Text
                  size="small"
                  className="text-ui-fg-subtle py-4 text-center"
                >
                  No partners found
                </Text>
              ) : (
                filteredPartners.map((partner: AdminPartner) => (
                  <button
                    key={partner.id}
                    type="button"
                    onClick={() => setSelectedPartnerId(partner.id)}
                    className={`flex items-center gap-3 rounded-md px-3 py-2.5 text-left transition-colors ${
                      selectedPartnerId === partner.id
                        ? "bg-ui-bg-interactive text-ui-fg-on-color"
                        : "bg-ui-bg-component hover:bg-ui-bg-component-hover text-ui-fg-base"
                    }`}
                  >
                    <div className="flex flex-1 flex-col">
                      <span className="text-sm font-medium">
                        {partner.name}
                      </span>
                      <span
                        className={`text-xs ${
                          selectedPartnerId === partner.id
                            ? "text-ui-fg-on-color/70"
                            : "text-ui-fg-subtle"
                        }`}
                      >
                        {partner.handle}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {partner.is_verified && (
                        <Badge
                          size="2xsmall"
                          color={
                            selectedPartnerId === partner.id ? "grey" : "green"
                          }
                        >
                          verified
                        </Badge>
                      )}
                      <Badge
                        size="2xsmall"
                        color={
                          partner.status === "active"
                            ? selectedPartnerId === partner.id
                              ? "grey"
                              : "green"
                            : "orange"
                        }
                      >
                        {partner.status}
                      </Badge>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>

          {/* Global notes */}
          <div>
            <Label className="mb-1.5">Production Notes (optional)</Label>
            <Textarea
              placeholder="Instructions or notes for the production run..."
              value={globalNotes}
              onChange={(e) => setGlobalNotes(e.target.value)}
              rows={3}
            />
          </div>
        </Drawer.Body>
        <Drawer.Footer>
          <Button
            variant="secondary"
            onClick={handleClose}
            disabled={recreateMutation.isPending}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!selectedPartnerId || recreateMutation.isPending}
            isLoading={recreateMutation.isPending}
          >
            <ArrowPath />
            Re-Create {selectedDesigns.length} Design
            {selectedDesigns.length > 1 ? "s" : ""}
          </Button>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer>
  )
}
