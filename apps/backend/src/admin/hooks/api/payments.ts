import { FetchError } from "@medusajs/js-sdk";
import {
  QueryKey,
  UseMutationOptions,
  UseQueryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { sdk } from "../../lib/config";
import { partnersQueryKeys as adminPartnersQueryKeys } from "./partners-admin";
import { personsQueryKeys } from "./persons";
import { inventoryOrderQueryKeys } from "./inventory-orders";

export type AdminPayment = Record<string, any>;

export const useCreatePaymentAndLink = (
  options?: UseMutationOptions<{ payment: AdminPayment }, FetchError, Record<string, any>>
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: Record<string, any>) =>
      sdk.client.fetch<{ payment: AdminPayment }>(`/admin/payments/link`, {
        method: "POST",
        body: payload,
      }),
    onSuccess: (data, variables, _mutateResult, context) => {
      // Invalidate common views that might reflect payment changes
      queryClient.invalidateQueries({ queryKey: ["persons"] });
      // Ensure partner detail pages refetch (admin partners module)
      queryClient.invalidateQueries({ queryKey: adminPartnersQueryKeys.details() });
      // Ensure person detail pages also refetch
      queryClient.invalidateQueries({ queryKey: personsQueryKeys.details() });
      // Payment methods lists may reflect payment-related changes
      queryClient.invalidateQueries({ queryKey: ["payment-methods"] });
      // …and the merged partner ledger, which renders the new payment (#1612).
      queryClient.invalidateQueries({ queryKey: [PARTNER_LEDGER_QUERY_KEY] });
      // If detail pages are open, invalidate detail variants
      if (Array.isArray((variables as any)?.personIds)) {
        (variables as any).personIds.forEach((pid: string) => {
          queryClient.invalidateQueries({ queryKey: ["persons", pid] });
          queryClient.invalidateQueries({ queryKey: ["persons", { id: pid }] });
        });
      }
      if (Array.isArray((variables as any)?.partnerIds)) {
        // details() invalidation already covers all partner detail queries; keep for clarity
        (variables as any).partnerIds.forEach((pid: string) => {
          queryClient.invalidateQueries({ queryKey: adminPartnersQueryKeys.detail(pid) });
        });
      }
      if (Array.isArray((variables as any)?.inventoryOrderIds)) {
        queryClient.invalidateQueries({ queryKey: inventoryOrderQueryKeys.details() });
        (variables as any).inventoryOrderIds.forEach((oid: string) => {
          queryClient.invalidateQueries({ queryKey: inventoryOrderQueryKeys.detail(oid) });
        });
      }
      options?.onSuccess?.(data, variables, _mutateResult, context);
    },
    ...options,
  });
};

// Update a payment (e.g., status)
export type AdminUpdatePayment = Partial<{
  amount: number;
  status: "Pending" | "Processing" | "Completed" | "Failed" | "Cancelled";
  payment_type: "Bank" | "Cash" | "Digital_Wallet";
  payment_date: Date | string;
  metadata: Record<string, any> | null | undefined;
  paid_to_id: string | undefined;
}>;

export const useUpdatePayment = (
  paymentId: string,
  options?: UseMutationOptions<{ payment: AdminPayment }, FetchError, AdminUpdatePayment>
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: AdminUpdatePayment) =>
      sdk.client.fetch<{ payment: AdminPayment }>(`/admin/payments/${paymentId}`, {
        method: "POST",
        body: payload,
      }),
    onSuccess: (data, variables, _mutateResult, context) => {
      // Ensure partner and person detail pages (which render payments) are refreshed
      queryClient.invalidateQueries({ queryKey: adminPartnersQueryKeys.details() });
      queryClient.invalidateQueries({ queryKey: personsQueryKeys.details() });
      // The merged partner ledger is a separate query and would otherwise keep
      // showing the pre-update status (#1612).
      queryClient.invalidateQueries({ queryKey: [PARTNER_LEDGER_QUERY_KEY] });
      options?.onSuccess?.(data, variables, _mutateResult, context);
    },
    ...options,
  });
};

// ─── Partner ledger (#1612) ─────────────────────────────────────────────────

/**
 * One entry in a partner's merged ledger. `kind` is authoritative — the panel
 * never sniffs which record an entry came from.
 */
