import { FetchError } from "@medusajs/js-sdk";
import {  PaginatedResponse, DateComparisonOperator } from "@medusajs/types";
import {
  QueryKey,
  UseMutationOptions,
  UseQueryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { sdk } from "../../lib/config";
import { queryKeysFactory } from "../../lib/query-key-factory";

export interface ColorPalette {
  name: string;
  code: string;
}

export interface FeedbackHistory {
  date: string | Date;
  feedback: string;
  author: string;
}

export interface CustomSize {
  [key: string]: {
    [measurement: string]: number;
  };
}

export interface DesignColor {
  id?: string;
  name: string;
  hex_code: string;
  usage_notes?: string;
  order?: number;
}

export interface DesignSizeSet {
  id?: string;
  size_label: string;
  measurements: Record<string, number>;
}

export interface DesignMedia {
  id?: string;
  url: string;
  isThumbnail?: boolean;
}

export interface AdminDesign {
  id: string;
  name: string;
  description?: string;
  inspiration_sources?: string[];
  design_type?: "Original" | "Derivative" | "Custom" | "Collaboration";
  status?: "Conceptual" | "In_Development" | "Technical_Review" | "Sample_Production" | "Revision" | "Approved" | "Rejected" | "On_Hold";
  priority?: "Low" | "Medium" | "High" | "Urgent";
  target_completion_date: string | Date;
  design_files?: string[];
  thumbnail_url?: string;
  custom_sizes?: CustomSize;
  color_palette?: ColorPalette[];
  tags?: string[];
  estimated_cost?: number;
  tasks?: any[]; // Array of design tasks
  designer_notes?: string;
  feedback_history?: FeedbackHistory[];
  media_files?: DesignMedia[];
  metadata?: Record<string, any> | null | undefined;
  moodboard?: Record<string, any> | null;
  colors?: Array<DesignColor>;
  size_sets?: Array<DesignSizeSet>;
  created_at?: Date;
  updated_at?: Date;
  partner_id?: string;
}

export type CreateAdminDesignPayload = Omit<AdminDesign, "id" | "created_at" | "updated_at">;
export type UpdateAdminDesignPayload = Partial<CreateAdminDesignPayload>;

export interface AdminDesignResponse {
  design: AdminDesign;
}

export interface AdminDesignsResponse {
  designs: AdminDesign[];
  count: number;
  offset: number;
  limit: number;
}

export interface AdminDesignsQuery {
  offset?: number;
  limit?: number;
  name?: string;
  design_type?: AdminDesign["design_type"];
  status?: AdminDesign["status"];
  priority?: AdminDesign["priority"];
  tags?: string[];
  partner_id?: string;
  customer_id?: string;
  created_at?: DateComparisonOperator;
  target_completion_date?: DateComparisonOperator;
  q?: string;
}

export interface LinkDesignPartner {
  partnerIds: string[];
}

export interface SendDesignToPartnerPayload {
  partnerId: string
  notes?: string
}

export interface SendDesignToPartnerResponse {
  message: string
  designId: string
  partnerId: string
  transactionId: string
}

const DESIGN_QUERY_KEY = "designs" as const;
export const designQueryKeys = queryKeysFactory(DESIGN_QUERY_KEY);

export interface DesignQuery {
  fields?: string[];
}

export const useDesign = (
  id: string,
  query?: DesignQuery,
  options?: Omit<
    UseQueryOptions<
      AdminDesignResponse,
      FetchError,
      AdminDesignResponse,
      QueryKey
    >,
    "queryFn" | "queryKey"
  >,
) => {
  const { data, ...rest } = useQuery({
    queryKey: designQueryKeys.detail(id),
    queryFn: async () =>
      sdk.client.fetch<AdminDesignResponse>(`/admin/designs/${id}`, {
        method: "GET",
        query: query?.fields
          ? {
              fields: query.fields.join(","),
            }
          : undefined,
      }),
    ...options,
  });
  return { ...data, ...rest };
};

export const useDesigns = (
  query?: AdminDesignsQuery,
  options?: Omit<
    UseQueryOptions<
      PaginatedResponse<AdminDesignsResponse>,
      FetchError,
      PaginatedResponse<AdminDesignsResponse>,
      QueryKey
    >,
    "queryFn" | "queryKey"
  >,
) => {
  const { data, ...rest } = useQuery({
    queryFn: async () =>
      sdk.client.fetch<PaginatedResponse<AdminDesignsResponse>>(
        `/admin/designs`,
        {
          method: "GET",
          query,
        },
      ),
    queryKey: designQueryKeys.list(query),
    ...options,
  });
  
  // Properly extract the paginated data
  return { 
    designs: data?.designs || [], 
    count: data?.count || 0,
    offset: query?.offset || 0,
    limit: query?.limit || 0,
    ...rest 
  };
};

export const useCreateDesign = (
  options?: UseMutationOptions<
    AdminDesignResponse,
    FetchError,
    CreateAdminDesignPayload
  >,
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: CreateAdminDesignPayload) =>
      sdk.client.fetch<AdminDesignResponse>(`/admin/designs`, {
        method: "POST",
        body: payload,
      }),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({ queryKey: designQueryKeys.lists() });
      options?.onSuccess?.(data, variables, context);
    },
    ...options,
  });
};

