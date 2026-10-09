import {
  Button,
  Container,
  Heading,
  Select,
  StatusBadge,
  Text,
  Textarea,
  toast,
  usePrompt,
} from "@medusajs/ui"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { useTranslation } from "react-i18next"

import { sdk } from "../../../../../lib/client"

/**
 * What the buyer still owes on a deposit order, and — on a made-to-order deal
 * whose balance is released by a sample — the buyer's verdict on each sample.
 *
 * The partner mirror of the admin balance card; both read the same backend
 * function, so the two never disagree. Renders NOTHING for an ordinary order:
 * most orders have no payment schedule.
 */
type SampleDecision = {
  production_run_id: string
  decision: "approved" | "rejected"
  notes?: string | null
  decided_at: string
}

type Balance = {
  has_schedule: boolean
  currency_code?: string | null
  total_due?: number | null
  deposit_amount?: number | null
  deposit_status?: string | null
  balance_amount?: number | null
  balance_status?: string | null
  balance_link?: string | null
  can_raise?: boolean
  reason?: string | null
  balance_trigger?: "dispatch" | "sample_approved" | "manual"
  sample_decisions?: SampleDecision[]
  sample_runs?: Array<{ id: string; status?: string | null; created_at?: string | null }>
}

const money = (amount?: number | null, currency?: string | null) => {
  if (amount === null || amount === undefined || !currency) return "—"
  try {
    return new Intl.NumberFormat("en", {
      style: "currency",
      currency: currency.toUpperCase(),
    }).format(amount)
  } catch {
    return `${amount} ${currency.toUpperCase()}`
  }
}

const shortId = (id: string) => `…${id.slice(-6)}`

const when = (iso?: string | null) => {
  if (!iso) return ""
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      day: "numeric",
      month: "short",
      year: "numeric",
    })
  } catch {
    return iso
  }
}

