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
  status?: "Conceptual" | "In_Development" | "Technical_Review" | "Sample_Production" | "Revision" | "Approved" | "Rejected" | "On_Hold" | "Commerce_Ready" | "Superseded";
  priority?: "Low" | "Medium" | "High" | "Urgent";
  revised_from_id?: string | null;
  revision_number?: number;
  revision_notes?: string | null;
  target_completion_date: string | Date;
  design_files?: string[];
  thumbnail_url?: string;
  custom_sizes?: CustomSize;
  color_palette?: ColorPalette[];
  tags?: string[];
  estimated_cost?: number;
  material_cost?: number | null;
  production_cost?: number | null;
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
    onSuccess: (data, variables, _mutateResult, context) => {
      queryClient.invalidateQueries({ queryKey: designQueryKeys.lists() });
      options?.onSuccess?.(data, variables, _mutateResult, context);
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
    onSuccess: (data, variables, _mutateResult, context) => {
      queryClient.invalidateQueries({ queryKey: designQueryKeys.lists() });
      queryClient.invalidateQueries({ queryKey: designQueryKeys.detail(id) });
      options?.onSuccess?.(data, variables, _mutateResult, context);
    },
    ...options,
  });
};

/** Response of POST /admin/designs/:id/moodboard/generate — the freshly-built scene. */
export interface GenerateMoodboardResponse {
  moodboard: {
    type: "excalidraw";
    version: number;
    source: string;
    elements: any[];
    appState: Record<string, any>;
    files: Record<string, any>;
  };
}

/**
 * Seeds/regenerates the design's moodboard with a deterministic AI tech-pack scene
 * (#892): header/flats/size-set/colorways from the design's own fields + Construction
 * specs → construction details. REPLACES any existing moodboard.
 */
export const useGenerateMoodboard = (
  id: string,
  options?: UseMutationOptions<GenerateMoodboardResponse, FetchError, void>,
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () =>
      sdk.client.fetch<GenerateMoodboardResponse>(
        `/admin/designs/${id}/moodboard/generate`,
        { method: "POST" },
      ),
    onSuccess: (data, variables, _mutateResult, context) => {
      queryClient.invalidateQueries({ queryKey: designQueryKeys.detail(id) });
      options?.onSuccess?.(data, variables, _mutateResult, context);
    },
    ...options,
  });
};

/** Response of POST /admin/designs/:id/moodboard/seed — the seeded scene, or null. */
export interface SeedMoodboardResponse {
  moodboard: GenerateMoodboardResponse["moodboard"] | null;
}

/**
 * Idempotent, brief-friendly seed (#1113): fills an EMPTY `design.moodboard`
 * from the brief so the editor opens onto an editable snapshot without a manual
 * click. No-op (returns `{ moodboard: null }`) when the board already has
 * content or there's nothing to render yet. Never clobbers.
 */
export const useSeedMoodboard = (
  id: string,
  options?: UseMutationOptions<SeedMoodboardResponse, FetchError, void>,
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () =>
      sdk.client.fetch<SeedMoodboardResponse>(
        `/admin/designs/${id}/moodboard/seed`,
        { method: "POST" },
      ),
    onSuccess: (data, variables, _mutateResult, context) => {
      if (data?.moodboard) {
        queryClient.invalidateQueries({ queryKey: designQueryKeys.detail(id) });
      }
      options?.onSuccess?.(data, variables, _mutateResult, context);
    },
    ...options,
  });
};

// #1113 S4 — scoped designer invites for a single design.
export interface DesignerInvite {
  id: string;
  design_id: string;
  email: string | null;
  status: "pending" | "accepted" | "revoked" | string;
  role: string | null;
  expires_at: string | null;
  inviter_name: string | null;
  accepted_partner_id: string | null;
  accepted_at: string | null;
  created_at: string;
}

export interface DesignerInvitesResponse {
  invites: DesignerInvite[];
}

export interface CreateDesignerInviteReq {
  email?: string;
  expires_in_days?: number;
  role?: string;
  inviter_name?: string;
  metadata?: Record<string, any>;
}

export interface CreateDesignerInviteResponse {
  invite: DesignerInvite;
  /** The raw token/URL — only returned once, at creation. */
  token: string;
  url: string;
  /** Whether a notification email was dispatched (only when `email` was set). */
  emailed?: boolean;
}

