import { Alert, Button, Text, Textarea, toast } from "@medusajs/ui"
import { z } from "@medusajs/framework/zod"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"

import { Form } from "../common/form"
import { KeyboundForm } from "../utilitites/key-bound-form"
import { RouteDrawer } from "../modal/route-drawer/route-drawer"
import { useRouteModal } from "../modal/use-route-modal"
import {
  AdminProductionRun,
  useReopenProductionRun,
  useShortCloseProductionRun,
} from "../../hooks/api/production-runs"

const schema = z.object({
  reason: z.string().optional(),
})

type FormValues = z.infer<typeof schema>

const asNumber = (value: unknown): number | null => {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/**
 * ⚠️ `short_closed_quantity` is a float column, so it arrives as "4.000000" and
 * printing it verbatim reads as a measurement precision nobody recorded.
 */
const fmt = (value: number | null): string => (value == null ? "—" : String(value))

interface ShortCloseFormProps {
  run: AdminProductionRun
}

/**
 * #1596 — declare a run finished for good, or reverse that declaration.
 *
 * The screen's job here is to state the consequence in units before it is
 * taken, because the consequence is somebody's money: closing a run ordered
 * for 9 at 7 produced means those last 2 units stop being billable, through
 * this screen and through the write guard alike.
 *
 * 🔑 It also states what closing does NOT do. Nothing is clawed back — a run
 * already billed to 7 and then closed at 4 keeps the 7, the remainder clamps
 * at zero, and only further claims are refused. An admin reading "close" as
 * "reverse the overpayment" would be wrong, and this is the only place that
 * misreading can be corrected before the click.
 */
export const ShortCloseRunForm = ({ run }: ShortCloseFormProps) => {
  const { handleSuccess } = useRouteModal()
  const isClosed = !!run.short_closed_at

  const shortClose = useShortCloseProductionRun(run.id)
  const reopen = useReopenProductionRun(run.id)

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { reason: "" },
  })

  const ordered = asNumber(run.quantity)
  const produced = asNumber(run.produced_quantity)
  const forfeited =
    ordered != null && produced != null && ordered > produced
      ? Math.round((ordered - produced) * 100) / 100
      : null

  const onSubmit = form.handleSubmit(async (data) => {
    const reason = data.reason?.trim() ? data.reason.trim() : null
    try {
      if (isClosed) {
        await reopen.mutateAsync({ reason })
        toast.success("Run reopened — billable to its ordered quantity again")
      } else {
        await shortClose.mutateAsync({ reason })
        toast.success("Run short-closed")
      }
      handleSuccess()
    } catch (e: any) {
      toast.error(
        e?.message ||
          (isClosed ? "Failed to reopen the run" : "Failed to short-close the run")
      )
    }
  })

  const isPending = shortClose.isPending || reopen.isPending

  return (
    <RouteDrawer.Form form={form}>
      <KeyboundForm onSubmit={onSubmit} className="flex flex-1 flex-col overflow-hidden">
        <RouteDrawer.Body className="flex flex-1 flex-col gap-y-6 overflow-y-auto">
          {isClosed ? (
            <Alert variant="info">
              <Text size="small">
                This run is closed at{" "}
                <strong>{fmt(asNumber(run.short_closed_quantity) ?? produced)}</strong>{" "}
                of {fmt(ordered)} ordered. Reopening makes the ordered
                quantity billable again — use it when the close was premature, or
                when more work is genuinely coming.
              </Text>
            </Alert>
          ) : (
            <Alert variant="warning">
              <Text size="small">
                {produced == null || produced <= 0 ? (
                  <>
                    This run has no recorded output. Closing it would leave the
                    ceiling at the ordered quantity — a decision that changes
                    nothing. Record the produced quantity first.
                  </>
                ) : (
                  <>
                    Closing declares that no more will be made. This run bills to{" "}
                    <strong>{produced}</strong> produced instead of{" "}
                    <strong>{fmt(ordered)}</strong> ordered
                    {forfeited != null ? (
                      <>
                        , so <strong>{forfeited}</strong> unit
                        {forfeited === 1 ? "" : "s"} stop being billable
                      </>
                    ) : null}
                    .
                  </>
                )}
              </Text>
            </Alert>
          )}

          {!isClosed && (
            <Text size="xsmall" className="text-ui-fg-subtle">
              Nothing is clawed back. Anything already claimed stays claimed —
              only further claims are refused. An output correction that raises
              the produced figure reopens the run automatically.
            </Text>
          )}

          <Form.Field
            control={form.control}
            name="reason"
            render={({ field }) => (
              <Form.Item>
                <Form.Label optional>Reason</Form.Label>
                <Form.Control>
                  <Textarea
                    {...field}
                    rows={3}
                    placeholder={
                      isClosed
                        ? "Why is this run being reopened?"
                        : "Why will no more be made? (recorded on the run's timeline)"
                    }
                  />
                </Form.Control>
                <Form.ErrorMessage />
              </Form.Item>
            )}
          />
        </RouteDrawer.Body>
        <RouteDrawer.Footer>
          <div className="flex items-center justify-end gap-x-2">
            <RouteDrawer.Close asChild>
              <Button size="small" variant="secondary" type="button">
                Cancel
              </Button>
            </RouteDrawer.Close>
            <Button
              size="small"
              type="submit"
              variant={isClosed ? "secondary" : "danger"}
              isLoading={isPending}
              disabled={isPending || (!isClosed && (produced == null || produced <= 0))}
            >
              {isClosed ? "Reopen run" : "Short-close run"}
            </Button>
          </div>
        </RouteDrawer.Footer>
      </KeyboundForm>
    </RouteDrawer.Form>
  )
}
