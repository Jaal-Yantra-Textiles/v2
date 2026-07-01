import { useState, useMemo } from "react"
import {
  Badge,
  Button,
  Drawer,
  Input,
  Label,
  Text,
  toast,
} from "@medusajs/ui"
import { useNavigate } from "react-router-dom"
import { AdminDesign } from "../../hooks/api/designs"
import { usePartners, AdminPartner } from "../../hooks/api/partners"
import { sdk } from "../../lib/config"
import { useQueryClient } from "@tanstack/react-query"
import { queryKeysFactory } from "../../lib/query-key-factory"

const designQueryKeys = queryKeysFactory("designs" as const)

interface ProduceDesignsResponse {
  design_production: {
    created: number
    run_ids: string[]
    design_ids: string[]
    work_order_id: string | null
  }
}

interface SendToProductionDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  selectedDesigns: AdminDesign[]
  onComplete: () => void
}

/**
 * #826 — "Send to Production" from the designs list, WITHOUT a customer/sale.
 * Pick a partner → one production run per selected design, collated into ONE
 * kind=design work-order the partner sees (the design analog of an inventory
 * order). Backed by POST /admin/designs/produce.
 */
export const SendToProductionDrawer = ({
  open,
  onOpenChange,
  selectedDesigns,
  onComplete,
}: SendToProductionDrawerProps) => {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { partners = [] } = usePartners({ limit: 100, offset: 0 })

  const [search, setSearch] = useState("")
  const [selectedPartnerId, setSelectedPartnerId] = useState("")
  const [isSending, setIsSending] = useState(false)

  const filteredPartners = useMemo(() => {
    if (!search) return partners
    const q = search.toLowerCase()
    return partners.filter(
      (p: AdminPartner) =>
        p.name?.toLowerCase().includes(q) ||
        p.handle?.toLowerCase().includes(q)
    )
  }, [partners, search])

  const selectedPartner = partners.find(
    (p: AdminPartner) => p.id === selectedPartnerId
  )

  const handleSubmit = async () => {
    if (!selectedPartnerId) {
      toast.error("Please select a partner")
      return
    }

    setIsSending(true)
    try {
      const { design_production } =
        await sdk.client.fetch<ProduceDesignsResponse>(
          `/admin/designs/produce`,
          {
            method: "POST",
            body: {
              design_ids: selectedDesigns.map((d) => d.id),
              partner_id: selectedPartnerId,
            },
          }
        )

      queryClient.invalidateQueries({ queryKey: designQueryKeys.lists() })
      toast.success(
        `Sent ${design_production.created} design${
          design_production.created > 1 ? "s" : ""
        } to ${selectedPartner?.name || "partner"}`,
        {
          description: design_production.work_order_id
            ? "One work-order created — open it to track production."
            : undefined,
          action: design_production.work_order_id
            ? {
                label: "View work-order",
                altText: "View the created work-order",
                onClick: () =>
                  navigate(`/orders/${design_production.work_order_id}`),
              }
            : undefined,
        }
      )
      handleClose()
      onComplete()
    } catch (err: any) {
      toast.error("Failed to send to production", {
        description: err?.message || "An unexpected error occurred.",
      })
    } finally {
      setIsSending(false)
    }
  }

  const handleClose = () => {
    if (isSending) return
    setSelectedPartnerId("")
    setSearch("")
    onOpenChange(false)
  }

  return (
    <Drawer open={open} onOpenChange={handleClose}>
      <Drawer.Content>
        <Drawer.Header>
          <Drawer.Title>Send to Production</Drawer.Title>
          <Drawer.Description>
            Hand {selectedDesigns.length} design
            {selectedDesigns.length > 1 ? "s" : ""} to a partner as ONE
            work-order — no customer or sale required.
          </Drawer.Description>
        </Drawer.Header>
        <Drawer.Body className="flex flex-col gap-y-4 overflow-y-auto">
          <div>
            <Text size="small" weight="plus" className="text-ui-fg-subtle mb-2">
              Selected Designs
            </Text>
            <div className="flex flex-wrap gap-1.5">
              {selectedDesigns.map((d) => (
                <Badge key={d.id} size="2xsmall" color="blue">
                  {d.name || d.id}
                </Badge>
              ))}
            </div>
          </div>

          <div>
            <Label className="mb-1.5">Select Partner</Label>
            <Input
              placeholder="Search partners..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="mb-2"
            />
            <div className="flex flex-col gap-1.5 max-h-[300px] overflow-y-auto">
              {filteredPartners.length === 0 ? (
                <Text size="small" className="text-ui-fg-subtle py-4 text-center">
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
                      <span className="text-sm font-medium">{partner.name}</span>
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
                          color={selectedPartnerId === partner.id ? "grey" : "green"}
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
        </Drawer.Body>
        <Drawer.Footer>
          <Button variant="secondary" onClick={handleClose} disabled={isSending}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!selectedPartnerId || isSending}>
            {isSending
              ? "Sending..."
              : `Send ${selectedDesigns.length} Design${
                  selectedDesigns.length > 1 ? "s" : ""
                } to Production`}
          </Button>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer>
  )
}