export const useDesignerInvites = (
  id: string,
  options?: Omit<
    UseQueryOptions<DesignerInvitesResponse, FetchError, DesignerInvitesResponse, QueryKey>,
    "queryFn" | "queryKey"
  >,
) => {
  const { data, ...rest } = useQuery({
    queryKey: designQueryKeys.detail(id, ["designer-invites"]),
    queryFn: async () =>
      sdk.client.fetch<DesignerInvitesResponse>(
        `/admin/designs/${id}/designer-invites`,
        { method: "GET" },
      ),
    ...options,
  });
  return { ...data, invites: data?.invites ?? [], ...rest };
};

export const useCreateDesignerInvite = (
  id: string,
  options?: UseMutationOptions<CreateDesignerInviteResponse, FetchError, CreateDesignerInviteReq>,
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload) =>
      sdk.client.fetch<CreateDesignerInviteResponse>(
        `/admin/designs/${id}/designer-invites`,
        { method: "POST", body: payload },
      ),
    onSuccess: (data, variables, _mutateResult, context) => {
      queryClient.invalidateQueries({
        queryKey: designQueryKeys.detail(id, ["designer-invites"]),
      });
      options?.onSuccess?.(data, variables, _mutateResult, context);
    },
    ...options,
  });
};

export const useRevokeDesignerInvite = (
  id: string,
  options?: UseMutationOptions<
    { id: string; object: string; revoked: boolean },
    FetchError,
    string
  >,
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (inviteId) =>
      sdk.client.fetch<{ id: string; object: string; revoked: boolean }>(
        `/admin/designs/${id}/designer-invites/${inviteId}`,
        { method: "DELETE" },
      ),
    onSuccess: (data, variables, _mutateResult, context) => {
      queryClient.invalidateQueries({
        queryKey: designQueryKeys.detail(id, ["designer-invites"]),
      });
      options?.onSuccess?.(data, variables, _mutateResult, context);
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
    onSuccess: (data, variables, _mutateResult, context) => {
      queryClient.invalidateQueries({ queryKey: designQueryKeys.lists() });
      queryClient.invalidateQueries({
        queryKey: designQueryKeys.detail(id),
      });
      options?.onSuccess?.(data, variables, _mutateResult, context);
    },
    ...options,
  });
};

export interface ApproveDesignResponse {
  design: AdminDesign;
  product_id?: string;
  variant_id?: string;
}

