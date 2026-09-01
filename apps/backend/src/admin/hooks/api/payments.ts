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
