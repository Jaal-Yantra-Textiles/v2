import { useState, useMemo } from "react"
import {
  Badge,
  Checkbox,
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
import { useTaskTemplates } from "../../hooks/api/task-templates"
import { sdk } from "../../lib/config"
import { useQueryClient } from "@tanstack/react-query"
import { queryKeysFactory } from "../../lib/query-key-factory"

const designQueryKeys = queryKeysFactory("designs" as const)

interface ProduceDesignReport {
  design_id: string
  run_id: string | null
  template_ids: string[]
  dispatched: boolean
  reason?: string
}

interface ProduceDesignsResponse {
  design_production: {
    created: number
    run_ids: string[]
    design_ids: string[]
    work_order_id: string | null
    designs?: ProduceDesignReport[]
    dispatched?: string[]
    not_dispatched?: ProduceDesignReport[]
    /** #1597 — whether the lines joined an existing work-order or minted one. */
    work_order_joined?: boolean
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
  /**
   * #1597 — off by default, because collating IS the default now.
   *
   * The habitual path is one design at a time, so a partner sent four designs
   * across a week collected four work-orders for what is operationally one
   * batch. The collation existed and only ever applied within a single
   * dispatch; the moment the choice was cheap was the one moment nothing
   * offered it. Ticking this restores the old behaviour for a batch that has
   * to be billed on its own.
   */
  const [separateOrder, setSeparateOrder] = useState(false)
  /**
   * #1263 — the process the partner is being asked to run. Without it the
   * batch used to be created `sent_to_partner` with NO tasks: nothing for the
   * partner to accept, while the record claimed it had been sent.
   *
   * By id, never name — two templates can share a name and dispatch refuses
   * an ambiguous one (#1262). One selection applies to every design in the
   * batch; per-design sets go through the API's `designs[]` form.
   */
  const [selectedTemplateIds, setSelectedTemplateIds] = useState<string[]>([])
  const { task_templates: taskTemplates = [] } = useTaskTemplates({
    limit: 100,
    offset: 0,
  })

  const templatesByCategory = useMemo(() => {
    const groups = new Map<string, any[]>()
    for (const tpl of taskTemplates as any[]) {
      const category =
        typeof tpl?.category === "object"
          ? tpl.category?.name || "Uncategorized"
          : String(tpl?.category || "Uncategorized")
      groups.set(category, [...(groups.get(category) || []), tpl])
    }
    return [...groups.entries()]
  }, [taskTemplates])

  const toggleTemplate = (id: string) => {
    setSelectedTemplateIds((prev) =>
      prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]
    )
  }

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

    if (!selectedTemplateIds.length) {
      toast.error("Select at least one task template", {
        description:
          "Without one the partner is sent work with no tasks to accept.",
      })
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
              template_ids: selectedTemplateIds,
              /**
               * #1597 — omitted would already mean "join the partner's open
               * work-order"; sent explicitly so the screen's checkbox is the
               * thing that decides, not a server default that could change
               * underneath it.
               */
              collate: separateOrder ? "new" : "partner-open",
            },
          }
        )

      queryClient.invalidateQueries({ queryKey: designQueryKeys.lists() })

      // Per-design failure isolation means a partial batch is a real outcome,
      // not an error — say so rather than reporting a clean success (#1263).
      const undispatched = design_production.not_dispatched || []
      if (undispatched.length) {
        toast.warning(
          `${undispatched.length} of ${design_production.created} design${
            design_production.created > 1 ? "s" : ""
          } were not dispatched`,
          {
            description:
              undispatched[0]?.reason ||
              "Their runs exist but carry no tasks — dispatch them from the run page.",
          }
        )
      }

      toast.success(
        `Sent ${design_production.created} design${
          design_production.created > 1 ? "s" : ""
        } to ${selectedPartner?.name || "partner"}`,
        {
          description: design_production.work_order_id
            ? design_production.work_order_joined
              ? "Added to this partner's open work-order — open it to track production."
              : "One work-order created — open it to track production."
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
    setSelectedTemplateIds([])
    setSearch("")
    setSeparateOrder(false)
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
            <Label className="mb-1.5">Task Templates</Label>
            <Text size="xsmall" className="text-ui-fg-subtle mb-2">
              The process these designs go through. Applied to every design in
              this batch — for different processes per design, send them
              separately.
            </Text>
            <div className="max-h-[220px] overflow-y-auto">
              {templatesByCategory.map(([categoryName, templates]) => (
                <div key={categoryName} className="mb-3">
                  <Text
                    size="xsmall"
                    weight="plus"
                    className="text-ui-fg-subtle mb-1"
                  >
                    {categoryName}
                  </Text>
                  <div className="flex flex-wrap gap-1.5">
                    {templates.map((tpl: any) => {
                      const id = String(tpl.id)
                      const selected = selectedTemplateIds.includes(id)
                      return (
                        <button
                          key={id}
                          type="button"
                          onClick={() => toggleTemplate(id)}
                          className="rounded-md border px-2 py-1 text-xs"
                        >
                          <Badge
                            size="2xsmall"
                            color={selected ? "green" : "grey"}
                          >
                            {String(tpl.name)}
                          </Badge>
                        </button>
                      )
                    })}
                  </div>
                </div>
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

          {/*
            #1597 — the collation choice, at the one moment it is cheap.
            Unticked (the default) these designs join the partner's open
            work-order if they have one minted in the last two weeks.
          */}
          <div className="border-ui-border-base flex items-start gap-x-2 rounded-lg border p-3">
            <Checkbox
              id="separate-work-order"
              checked={separateOrder}
              onCheckedChange={(v) => setSeparateOrder(v === true)}
            />
            <div className="flex flex-col">
              <Label htmlFor="separate-work-order" weight="plus" size="small">
                Start a separate work-order
              </Label>
              <Text size="xsmall" className="text-ui-fg-subtle">
                {separateOrder
                  ? "These designs get their own work-order, billed on its own."
                  : `These designs join ${
                      selectedPartner?.name || "the partner"
                    }'s open work-order if they have a recent one — otherwise a new one is created.`}
              </Text>
            </div>
          </div>
        </Drawer.Body>
        <Drawer.Footer>
          <Button variant="secondary" onClick={handleClose} disabled={isSending}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={
              !selectedPartnerId || !selectedTemplateIds.length || isSending
            }
          >
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