export const useUpdateDesign = (
  id: string,
  options?: UseMutationOptions<
    AdminDesignResponse,
    FetchError,
    UpdateAdminDesignPayload
  >,
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: UpdateAdminDesignPayload) =>
      sdk.client.fetch<AdminDesignResponse>(`/admin/designs/${id}`, {
        method: "PUT",
        body: payload,
      }),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({ queryKey: designQueryKeys.lists() });
      queryClient.invalidateQueries({ queryKey: designQueryKeys.detail(id) });
      options?.onSuccess?.(data, variables, context);
    },
    ...options,
  });
};

export const useDeleteDesign = (
  id: string,
  options?: UseMutationOptions<AdminDesign, FetchError, void>,
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () =>
      sdk.client.fetch<AdminDesign>(`/admin/designs/${id}`, {
        method: "DELETE",
      }),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({ queryKey: designQueryKeys.lists() });
      queryClient.invalidateQueries({
        queryKey: designQueryKeys.detail(id),
      });
      options?.onSuccess?.(data, variables, context);
    },
    ...options,
  });
};

export interface PlannedInventoryItemPayload {
  inventoryId: string;
  plannedQuantity?: number;
  locationId?: string;
  metadata?: Record<string, any>;
}

export interface LinkDesignInventoryPayload {
  inventoryIds?: string[];
  inventoryItems?: PlannedInventoryItemPayload[];
}

export interface UpdateInventoryLinkPayload {
  plannedQuantity?: number | null;
  locationId?: string | null;
  metadata?: Record<string, any> | null;
}

export interface LinkedInventoryItem {
  inventory_item_id: string;
  inventory_id?: string;
  planned_quantity?: number;
  consumed_quantity?: number;
  consumed_at?: string;
  location_id?: string;
  metadata?: Record<string, any>;
  inventory_item?: {
    id: string;
    title?: string;
    sku?: string;
    thumbnail?: string | null;
    [key: string]: any;
  };
}

export interface DesignInventoryResponse {
  inventory_items: LinkedInventoryItem[];
}

export const useDesignInventory = (
  id: string,
  options?: Omit<
    UseQueryOptions<
      DesignInventoryResponse,
      FetchError,
      DesignInventoryResponse,
      QueryKey
    >,
    "queryFn" | "queryKey"
  >,
) => {
  return useQuery({
    queryKey: designQueryKeys.detail(id, ["inventory"]),
    queryFn: async () =>
      sdk.client.fetch<DesignInventoryResponse>(`/admin/designs/${id}/inventory`, {
        method: "GET",
      }),
    ...options,
  });
};

export const useLinkDesignInventory = (
  id: string,
  options?: UseMutationOptions<
    AdminDesignResponse,
    FetchError,
    LinkDesignInventoryPayload
  >,
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: LinkDesignInventoryPayload) =>
      sdk.client.fetch<AdminDesignResponse>(`/admin/designs/${id}/inventory`, {
        method: "POST",
        body: data,
      }),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({ queryKey: designQueryKeys.lists() });
      queryClient.invalidateQueries({ queryKey: designQueryKeys.detail(id) });
      queryClient.invalidateQueries({ queryKey: designQueryKeys.detail(id, ["inventory"]) });
      options?.onSuccess?.(data, variables, context);
    },
    ...options,
  });
};

export const useDelinkInventory = (
  id: string,
  options?: UseMutationOptions<
    AdminDesignResponse,
    FetchError,
    LinkDesignInventoryPayload
  >,
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: LinkDesignInventoryPayload) =>
      sdk.client.fetch<AdminDesignResponse>(`/admin/designs/${id}/inventory/delink`, {
        method: "POST",
        body: data,
      }),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({ queryKey: designQueryKeys.lists() });
      queryClient.invalidateQueries({ queryKey: designQueryKeys.detail(id) });
      queryClient.invalidateQueries({ queryKey: designQueryKeys.detail(id, ["inventory"]) });
      options?.onSuccess?.(data, variables, context);
    },
    ...options,
  });
};

