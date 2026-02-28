import { FetchError } from "@medusajs/js-sdk";
import { UseMutationOptions, useMutation, useQueryClient } from "@tanstack/react-query";
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
    onSuccess: (data, variables, context) => {
      // Invalidate common views that might reflect payment changes
      queryClient.invalidateQueries({ queryKey: ["persons"] });
      // Ensure partner detail pages refetch (admin partners module)
      queryClient.invalidateQueries({ queryKey: adminPartnersQueryKeys.details() });
      // Ensure person detail pages also refetch
      queryClient.invalidateQueries({ queryKey: personsQueryKeys.details() });
      // Payment methods lists may reflect payment-related changes
      queryClient.invalidateQueries({ queryKey: ["payment-methods"] });
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
      options?.onSuccess?.(data, variables, context);
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
    onSuccess: (data, variables, context) => {
      // Ensure partner and person detail pages (which render payments) are refreshed
      queryClient.invalidateQueries({ queryKey: adminPartnersQueryKeys.details() });
      queryClient.invalidateQueries({ queryKey: personsQueryKeys.details() });
      options?.onSuccess?.(data, variables, context);
    },
    ...options,
  });
};