export const useApproveDesign = (
  designId: string,
  options?: UseMutationOptions<ApproveDesignResponse, FetchError, void>
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () =>
      sdk.client.fetch<ApproveDesignResponse>(
        `/admin/designs/${designId}/approve`,
        { method: "POST", body: {} }
      ),
    onSuccess: (data, variables, _mutateResult, context) => {
      queryClient.invalidateQueries({ queryKey: designQueryKeys.lists() });
      queryClient.invalidateQueries({ queryKey: designQueryKeys.detail(designId) });
      options?.onSuccess?.(data, variables, _mutateResult, context);
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
    onSuccess: (data, variables, _mutateResult, context) => {
      queryClient.invalidateQueries({ queryKey: designQueryKeys.lists() });
      queryClient.invalidateQueries({ queryKey: designQueryKeys.detail(id) });
      queryClient.invalidateQueries({ queryKey: designQueryKeys.detail(id, ["inventory"]) });
      options?.onSuccess?.(data, variables, _mutateResult, context);
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
    onSuccess: (data, variables, _mutateResult, context) => {
      queryClient.invalidateQueries({ queryKey: designQueryKeys.lists() });
      queryClient.invalidateQueries({ queryKey: designQueryKeys.detail(id) });
      queryClient.invalidateQueries({ queryKey: designQueryKeys.detail(id, ["inventory"]) });
      options?.onSuccess?.(data, variables, _mutateResult, context);
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
    onSuccess: (data, variables, _mutateResult, context) => {
      queryClient.invalidateQueries({ queryKey: designQueryKeys.detail(designId) });
      queryClient.invalidateQueries({ queryKey: designQueryKeys.detail(designId, ["inventory"]) });
      options?.onSuccess?.(data, variables, _mutateResult, context);
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
    onSuccess: (data, variables, _mutateResult, context) => {
      queryClient.invalidateQueries({ queryKey: designQueryKeys.lists() });
      queryClient.invalidateQueries({ queryKey: designQueryKeys.detail(id) });
      options?.onSuccess?.(data, variables, _mutateResult, context);
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
    onSuccess: (data, variables, _mutateResult, context) => {
      queryClient.invalidateQueries({ queryKey: designQueryKeys.lists() });
      queryClient.invalidateQueries({ queryKey: designQueryKeys.detail(designId) });
      options?.onSuccess?.(data, variables, _mutateResult, context);
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
    onSuccess: (data, variables, _mutateResult, context) => {
      queryClient.invalidateQueries({ queryKey: designQueryKeys.lists() });
      queryClient.invalidateQueries({ queryKey: designQueryKeys.detail(designId) });
      options?.onSuccess?.(data, variables, _mutateResult, context);
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
    onSuccess: (data, variables, _mutateResult, context) => {
      queryClient.invalidateQueries({ queryKey: designQueryKeys.lists() });
      options?.onSuccess?.(data, variables, _mutateResult, context);
    },
    ...options,
  });
};

// ─── Design Revisions ──────────────────────────────────────────────────────

export interface ReviseDesignPayload {
  revision_notes: string;
  overrides?: {
    name?: string;
    priority?: string;
    designer_notes?: string;
    description?: string;
    tags?: string[];
    target_completion_date?: string;
  };
}

export interface ReviseDesignResponse {
  design: AdminDesign;
  message: string;
}

export interface DesignRevisionsResponse {
  design_id: string;
  root_design_id: string;
  current_revision: number;
  lineage: Array<{
    id: string;
    name: string;
    status: string;
    revision_number: number;
    revision_notes: string | null;
    revised_from_id: string | null;
    created_at: string;
    updated_at: string;
  }>;
}

export const useReviseDesign = (
  id: string,
  options?: UseMutationOptions<
    ReviseDesignResponse,
    FetchError,
    ReviseDesignPayload
  >,
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: ReviseDesignPayload) =>
      sdk.client.fetch<ReviseDesignResponse>(`/admin/designs/${id}/revise`, {
        method: "POST",
        body: payload,
      }),
    onSuccess: (data, variables, _mutateResult, context) => {
      queryClient.invalidateQueries({ queryKey: designQueryKeys.lists() });
      queryClient.invalidateQueries({ queryKey: designQueryKeys.detail(id) });
      options?.onSuccess?.(data, variables, _mutateResult, context);
    },
    ...options,
  });
};

export const useDesignRevisions = (
  id: string,
  options?: Omit<
    UseQueryOptions<
      DesignRevisionsResponse,
      FetchError,
      DesignRevisionsResponse,
      QueryKey
    >,
    "queryFn" | "queryKey"
  >,
) => {
  const { data, ...rest } = useQuery({
    queryKey: designQueryKeys.detail(id, ["revisions"]),
    queryFn: async () =>
      sdk.client.fetch<DesignRevisionsResponse>(`/admin/designs/${id}/revisions`, {
        method: "GET",
      }),
    ...options,
  });
  return { ...data, ...rest };
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

// ── Construction details (#892) ──────────────────────────────────────────────
// A construction detail is a DesignSpecification (category "Construction") whose
// metadata holds { technique, params, fabricRules } — the source the tech-pack
// generator reads for the construction-details frame.

export interface ConstructionDetail {
  id: string;
  title: string;
  category: string;
  details?: string | null;
  special_instructions?: string | null;
  metadata?: {
    technique?: string;
    params?: Record<string, number>;
    fabricRules?: string[];
    [k: string]: any;
  } | null;
}

export interface ConstructionDetailPayload {
  technique: string;
  label?: string;
  params?: Record<string, number>;
  fabricRules?: string[];
  note?: string;
}

const constructionDetailsKey = (designId: string) =>
  ["designs", designId, "construction-details"] as const;

export const useConstructionDetails = (designId: string) => {
  const { data, ...rest } = useQuery({
    queryKey: constructionDetailsKey(designId),
    queryFn: () =>
      sdk.client.fetch<{ construction_details: ConstructionDetail[]; count: number }>(
        `/admin/designs/${designId}/construction-details`
      ),
    enabled: !!designId,
  });
  return {
    construction_details: data?.construction_details || [],
    count: data?.count || 0,
    ...rest,
  };
};

export const useCreateConstructionDetail = (designId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: ConstructionDetailPayload) =>
      sdk.client.fetch<{ construction_detail: ConstructionDetail }>(
        `/admin/designs/${designId}/construction-details`,
        { method: "POST", body: payload }
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: constructionDetailsKey(designId) });
      queryClient.invalidateQueries({ queryKey: designQueryKeys.detail(designId) });
    },
  });
};