export const useUpdateInventoryLink = (
  designId: string,
  inventoryId: string,
  options?: UseMutationOptions<AdminDesignResponse, FetchError, UpdateInventoryLinkPayload>
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: UpdateInventoryLinkPayload) =>
      sdk.client.fetch<AdminDesignResponse>(`/admin/designs/${designId}/inventory/${inventoryId}`, {
        method: "PATCH",
        body: data,
      }),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({ queryKey: designQueryKeys.detail(designId) });
      queryClient.invalidateQueries({ queryKey: designQueryKeys.detail(designId, ["inventory"]) });
      options?.onSuccess?.(data, variables, context);
    },
    ...options,
  });
};

export const useLinkDesignToPartner = (
    id: string,
    options?: UseMutationOptions<
    AdminDesignResponse,
    FetchError,
    LinkDesignPartner
  >,
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: LinkDesignPartner) =>
      sdk.client.fetch<AdminDesignResponse>(`/admin/designs/${id}/partner`, {
        method: "POST",
        body: data,
      }),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({ queryKey: designQueryKeys.lists() });
      queryClient.invalidateQueries({ queryKey: designQueryKeys.detail(id) });
      options?.onSuccess?.(data, variables, context);
    },
    ...options,
  });
}

export const useUnlinkDesignFromPartner = (
  designId: string,
  options?: UseMutationOptions<
    { design_id: string; partner_id: string; unlinked: boolean },
    FetchError,
    { partnerId: string }
  >,
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: { partnerId: string }) =>
      sdk.client.fetch<{ design_id: string; partner_id: string; unlinked: boolean }>(
        `/admin/designs/${designId}/partner`,
        { method: "DELETE", body: data }
      ),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({ queryKey: designQueryKeys.lists() });
      queryClient.invalidateQueries({ queryKey: designQueryKeys.detail(designId) });
      options?.onSuccess?.(data, variables, context);
    },
    ...options,
  });
}

export const useCancelPartnerAssignment = (
  designId: string,
  options?: UseMutationOptions<
    { design_id: string; partner_id: string; cancelled_tasks: number; unlinked: boolean; message: string },
    FetchError,
    { partner_id: string; unlink?: boolean }
  >,
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: { partner_id: string; unlink?: boolean }) =>
      sdk.client.fetch<{ design_id: string; partner_id: string; cancelled_tasks: number; unlinked: boolean; message: string }>(
        `/admin/designs/${designId}/cancel-partner-assignment`,
        { method: "POST", body: data }
      ),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({ queryKey: designQueryKeys.lists() });
      queryClient.invalidateQueries({ queryKey: designQueryKeys.detail(designId) });
      options?.onSuccess?.(data, variables, context);
    },
    ...options,
  });
}

export const useSendDesignToPartner = (
  id: string,
  options?: UseMutationOptions<
    SendDesignToPartnerResponse,
    FetchError,
    SendDesignToPartnerPayload
  >
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: SendDesignToPartnerPayload) =>
      sdk.client.fetch<SendDesignToPartnerResponse>(`/admin/designs/${id}/send-to-partner`, {
        method: "POST",
        body: data,
      }),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({ queryKey: designQueryKeys.lists() });
      queryClient.invalidateQueries({ queryKey: designQueryKeys.detail(id) });
      options?.onSuccess?.(data, variables, context);
    },
    ...options,
  });
}

export interface CreateDesignLLMPayload {
  designPrompt: string;
  existingValues?: Record<string, any>;
}

export const useCreateDesignLLM = (
  options?: UseMutationOptions<
    AdminDesignResponse,
    FetchError,
    CreateDesignLLMPayload
  >
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: CreateDesignLLMPayload) =>
      sdk.client.fetch<AdminDesignResponse>(`/admin/designs/auto`, {
        method: "POST",
        body: data,
      }),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({ queryKey: designQueryKeys.lists() });
      options?.onSuccess?.(data, variables, context);
    },
    ...options,
  });
};

// ─── Design Components (bundling) ───────────────────────────────────────────

export interface DesignComponentLink {
  id: string;
  quantity: number;
  role?: string | null;
  notes?: string | null;
  order: number;
  metadata?: Record<string, any> | null;
  parent_design_id: string;
  component_design_id: string;
  component_design?: AdminDesign;
  parent_design?: AdminDesign;
}

