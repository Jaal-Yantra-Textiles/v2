import { useCallback, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import {
  Badge,
  Button,
  Checkbox,
  Container,
  Heading,
  Input,
  Text,
  Textarea,
  toast,
} from "@medusajs/ui"

import { RouteFocusModal } from "../../../components/modals"
import {
  usePartnerDesigns,
  type PartnerDesign,
} from "../../../hooks/api/partner-designs"
import { useCreatePartnerPaymentSubmission } from "../../../hooks/api/partner-payment-submissions"

const ELIGIBLE_STATUSES = ["Commerce_Ready", "Approved"]

const getDesignCost = (d: any): number =>
  Number(d.estimated_cost || d.production_cost || 0)

export const PaymentSubmissionCreate = () => {
  const navigate = useNavigate()
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [costOverrides, setCostOverrides] = useState<Record<string, number>>({})
  const [notes, setNotes] = useState("")

  // Fetch all partner designs — filter eligible ones client-side
  const { designs = [], isPending: designsLoading } = usePartnerDesigns({
    limit: 200,
    offset: 0,
  })

  const eligibleDesigns = useMemo(
    () =>
      designs.filter(
        (d: PartnerDesign) =>
          ELIGIBLE_STATUSES.includes(d.status || "")
      ),
    [designs]
  )

  const { mutateAsync: createSubmission, isPending: isCreating } =
    useCreatePartnerPaymentSubmission()

  const toggleDesign = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }, [])

  const selectAll = useCallback(() => {
    if (selectedIds.size === eligibleDesigns.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(eligibleDesigns.map((d: any) => d.id)))
    }
  }, [eligibleDesigns, selectedIds.size])

  const getEffectiveCost = useCallback(
    (design: any): number => {
      if (costOverrides[design.id] != null) return costOverrides[design.id]
      return getDesignCost(design)
    },
    [costOverrides]
  )

  const totalAmount = useMemo(
    () =>
      eligibleDesigns
        .filter((d: any) => selectedIds.has(d.id))
        .reduce((sum: number, d: any) => sum + getEffectiveCost(d), 0),
    [eligibleDesigns, selectedIds, getEffectiveCost]
  )

  const handleCostChange = (designId: string, value: string) => {
    const num = parseFloat(value)
    if (value === "" || isNaN(num)) {
      setCostOverrides((prev) => {
        const next = { ...prev }
        delete next[designId]
        return next
      })
    } else {
      setCostOverrides((prev) => ({ ...prev, [designId]: num }))
    }
  }

  const handleSubmit = async () => {
    if (selectedIds.size === 0) {
      toast.error("Select at least one design")
      return
    }

    // Validate all selected designs have a cost > 0
    const invalidDesigns = eligibleDesigns.filter(
      (d: any) => selectedIds.has(d.id) && getEffectiveCost(d) <= 0
    )
    if (invalidDesigns.length) {
      toast.error(
        `Enter a cost for: ${invalidDesigns.map((d: any) => d.name || d.id).join(", ")}`
      )
      return
    }

    try {
      await createSubmission({
        design_ids: Array.from(selectedIds),
        notes: notes || undefined,
        metadata: Object.keys(costOverrides).length
          ? { cost_overrides: costOverrides }
          : undefined,
      })
      toast.success("Payment submission created successfully")
      navigate("/payment-submissions")
    } catch (e: any) {
      toast.error(e?.message || "Failed to create submission")
    }
  }

  return (
    <RouteFocusModal prev="/payment-submissions">
      <RouteFocusModal.Header>
        <div className="flex w-full items-center justify-between">
          <div>
            <RouteFocusModal.Title>
              New Payment Submission
            </RouteFocusModal.Title>
            <RouteFocusModal.Description>
              Select completed designs to submit for payment
            </RouteFocusModal.Description>
          </div>
          <div className="flex items-center gap-3">
            {selectedIds.size > 0 && (
              <Text className="text-ui-fg-subtle">
                {selectedIds.size} design{selectedIds.size !== 1 ? "s" : ""} ={" "}
                <span className="font-semibold text-ui-fg-base">
                  INR {totalAmount.toLocaleString()}
                </span>
              </Text>
            )}
            <Button
              onClick={handleSubmit}
              isLoading={isCreating}
              disabled={selectedIds.size === 0}
            >
              Submit for Payment
            </Button>
          </div>
        </div>
      </RouteFocusModal.Header>

      <RouteFocusModal.Body className="flex flex-col gap-y-6 p-6 md:p-16">
        <div className="mx-auto w-full max-w-[720px]">
          {/* Notes */}
          <div className="mb-6">
            <Text size="small" weight="plus" className="mb-2">
              Notes (optional)
            </Text>
            <Textarea
              placeholder="E.g., April batch - all designs quality checked and approved..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
            />
          </div>

          {/* Design Selection */}
          <div className="mb-3 flex items-center justify-between">
            <Heading level="h2">
              Eligible Designs ({eligibleDesigns.length})
            </Heading>
            {eligibleDesigns.length > 0 && (
              <Button variant="secondary" size="small" onClick={selectAll}>
                {selectedIds.size === eligibleDesigns.length
                  ? "Deselect All"
                  : "Select All"}
              </Button>
            )}
          </div>

          {designsLoading ? (
            <Container className="p-8">
              <Text className="text-ui-fg-subtle text-center">
                Loading designs...
              </Text>
            </Container>
          ) : eligibleDesigns.length === 0 ? (
            <Container className="p-8">
              <Text className="text-ui-fg-subtle text-center">
                No eligible designs found. Designs must be in Approved or
                Commerce Ready status to be submitted for payment.
              </Text>
            </Container>
          ) : (
            <div className="flex flex-col gap-y-2">
              {eligibleDesigns.map((design: any) => {
                const isSelected = selectedIds.has(design.id)
                const defaultCost = getDesignCost(design)
                const effectiveCost = getEffectiveCost(design)

                return (
                  <Container
                    key={design.id}
                    className={`p-4 transition ${
                      isSelected
                        ? "ring-2 ring-ui-border-interactive"
                        : ""
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className="cursor-pointer"
                        onClick={() => toggleDesign(design.id)}
                      >
                        <Checkbox checked={isSelected} />
                      </div>
                      <div
                        className="flex-1 min-w-0 cursor-pointer"
                        onClick={() => toggleDesign(design.id)}
                      >
                        <div className="flex items-center gap-2">
                          <Text weight="plus" className="truncate">
                            {design.name || "Unnamed design"}
                          </Text>
                          <Badge color="grey" size="2xsmall">
                            {design.status?.replace(/_/g, " ")}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-4 mt-1">
                          {design.design_type && (
                            <Text
                              size="small"
                              className="text-ui-fg-subtle"
                            >
                              Type: {design.design_type}
                            </Text>
                          )}
                          <Text
                            size="small"
                            className="text-ui-fg-muted font-mono"
                          >
                            {design.id.slice(0, 12)}...
                          </Text>
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        <div className="flex items-center gap-2">
                          <Text
                            size="xsmall"
                            className="text-ui-fg-muted whitespace-nowrap"
                          >
                            INR
                          </Text>
                          <Input
                            type="number"
                            size="small"
                            className="w-28 text-right"
                            placeholder={defaultCost ? String(defaultCost) : "0"}
                            value={
                              costOverrides[design.id] != null
                                ? String(costOverrides[design.id])
                                : defaultCost
                                  ? String(defaultCost)
                                  : ""
                            }
                            onChange={(e) =>
                              handleCostChange(design.id, e.target.value)
                            }
                            onClick={(e) => e.stopPropagation()}
                          />
                        </div>
                        {defaultCost > 0 &&
                          effectiveCost !== defaultCost && (
                            <Text
                              size="xsmall"
                              className="text-ui-fg-muted"
                            >
                              was {defaultCost.toLocaleString()}
                            </Text>
                          )}
                      </div>
                    </div>
                  </Container>
                )
              })}
            </div>
          )}
        </div>
      </RouteFocusModal.Body>
    </RouteFocusModal>
  )
}

export const Component = PaymentSubmissionCreate
