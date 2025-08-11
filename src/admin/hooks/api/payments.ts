import { FetchError } from "@medusajs/js-sdk";
import { UseMutationOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { sdk } from "../../lib/config";

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
      queryClient.invalidateQueries({ queryKey: ["partners-admin"] });
      queryClient.invalidateQueries({ queryKey: ["payment-methods"] });
      // If detail pages are open, invalidate detail variants
      if (Array.isArray((variables as any)?.personIds)) {
        (variables as any).personIds.forEach((pid: string) => {
          queryClient.invalidateQueries({ queryKey: ["persons", pid] });
          queryClient.invalidateQueries({ queryKey: ["persons", { id: pid }] });
        });
      }
      if (Array.isArray((variables as any)?.partnerIds)) {
        (variables as any).partnerIds.forEach((pid: string) => {
          queryClient.invalidateQueries({ queryKey: ["partners-admin", pid] });
        });
      }
      options?.onSuccess?.(data, variables, context);
    },
    ...options,
  });
};
