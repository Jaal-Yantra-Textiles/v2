import { FetchError } from "@medusajs/js-sdk";
import {
  useMutation,
  UseMutationOptions,
  useQuery,
  UseQueryOptions,
  QueryKey,
  useQueryClient,
} from "@tanstack/react-query";
import { sdk } from "../../lib/config";
import { queryKeysFactory } from "../../lib/query-key-factory";
import { inventoryOrderQueryKeys } from "./inventory-orders";

export interface AdminInventoryOrderTask {
  id: string;
  title?: string;
  description?: string;
  status: string;
  priority?: string;
  start_date?: string;
  end_date?: string;
  due_date?: string;
  metadata?: Record<string, any>;
  created_at: string;
  updated_at: string;
}

export type TaskStatus = "pending" | "in_progress" | "completed" | "blocked";
export type TaskPriority = "low" | "medium" | "high";

export interface AdminInventoryOrderTaskResponse {
  task: AdminInventoryOrderTask;
}

export interface UpdateInventoryOrderTaskPayload {
  title?: string;
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  due_date?: Date;
  metadata?: Record<string, any>;
}

const INVENTORY_ORDER_TASK_QUERY_KEY = "inventory-order-tasks" as const;
export const inventoryOrderTaskQueryKeys = queryKeysFactory(INVENTORY_ORDER_TASK_QUERY_KEY);

interface InventoryOrderTaskQuery {
  fields?: string[];
}

export const useInventoryOrderTask = (
  inventoryOrderId: string,
  taskId: string,
  query?: InventoryOrderTaskQuery,
  options?: Omit<
    UseQueryOptions<AdminInventoryOrderTaskResponse, FetchError, AdminInventoryOrderTaskResponse, QueryKey>,
    "queryFn" | "queryKey"
  >,
) => {
  const { data, ...rest } = useQuery({
    queryFn: async () =>
      sdk.client.fetch(`/admin/inventory-orders/${inventoryOrderId}/tasks/${taskId}`, {
        query,
      }) as Promise<AdminInventoryOrderTaskResponse>,
    queryKey: inventoryOrderTaskQueryKeys.detail(taskId),
    ...options,
  });

  return { ...data, ...rest } as const;
};

export const useUpdateInventoryOrderTask = (
  inventoryOrderId: string,
  taskId: string,
  options?: UseMutationOptions<AdminInventoryOrderTaskResponse, FetchError, UpdateInventoryOrderTaskPayload>,
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: UpdateInventoryOrderTaskPayload) =>
      sdk.client.fetch(`/admin/inventory-orders/${inventoryOrderId}/tasks/${taskId}`, {
        method: "POST",
        body: payload,
      }) as Promise<AdminInventoryOrderTaskResponse>,
    onSuccess: (...args) => {
      // invalidate task detail query
      queryClient.invalidateQueries({ queryKey: inventoryOrderTaskQueryKeys.detail(taskId) });
      // invalidate inventory order detail query to refresh tasks list
      queryClient.invalidateQueries({ queryKey: inventoryOrderQueryKeys.detail(inventoryOrderId) });
      options?.onSuccess?.(...args);
    },
    ...options,
  });
};