export const useUpdateConstructionDetail = (designId: string, detailId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: Partial<ConstructionDetailPayload>) =>
      sdk.client.fetch<{ construction_detail: ConstructionDetail }>(
        `/admin/designs/${designId}/construction-details/${detailId}`,
        { method: "PATCH", body: payload }
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: constructionDetailsKey(designId) });
      queryClient.invalidateQueries({ queryKey: designQueryKeys.detail(designId) });
    },
  });
};

export const useDeleteConstructionDetail = (designId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (detailId: string) =>
      sdk.client.fetch(
        `/admin/designs/${designId}/construction-details/${detailId}`,
        { method: "DELETE" }
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: constructionDetailsKey(designId) });
      queryClient.invalidateQueries({ queryKey: designQueryKeys.detail(designId) });
    },
  });
};

// ── Redesign (#892) — Nano-Banana structure-preserving restyle ────────────────
export interface RedesignPayload {
  image_url?: string;
  image_base64?: string;
  prompt: string;
}

export interface RedesignResponse {
  redesign: {
    image_url: string;
    provider: string;
    model: string;
    prompt: string;
  };
}

/** Generate exploratory restyle renders from an input flat/photo. Does not mutate the design. */
export const useRedesignDesign = (designId: string) => {
  return useMutation({
    mutationFn: async (payload: RedesignPayload) =>
      sdk.client.fetch<RedesignResponse>(
        `/admin/designs/${designId}/redesign`,
        { method: "POST", body: payload }
      ),
  });
};

// ── Outline (#892) — potrace vectorization → editable sewable outline ─────────
export interface OutlinePayload {
  image_url?: string;
  image_base64?: string;
  mode?: "outline" | "posterize";
  threshold?: number;
  turd_size?: number;
  opt_tolerance?: number;
  black_on_white?: boolean;
  steps?: number;
  color?: string;
  background?: string;
}

export interface OutlineResponse {
  outline: {
    svg: string;
    image_url: string;
    mode: "outline" | "posterize";
    width: number | null;
    height: number | null;
  };
}

/** Vectorize an input flat/cutout into an editable SVG outline. Does not mutate the design. */
export const useOutlineDesign = (designId: string) => {
  return useMutation({
    mutationFn: async (payload: OutlinePayload) =>
      sdk.client.fetch<OutlineResponse>(
        `/admin/designs/${designId}/outline`,
        { method: "POST", body: payload }
      ),
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
    onSuccess: (data, variables, _mutateResult, context) => {
      queryClient.invalidateQueries({ queryKey: designQueryKeys.lists() })
      options?.onSuccess?.(data, variables, _mutateResult, context)
    },
  })
}

export interface UnlinkDesignsFromCustomerResponse {
  unlinked: number
}

export const useUnlinkDesignsFromCustomer = (
  customerId: string,
  options?: UseMutationOptions<
    UnlinkDesignsFromCustomerResponse,
    FetchError,
    LinkDesignsToCustomerPayload
  >
) => {
  const queryClient = useQueryClient()
  return useMutation({
    ...options,
    mutationFn: async (payload: LinkDesignsToCustomerPayload) =>
      sdk.client.fetch<UnlinkDesignsFromCustomerResponse>(
        `/admin/customers/${customerId}/designs`,
        { method: "DELETE", body: payload }
      ),
    onSuccess: (data, variables, _mutateResult, context) => {
      queryClient.invalidateQueries({ queryKey: designQueryKeys.lists() })
      queryClient.invalidateQueries({ queryKey: ["customer-ordered-designs", customerId] })
      options?.onSuccess?.(data, variables, _mutateResult, context)
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
    onSuccess: (data, variables, _mutateResult, context) => {
      queryClient.invalidateQueries({ queryKey: designQueryKeys.lists() })
      queryClient.invalidateQueries({ queryKey: ["customer-ordered-designs", customerId] })
      options?.onSuccess?.(data, variables, _mutateResult, context)
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
  unit_cost?: number | null;
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
  unitCost?: number;
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
    onSuccess: (data, variables, _mutateResult, context) => {
      queryClient.invalidateQueries({ queryKey: designQueryKeys.detail(designId) })
      options?.onSuccess?.(data, variables, _mutateResult, context)
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
    onSuccess: (data, variables, _mutateResult, context) => {
      queryClient.invalidateQueries({ queryKey: designQueryKeys.detail(designId) })
      options?.onSuccess?.(data, variables, _mutateResult, context)
    },
    ...options,
  })
}