export type PartnerLedgerEntry = {
  id: string;
  kind: "payout" | "payment";
  status: string | null;
  amount: number;
  currency: string;
  occurred_at: string | null;
  // payout
  submission_id?: string | null;
  lines?: any[];
  submitted_at?: string | null;
  reviewed_at?: string | null;
  paid_at?: string | null;
  notes?: string | null;
  settled_by?: {
    payment_id: string;
    payment_type: string | null;
    payment_date: string | null;
    status: string | null;
  } | null;
  /**
   * Money already recorded against a source this payout ALSO bills (#1710).
   *
   * 🔴 Declare it here or the panel cannot read it. A flag the server sends for
   * months with no entry in the client TYPE has zero readers (#1679) — the same
   * shape that let an order headline "INR 0 paid" over INR 20,000 of completed
   * payments.
   */
  recorded_against?: Array<{
    payment_id: string;
    amount: number;
    status: string | null;
    payment_type: string | null;
    payment_date: string | null;
    via: "submission" | "inventory_order";
    inventory_order_id: string | null;
    inventory_order_name: string | null;
  }>;
  recorded_against_total?: number;
  /**
   * What has been SETTLED against this payout by payments a human linked to it
   * (#1710). Capped at the payout's own amount.
   *
   * ⚠️ Was read by `payoutSettlementBadge` through its own local type while
   * absent from THIS one — the #1679 shape, one edit away from a reader that
   * silently sees `undefined`. Declared here now.
   */
  settled_amount?: number;
  /**
   * Other payouts that share a payment with this one (#1712 defect 2).
   *
   * Present only when a payment really is linked to more than one payout.
   * Declared here so the panel can explain a payout showing less settled than
   * the linked payment's face value — otherwise the gap reads as an arithmetic
   * bug rather than as money already spent on another claim.
   */
  settled_shared_with?: string[];
  /**
   * Credits a human APPLIED to this payout (#1712).
   *
   * 🔴 Declared here for the same reason as `recorded_against` above: a flag
   * the server sends that the client TYPE never declares has zero readers
   * (#1679). Unlike `recorded_against` this is NOT advisory — it has already
   * reduced `outstanding`, so a panel that cannot see it shows a smaller
   * amount owed with nothing on screen explaining why.
   */
  credits_applied?: Array<{
    credit_id: string;
    amount: number;
    reason: string | null;
    applied_at: string | null;
  }>;
  credited_amount?: number;
  // payment
  payment_type?: string | null;
  payment_date?: string | null;
  attachments?: any[];
  paid_to?: any;
  /** Which inventory order this money was recorded against (#1710). */
  inventory_order_id?: string | null;
  inventory_order_name?: string | null;
};

export type PartnerLedgerResponse = {
  entries: PartnerLedgerEntry[];
  totals: {
    billed: number;
    paid: number;
    outstanding: number;
    recorded: number;
    /** Of `recorded`, what sits against a source an UNPAID payout bills (#1710). */
    recorded_against_open: number;
    /**
     * Of `billed`, what applied credits discharged (#1712).
     *
     * ⚠️ Separate from `paid` on purpose. `paid` means money that transferred;
     * a founder reconciling this panel against a bank statement must not find
     * a figure no statement explains. `outstanding` is `billed - paid - credited`.
     */
    credited: number;
    currency: string | null;
  };
  count: number;
};

export const PARTNER_LEDGER_QUERY_KEY = "partner-ledger" as const;

/**
 * Both money records for a partner, in one list.
 *
 * 🔴 Do NOT go back to reading `partner.internal_payments`. Since #1638 a
 * payout writes no payment row, so that field is history only — a panel built
 * on it is silently incomplete rather than empty (#1621).
 */
export const usePartnerLedger = (
  partnerId: string,
  options?: Omit<
    UseQueryOptions<PartnerLedgerResponse, FetchError, PartnerLedgerResponse, QueryKey>,
    "queryFn" | "queryKey"
  >,
) => {
  const { data, ...rest } = useQuery({
    queryKey: [PARTNER_LEDGER_QUERY_KEY, partnerId],
    queryFn: async () =>
      sdk.client.fetch<PartnerLedgerResponse>(
        `/admin/payments/partners/${partnerId}/ledger`,
        { method: "GET" },
      ),
    ...options,
  });
  return { ...data, ...rest };
};