export interface AddDesignComponentPayload {
  component_design_id: string;
  quantity?: number;
  role?: string;
  notes?: string;
  order?: number;
  metadata?: Record<string, any>;
}

export interface UpdateDesignComponentPayload {
  quantity?: number;
  role?: string | null;
  notes?: string | null;
  order?: number;
  metadata?: Record<string, any> | null;
}

const designComponentsKey = (designId: string) => ["designs", designId, "components"] as const;
const designUsedInKey = (designId: string) => ["designs", designId, "used-in"] as const;

export const useDesignComponents = (designId: string) => {
  const { data, ...rest } = useQuery({
    queryKey: designComponentsKey(designId),
    queryFn: () =>
      sdk.client.fetch<{ components: DesignComponentLink[]; count: number }>(
        `/admin/designs/${designId}/components`
      ),
    enabled: !!designId,
  });
  return { components: data?.components || [], count: data?.count || 0, ...rest };
};

export const useDesignUsedIn = (designId: string) => {
  const { data, ...rest } = useQuery({
    queryKey: designUsedInKey(designId),
    queryFn: () =>
      sdk.client.fetch<{ used_in: DesignComponentLink[]; count: number }>(
        `/admin/designs/${designId}/used-in`
      ),
    enabled: !!designId,
  });
  return { used_in: data?.used_in || [], count: data?.count || 0, ...rest };
};

export const useAddDesignComponent = (designId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: AddDesignComponentPayload) =>
      sdk.client.fetch<{ component: DesignComponentLink }>(
        `/admin/designs/${designId}/components`,
        { method: "POST", body: payload }
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: designComponentsKey(designId) });
    },
  });
};

export const useUpdateDesignComponent = (designId: string, componentId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: UpdateDesignComponentPayload) =>
      sdk.client.fetch<{ component: DesignComponentLink }>(
        `/admin/designs/${designId}/components/${componentId}`,
        { method: "PATCH", body: payload }
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: designComponentsKey(designId) });
    },
  });
};

export const useRemoveDesignComponent = (designId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (componentId: string) =>
      sdk.client.fetch(
        `/admin/designs/${designId}/components/${componentId}`,
        { method: "DELETE" }
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: designComponentsKey(designId) });
    },
  });
};

export interface NotifyDesignCustomerResponse {
  message: string
  design_id: string
  customer_id: string
}

export const useNotifyDesignCustomer = (
  designId: string,
  options?: UseMutationOptions<NotifyDesignCustomerResponse, FetchError, void>
) => {
  return useMutation({
    mutationFn: async () =>
      sdk.client.fetch<NotifyDesignCustomerResponse>(
        `/admin/designs/${designId}/notify-customer`,
        { method: "POST" }
      ),
    ...options,
  });
};

// ─── Customer Ordered Designs ───────────────────────────────────────────────

export interface OrderedDesign extends AdminDesign {
  order_ids: string[]
}

export interface OrderedDesignsResponse {
  designs: OrderedDesign[]
}

export const useCustomerOrderedDesigns = (
  customerId: string,
  options?: Omit<
    UseQueryOptions<OrderedDesignsResponse, FetchError, OrderedDesignsResponse, QueryKey>,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryKey: ["customer-ordered-designs", customerId],
    queryFn: async () =>
      sdk.client.fetch<OrderedDesignsResponse>(
        `/admin/customers/${customerId}/designs/ordered`,
        { method: "GET" }
      ),
    ...options,
  })
  return { designs: data?.designs || [], ...rest }
}

// ─── Customer-Design Linking ────────────────────────────────────────────────

export interface LinkDesignsToCustomerPayload {
  design_ids: string[]
}

export interface LinkDesignsToCustomerResponse {
  linked: number
}

export const useLinkDesignsToCustomer = (
  customerId: string,
  options?: UseMutationOptions<
    LinkDesignsToCustomerResponse,
    FetchError,
    LinkDesignsToCustomerPayload
  >
) => {
  const queryClient = useQueryClient()
  return useMutation({
    ...options,
    mutationFn: async (payload: LinkDesignsToCustomerPayload) =>
      sdk.client.fetch<LinkDesignsToCustomerResponse>(
        `/admin/customers/${customerId}/designs`,
        { method: "POST", body: payload }
      ),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({ queryKey: designQueryKeys.lists() })
      options?.onSuccess?.(data, variables, context)
    },
  })
}

// ─── Create Draft Order from Designs ────────────────────────────────────────

export interface CreateDesignOrderPayload {
  design_ids: string[]
  currency_code?: string
  price_overrides?: Record<string, number>
  /** Currency of price_overrides (e.g. "inr"). Defaults to store default. */
  override_currency?: string
}