export const OrderBalanceSection = ({ orderId }: { orderId: string }) => {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const prompt = usePrompt()
  const [runId, setRunId] = useState("")
  const [notes, setNotes] = useState("")

  const queryKey = ["partner-order-balance", orderId]
  const { data: balance, isLoading } = useQuery<Balance>({
    queryKey,
    queryFn: async () =>
      (await sdk.client.fetch(`/partners/orders/${orderId}/balance`, {
        method: "GET",
      })) as Balance,
  })

  const requestBalance = useMutation({
    mutationFn: async () =>
      (await sdk.client.fetch(`/partners/orders/${orderId}/request-balance`, {
        method: "POST",
      })) as { raised: boolean; reason: string | null },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey })
      toast.success(
        res.raised
          ? t("orders.balance.requested", "Balance requested")
          : t("orders.balance.nothingToRequest", "Nothing to request"),
        { description: res.reason ?? undefined }
      )
    },
    onError: (e: any) =>
      toast.error(t("orders.balance.requestFailed", "Could not request the balance"), {
        description: e?.message ?? String(e),
      }),
  })

  const decide = useMutation({
    mutationFn: async ({ decision, run }: { decision: "approved" | "rejected"; run: string }) =>
      (await sdk.client.fetch(`/partners/orders/${orderId}/sample-approval`, {
        method: "POST",
        body: {
          production_run_id: run,
          decision,
          ...(notes.trim() ? { notes: notes.trim() } : {}),
          ...(decision === "approved" ? { confirm: true } : {}),
        },
      })) as { sample_decision: { balance_raised: boolean; reason: string | null } },
    onSuccess: (res, { decision }) => {
      queryClient.invalidateQueries({ queryKey })
      setNotes("")
      if (decision === "rejected") {
        toast.success(t("orders.balance.sampleRejected", "Sample rejected"), {
          description: t(
            "orders.balance.sampleRejectedHint",
            "Recorded. Nothing was asked of the buyer."
          ),
        })
      } else {
        toast.success(
          res.sample_decision.balance_raised
            ? t("orders.balance.sampleApprovedRaised", "Sample approved — balance requested")
            : t("orders.balance.sampleApproved", "Sample approved"),
          { description: res.sample_decision.reason ?? undefined }
        )
      }
    },
    onError: (e: any) =>
      toast.error(t("orders.balance.decisionFailed", "Could not record the decision"), {
        description: e?.message ?? String(e),
      }),
  })

  if (isLoading || !balance?.has_schedule) {
    return null
  }

  const trigger = balance.balance_trigger ?? "dispatch"
  const isPaid = balance.balance_status === "paid"
  const isDue = balance.balance_status === "due"
  const decisions = balance.sample_decisions ?? []
  const sampleRuns = balance.sample_runs ?? []
  const selectedRun = runId || sampleRuns[sampleRuns.length - 1]?.id || ""

  const triggerLabel =
    trigger === "sample_approved"
      ? t("orders.balance.triggerSample", "When the buyer approves a sample")
      : trigger === "manual"
        ? t("orders.balance.triggerManual", "Only when you ask for it")
        : t("orders.balance.triggerDispatch", "When the goods ship")

  const badge = isPaid
    ? { color: "green" as const, label: t("orders.balance.paid", "Paid") }
    : isDue
      ? { color: "orange" as const, label: t("orders.balance.due", "Due") }
      : { color: "grey" as const, label: t("orders.balance.notDue", "Not due yet") }

  const approve = async () => {
    const ok = await prompt({
      title: t("orders.balance.approveTitle", "Approve the sample?"),
      description: t(
        "orders.balance.approveDescription",
        "This asks your buyer for the balance and gives them a payment link. Do it only once they have approved the sample."
      ),
      confirmText: t("orders.balance.approveConfirm", "Approve and request the balance"),
      cancelText: t("actions.cancel", "Cancel"),
    })
    if (ok) decide.mutate({ decision: "approved", run: selectedRun })
  }

  const row = (label: string, value: string, strong = false) => (
    <div className="flex items-center justify-between">
      <Text size="small" className="text-ui-fg-subtle">
        {label}
      </Text>
      <Text size="small" weight={strong ? "plus" : "regular"}>
        {value}
      </Text>
    </div>
  )

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <Heading level="h2">{t("orders.balance.title", "Balance")}</Heading>
        <StatusBadge color={badge.color}>{badge.label}</StatusBadge>
      </div>

      <div className="flex flex-col gap-y-2 px-6 py-4">
        {row(
          balance.deposit_status === "paid"
            ? t("orders.balance.depositPaid", "Deposit (paid)")
            : t("orders.balance.deposit", "Deposit"),
          money(balance.deposit_amount, balance.currency_code)
        )}
        {row(
          t("orders.balance.balance", "Balance"),
          money(balance.balance_amount, balance.currency_code),
          true
        )}
        {row(t("orders.balance.total", "Order total"), money(balance.total_due, balance.currency_code))}
        {row(t("orders.balance.dueWhen", "Balance due"), triggerLabel)}
      </div>

      {trigger === "sample_approved" && (
        <div className="flex flex-col gap-y-3 px-6 py-4">
          <Text size="small" leading="compact" weight="plus">
            {t("orders.balance.sample", "Sample")}
          </Text>

          {decisions.length > 0 ? (
            decisions.map((d, i) => (
              <div key={`${d.production_run_id}-${i}`} className="flex flex-col gap-y-0.5">
                <div className="flex items-center justify-between">
                  <StatusBadge color={d.decision === "approved" ? "green" : "red"}>
                    {d.decision === "approved"
                      ? t("orders.balance.approved", "Approved")
                      : t("orders.balance.rejected", "Rejected")}
                  </StatusBadge>
                  <Text size="xsmall" className="text-ui-fg-muted">
                    {when(d.decided_at)} · {shortId(d.production_run_id)}
                  </Text>
                </div>
                {d.notes && (
                  <Text size="xsmall" className="text-ui-fg-subtle">
                    {d.notes}
                  </Text>
                )}
              </div>
            ))
          ) : (
            <Text size="small" className="text-ui-fg-subtle">
              {t("orders.balance.noDecision", "No sample decided yet.")}
            </Text>
          )}

          {!isPaid && !isDue &&
            (sampleRuns.length === 0 ? (
              <Text size="xsmall" className="text-ui-fg-muted">
                {t(
                  "orders.balance.noSampleRun",
                  "Once the sample run for this order exists, record your buyer's verdict here."
                )}
              </Text>
            ) : (
              <div className="flex flex-col gap-y-2">
                <Select value={selectedRun} onValueChange={setRunId}>
                  <Select.Trigger>
                    <Select.Value placeholder={t("orders.balance.whichSample", "Which sample?")} />
                  </Select.Trigger>
                  <Select.Content>
                    {sampleRuns.map((r) => (
                      <Select.Item key={r.id} value={r.id}>
                        {`${t("orders.balance.sample", "Sample")} ${shortId(r.id)}${
                          r.created_at ? ` · ${when(r.created_at)}` : ""
                        }`}
                      </Select.Item>
                    ))}
                  </Select.Content>
                </Select>
                <Textarea
                  rows={2}
                  placeholder={t(
                    "orders.balance.notesPlaceholder",
                    "What the buyer said (e.g. indigo too light)"
                  )}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
                <div className="flex gap-x-2">
                  <Button
                    size="small"
                    variant="secondary"
                    className="flex-1"
                    disabled={!selectedRun || decide.isPending}
                    onClick={() => decide.mutate({ decision: "rejected", run: selectedRun })}
                  >
                    {t("orders.balance.reject", "Reject")}
                  </Button>
                  <Button
                    size="small"
                    className="flex-1"
                    disabled={!selectedRun || decide.isPending}
                    isLoading={decide.isPending}
                    onClick={approve}
                  >
                    {t("orders.balance.approve", "Approve")}
                  </Button>
                </div>
              </div>
            ))}
        </div>
      )}

      <div className="flex flex-col gap-y-3 px-6 py-4">
        {balance.reason && !isPaid && (
          <Text size="small" className="text-ui-fg-subtle">
            {balance.reason}
          </Text>
        )}
        {balance.balance_link && (
          <div className="flex flex-col gap-y-1">
            <Text size="xsmall" className="text-ui-fg-muted">
              {t("orders.balance.link", "Buyer's payment link")}
            </Text>
            <Text size="xsmall" className="break-all font-mono">
              {balance.balance_link}
            </Text>
          </div>
        )}
        {!isPaid && trigger !== "sample_approved" && (
          <Button
            size="small"
            variant="secondary"
            disabled={!balance.can_raise || requestBalance.isPending}
            isLoading={requestBalance.isPending}
            onClick={() => requestBalance.mutate()}
          >
            {isDue
              ? t("orders.balance.reissue", "Re-issue the payment link")
              : t("orders.balance.request", "Request the balance")}
          </Button>
        )}
      </div>
    </Container>
  )
}
