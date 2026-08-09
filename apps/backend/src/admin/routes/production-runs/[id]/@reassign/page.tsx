import {
  Button,
  Container,
  Heading,
  Input,
  Label,
  Select,
  StatusBadge,
  Text,
  Textarea,
  toast,
} from "@medusajs/ui"
import { useMemo, useState } from "react"
import { useParams, useSearchParams } from "react-router-dom"

import { RouteDrawer } from "../../../../components/modal/route-drawer/route-drawer"
import { useRouteModal } from "../../../../components/modal/use-route-modal"
import {
  useAssignProductionRunPartner,
  useProductionRun,
} from "../../../../hooks/api/production-runs"
import { usePartners } from "../../../../hooks/api/partners"

/**
 * #1228 — assign or re-assign a production run to a partner.
 *
 * Reached from the run page and the design-order Production section. Two entry
 * modes, both landing here:
 *   ?mode=same      → pre-selects the partner who last held the run
 *   (no mode)       → an empty picker, for handing it to someone else
 *
 * On success the run is `approved` with the partner attached — it is NOT yet
 * sent. The drawer says so explicitly, because "assigned" reading as "sent" is
 * the obvious way for an operator to lose a run here.
 */
const ReassignProductionRunDrawerForm = () => {
  const { id: runId } = useParams()
  const [searchParams] = useSearchParams()
  const { handleSuccess } = useRouteModal()

  const { production_run: run } = useProductionRun(runId || "", undefined, {
    enabled: !!runId,
  })

  const { partners = [], isLoading: partnersLoading } = usePartners({ limit: 200 })

  // Whoever last held the run: the live partner if it still has one, else the
  // partner it was unassigned FROM when it was parked.
  const lastPartnerId: string | null =
    (run?.partner_id as string) || (run?.previous_partner_id as string) || null

  const wantsSamePartner = searchParams.get("mode") === "same"

  const [partnerId, setPartnerId] = useState<string>(
    wantsSamePartner && lastPartnerId ? lastPartnerId : ""
  )
  const [note, setNote] = useState("")
  const [search, setSearch] = useState("")

  const assignPartner = useAssignProductionRunPartner(runId || "")

  const sortedPartners = useMemo(() => {
    const list = [...(partners as any[])].sort((a, b) =>
      String(a?.name || "").localeCompare(String(b?.name || ""))
    )
    if (!search.trim()) return list
    const q = search.trim().toLowerCase()
    return list.filter((p) => String(p?.name || "").toLowerCase().includes(q))
  }, [partners, search])

  const lastPartnerName = useMemo(() => {
    if (!lastPartnerId) return null
    const match = (partners as any[]).find((p) => p.id === lastPartnerId)
    return match?.name || lastPartnerId
  }, [partners, lastPartnerId])

  const isSamePartner = !!partnerId && partnerId === lastPartnerId

  const handleAssign = async () => {
    if (!runId || !partnerId) return
    try {
      await assignPartner.mutateAsync({
        partner_id: partnerId,
        note: note.trim() || null,
      })
      toast.success(
        isSamePartner
          ? "Re-assigned to the same partner — dispatch it to send it again"
          : "Partner assigned — dispatch it to send it"
      )
      handleSuccess()
    } catch (e: any) {
      toast.error(e?.message || e?.body?.message || "Failed to assign partner")
    }
  }

  // The run has already been accepted, so swapping the partner would strand
  // their in-flight tasks. Mirrors the policy check server-side.
  const alreadyAccepted = !!run?.accepted_at

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <RouteDrawer.Header>
        <Heading>Assign partner</Heading>
      </RouteDrawer.Header>

      <RouteDrawer.Body className="flex flex-1 flex-col gap-y-6 overflow-y-auto py-6">
        {alreadyAccepted ? (
          <Container className="p-4">
            <Text className="text-ui-fg-subtle">
              This run has already been accepted by its partner. Cancel it instead
              of reassigning — swapping partners now would strand their tasks.
            </Text>
          </Container>
        ) : (
          <>
            <Container className="divide-y p-0">
              <div className="px-6 py-4">
                <Heading level="h2">Current state</Heading>
              </div>
              <div className="grid grid-cols-2 gap-3 px-6 py-3">
                <div>
                  <Text size="small" className="text-ui-fg-subtle">
                    Status
                  </Text>
                  <StatusBadge
                    color={run?.status === "awaiting_reassignment" ? "red" : "grey"}
                  >
                    {String(run?.status || "-").replace(/_/g, " ")}
                  </StatusBadge>
                </div>
                <div>
                  <Text size="small" className="text-ui-fg-subtle">
                    Last partner
                  </Text>
                  <Text size="small">{lastPartnerName || "None"}</Text>
                </div>
              </div>
              {run?.cancelled_reason && (
                <div className="px-6 py-3">
                  <Text size="small" className="text-ui-fg-subtle">
                    Why it needs reassigning
                  </Text>
                  <Text size="small">{String(run.cancelled_reason)}</Text>
                </div>
              )}
            </Container>

            <div className="flex flex-col gap-y-2 px-1">
              <Label size="small" weight="plus" htmlFor="partner-search">
                Partner
              </Label>
              <Input
                id="partner-search"
                placeholder="Search partners…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <Select value={partnerId} onValueChange={setPartnerId}>
                <Select.Trigger>
                  <Select.Value
                    placeholder={
                      partnersLoading ? "Loading partners…" : "Select a partner"
                    }
                  />
                </Select.Trigger>
                <Select.Content>
                  {sortedPartners.map((p: any) => (
                    <Select.Item key={p.id} value={p.id}>
                      {p.name}
                      {p.id === lastPartnerId ? " — same partner again" : ""}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select>
              {isSamePartner && (
                <Text size="xsmall" className="text-ui-fg-subtle">
                  Sending this back to the partner who already let it lapse. Their
                  reminder cycle and retry budget start over.
                </Text>
              )}
            </div>

            <div className="flex flex-col gap-y-2 px-1">
              <Label size="small" weight="plus" htmlFor="assign-note">
                Note <span className="text-ui-fg-muted">(optional)</span>
              </Label>
              <Textarea
                id="assign-note"
                placeholder="e.g. Called them, they'll take it this time"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={3}
              />
            </div>

            <Container className="p-4">
              <Text size="small" className="text-ui-fg-subtle">
                Assigning does not send the run. It moves back to{" "}
                <span className="text-ui-fg-base">approved</span> with the partner
                attached — use <span className="text-ui-fg-base">Dispatch</span> to
                pick task templates and actually send it.
              </Text>
            </Container>
          </>
        )}
      </RouteDrawer.Body>

      <RouteDrawer.Footer>
        <div className="flex items-center justify-end gap-x-2">
          <RouteDrawer.Close asChild>
            <Button size="small" variant="secondary">
              Cancel
            </Button>
          </RouteDrawer.Close>
          {!alreadyAccepted && (
            <Button
              size="small"
              type="button"
              onClick={handleAssign}
              isLoading={assignPartner.isPending}
              disabled={!partnerId}
            >
              {isSamePartner ? "Re-assign to same partner" : "Assign partner"}
            </Button>
          )}
        </div>
      </RouteDrawer.Footer>
    </div>
  )
}

export default function ReassignProductionRunDrawer() {
  return (
    <RouteDrawer>
      <ReassignProductionRunDrawerForm />
    </RouteDrawer>
  )
}
