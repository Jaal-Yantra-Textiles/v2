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
import { AdminDesign } from "../../hooks/api/designs"
import { usePartners, AdminPartner } from "../../hooks/api/partners"
import { sdk } from "../../lib/config"
import { useQueryClient } from "@tanstack/react-query"
import { queryKeysFactory } from "../../lib/query-key-factory"

const designQueryKeys = queryKeysFactory("designs" as const)

interface BulkLinkPartnerDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  selectedDesigns: AdminDesign[]
  onComplete: () => void
}

export const BulkLinkPartnerDrawer = ({
  open,
  onOpenChange,
  selectedDesigns,
  onComplete,
}: BulkLinkPartnerDrawerProps) => {
  const queryClient = useQueryClient()
  const { partners = [] } = usePartners({ limit: 100, offset: 0 })

  const [search, setSearch] = useState("")
  const [selectedPartnerId, setSelectedPartnerId] = useState("")
  const [isSending, setIsSending] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0 })

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
    setProgress({ done: 0, total: selectedDesigns.length })

    let successCount = 0
    let failCount = 0

    for (const design of selectedDesigns) {
      try {
        await sdk.client.fetch(`/admin/designs/${design.id}/partner`, {
          method: "POST",
          body: { partnerIds: [selectedPartnerId] },
        })
        successCount++
      } catch {
        failCount++
      }
      setProgress((prev) => ({ ...prev, done: prev.done + 1 }))
    }

    setIsSending(false)

    if (successCount > 0) {
      toast.success(
        `${successCount} design${successCount > 1 ? "s" : ""} linked to ${selectedPartner?.name || "partner"}`
      )
      queryClient.invalidateQueries({ queryKey: designQueryKeys.lists() })
    }
    if (failCount > 0) {
      toast.error(`${failCount} design${failCount > 1 ? "s" : ""} failed to link`)
    }

    handleClose()
    onComplete()
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
          <Drawer.Title>Link to Partner</Drawer.Title>
          <Drawer.Description>
            Link {selectedDesigns.length} design
            {selectedDesigns.length > 1 ? "s" : ""} to a partner
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

          {isSending && (
            <div className="rounded-md bg-ui-bg-subtle px-4 py-3">
              <Text size="small" weight="plus">
                Linking... {progress.done}/{progress.total}
              </Text>
              <div className="mt-1.5 h-1.5 w-full rounded-full bg-ui-bg-switch-off">
                <div
                  className="h-full rounded-full bg-ui-bg-interactive transition-all"
                  style={{
                    width: `${(progress.done / progress.total) * 100}%`,
                  }}
                />
              </div>
            </div>
          )}
        </Drawer.Body>
        <Drawer.Footer>
          <Button variant="secondary" onClick={handleClose} disabled={isSending}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!selectedPartnerId || isSending}
          >
            {isSending
              ? `Linking ${progress.done}/${progress.total}...`
              : `Link ${selectedDesigns.length} Design${selectedDesigns.length > 1 ? "s" : ""}`}
          </Button>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer>
  )
}