/**
 * State that a payment settles a payout — or take it back (#1710).
 *
 * 🔑 The human act the ledger refuses to perform on its own. The panel WARNS
 * that money sits against an order an unpaid payout bills; it will not decide
 * that the money discharges the payout, because a payment on an order may be an
 * advance, a deposit, or money for a different delivery. This is where a person
 * says which — after which it counts toward `paid` and the payout is settled in
 * PART.
 */
export const useSetPaymentSettles = (paymentId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      payment_submission_id,
      settles,
    }: {
      payment_submission_id: string;
      settles: boolean;
    }) =>
      settles
        ? sdk.client.fetch(`/admin/payments/${paymentId}/settles`, {
            method: "POST",
            body: { payment_submission_id },
          })
        : sdk.client.fetch(
            `/admin/payments/${paymentId}/settles?payment_submission_id=${payment_submission_id}`,
            { method: "DELETE" },
          ),
    onSuccess: () => {
      // The ledger's totals move with this — `paid` and `outstanding` both
      // change — so a stale panel would show the old figures beside the new
      // state and read as if nothing happened.
      queryClient.invalidateQueries({ queryKey: [PARTNER_LEDGER_QUERY_KEY] });
      queryClient.invalidateQueries({ queryKey: adminPartnersQueryKeys.details() });
    },
  });
};


// ─── Partner credits (#1712) ────────────────────────────────────────────────

/**
 * Money a partner already holds that no payout consumed.
 *
 * ⚠️ `inventory_order_id` is the EARMARK — a second link the create route
 * writes, which no read exposed until #1712's follow-up. It says where the
 * money was meant to be consumed; it does not restrict which payout the credit
 * may be applied to.
 */
export type PartnerCredit = {
  id: string;
  amount: number;
  currency_code: string | null;
  status: "Open" | "Applied" | "Cancelled" | string;
  source_type: string | null;
  reason: string | null;
  source_submission_id: string | null;
  applied_to_submission_id: string | null;
  applied_at: string | null;
  inventory_order_id: string | null;
};

export type PartnerCreditsResponse = {
  credits: PartnerCredit[];
  count: number;
  /** Only `Open` credits — an `Applied` one has already reduced a payout. */
  open_total: number;
  currency: string | null;
};

export const PARTNER_CREDITS_QUERY_KEY = "partner-credits" as const;

export const usePartnerCredits = (
  partnerId: string,
  options?: Omit<
    UseQueryOptions<PartnerCreditsResponse, FetchError, PartnerCreditsResponse, QueryKey>,
    "queryFn" | "queryKey"
  >,
) => {
  const { data, ...rest } = useQuery({
    queryKey: [PARTNER_CREDITS_QUERY_KEY, partnerId],
    queryFn: async () =>
      sdk.client.fetch<PartnerCreditsResponse>(
        `/admin/partners/${partnerId}/credits`,
        { method: "GET" },
      ),
    ...options,
  });
  return { ...data, ...rest };
};

/**
 * Consume a credit against one payout (#1712).
 *
 * 🔑 The deliberate act. A credit is DISPLAYED beside `outstanding` and never
 * netted against it automatically, because whether money already given
 * discharges the next payout is a decision a human makes. This is where they
 * make it.
 *
 * Forward-only — there is no unapply, so the panel confirms before calling.
 */
export const useApplyPartnerCredit = (partnerId: string, creditId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ submission_id }: { submission_id: string }) =>
      sdk.client.fetch<{
        credit: PartnerCredit;
        submission_id: string;
        remaining_before: number;
        remaining_after: number;
      }>(`/admin/partners/${partnerId}/credits/${creditId}/apply`, {
        method: "POST",
        body: { submission_id },
      }),
    onSuccess: () => {
      /**
       * BOTH lists move: the credit leaves `open_total`, and the ledger's
       * `credited` and `outstanding` change. Invalidating one would leave the
       * other showing the pre-apply figures beside the new state — which reads
       * as though nothing happened.
       */
      queryClient.invalidateQueries({ queryKey: [PARTNER_CREDITS_QUERY_KEY] });
      queryClient.invalidateQueries({ queryKey: [PARTNER_LEDGER_QUERY_KEY] });
      queryClient.invalidateQueries({ queryKey: adminPartnersQueryKeys.details() });
    },
  });
};