export interface CreateDesignOrderResponse {
  cart: any
  checkout_url: string
}

export interface DesignEstimatePreview {
  design_id: string
  name: string
  total_estimated: number
  unit_price: number
  confidence: string
  material_cost: number
  production_cost: number
}

export interface PreviewDesignOrderResponse {
  estimates: DesignEstimatePreview[]
  currency_code: string
  total: number
}

export const usePreviewDesignOrder = (
  customerId: string,
  options?: UseMutationOptions<
    PreviewDesignOrderResponse,
    FetchError,
    CreateDesignOrderPayload
  >
) => {
  return useMutation({
    mutationFn: async (payload: CreateDesignOrderPayload) =>
      sdk.client.fetch<PreviewDesignOrderResponse>(
        `/admin/customers/${customerId}/design-order/preview`,
        { method: "POST", body: payload }
      ),
    ...options,
  })
}

export const useCreateDesignOrder = (
  customerId: string,
  options?: UseMutationOptions<
    CreateDesignOrderResponse,
    FetchError,
    CreateDesignOrderPayload
  >
) => {
  const queryClient = useQueryClient()
  return useMutation({
    ...options,
    mutationFn: async (payload: CreateDesignOrderPayload) =>
      sdk.client.fetch<CreateDesignOrderResponse>(
        `/admin/customers/${customerId}/design-order`,
        { method: "POST", body: payload }
      ),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({ queryKey: designQueryKeys.lists() })
      queryClient.invalidateQueries({ queryKey: ["customer-ordered-designs", customerId] })
      options?.onSuccess?.(data, variables, context)
    },
  })
}

// ─── Consumption Logs ────────────────────────────────────────────────

export interface ConsumptionLog {
  id: string;
  design_id: string;
  inventory_item_id: string;
  raw_material_id?: string | null;
  quantity: number;
  unit_of_measure: string;
  consumption_type: "sample" | "production" | "wastage";
  is_committed: boolean;
  consumed_by: "admin" | "partner";
  consumed_at: string;
  notes?: string | null;
  location_id?: string | null;
  metadata?: Record<string, any> | null;
  created_at?: string;
  updated_at?: string;
}

export interface ConsumptionLogsListResponse {
  logs: ConsumptionLog[];
  count: number;
}

export interface LogConsumptionPayload {
  inventoryItemId: string;
  rawMaterialId?: string;
  quantity: number;
  unitOfMeasure?: string;
  consumptionType?: "sample" | "production" | "wastage";
  notes?: string;
  locationId?: string;
  metadata?: Record<string, any>;
}

export interface CommitConsumptionPayload {
  logIds?: string[];
  commitAll?: boolean;
  defaultLocationId?: string;
}

export const useDesignConsumptionLogs = (
  designId: string,
  params?: Record<string, any>,
  options?: Omit<
    UseQueryOptions<ConsumptionLogsListResponse, FetchError, ConsumptionLogsListResponse, QueryKey>,
    "queryFn" | "queryKey"
  >
) => {
  return useQuery({
    queryKey: designQueryKeys.detail(designId, ["consumption-logs", params]),
    queryFn: async () => {
      const searchParams = new URLSearchParams()
      if (params) {
        Object.entries(params).forEach(([k, v]) => {
          if (v !== undefined && v !== null && v !== "") searchParams.set(k, String(v))
        })
      }
      const qs = searchParams.toString()
      return sdk.client.fetch<ConsumptionLogsListResponse>(
        `/admin/designs/${designId}/consumption-logs${qs ? `?${qs}` : ""}`,
        { method: "GET" }
      )
    },
    ...options,
  })
}

export const useLogConsumption = (
  designId: string,
  options?: UseMutationOptions<{ consumption_log: ConsumptionLog }, FetchError, LogConsumptionPayload>
) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload: LogConsumptionPayload) =>
      sdk.client.fetch<{ consumption_log: ConsumptionLog }>(
        `/admin/designs/${designId}/consumption-logs`,
        { method: "POST", body: payload }
      ),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({ queryKey: designQueryKeys.detail(designId) })
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useCommitConsumption = (
  designId: string,
  options?: UseMutationOptions<any, FetchError, CommitConsumptionPayload>
) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload: CommitConsumptionPayload) =>
      sdk.client.fetch<any>(
        `/admin/designs/${designId}/consumption-logs/commit`,
        { method: "POST", body: payload }
      ),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({ queryKey: designQueryKeys.detail(designId) })
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}
