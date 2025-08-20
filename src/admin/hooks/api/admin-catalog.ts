import { UseMutationOptions, useMutation } from "@tanstack/react-query"
import { sdk } from "../../lib/config"

export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH"

export type AdminEndpoint = {
  id: string
  method: HttpMethod
  path: string
  summary: string
  tags?: string[]
  pathParams?: string[]
  queryParams?: string[]
  queryParamsSchema?: Array<{ name: string; required?: boolean; schema?: any; description?: string }>
  requestBodyRequired?: boolean
  requestBodySchema?: any
}

// Curated starter catalog. Expand as needed from https://docs.medusajs.com/api/admin
export const ADMIN_API_CATALOG: AdminEndpoint[] = [
  {
    id: "list_products",
    method: "GET",
    path: "/admin/products",
    summary: "List products",
    tags: ["products"],
    queryParams: ["q", "limit", "offset", "status"],
  },
  {
    id: "create_product",
    method: "POST",
    path: "/admin/products",
    summary: "Create a product",
    tags: ["products"],
  },
  {
    id: "retrieve_product",
    method: "GET",
    path: "/admin/products/{id}",
    summary: "Retrieve a product",
    tags: ["products"],
    pathParams: ["id"],
  },
  {
    id: "list_inventory_items",
    method: "GET",
    path: "/admin/inventory-items",
    summary: "List inventory items",
    tags: ["inventory"],
    queryParams: ["q", "limit", "offset"],
  },
  {
    id: "create_inventory_item",
    method: "POST",
    path: "/admin/inventory-items",
    summary: "Create an inventory item",
    tags: ["inventory"],
  },
  {
    id: "list_stock_locations",
    method: "GET",
    path: "/admin/stock-locations",
    summary: "List stock locations",
    tags: ["inventory"],
    queryParams: ["q", "limit", "offset"],
  },
  {
    id: "list_orders",
    method: "GET",
    path: "/admin/orders",
    summary: "List orders",
    tags: ["orders"],
    queryParams: ["q", "limit", "offset", "status"],
  },
  {
    id: "retrieve_order",
    method: "GET",
    path: "/admin/orders/{id}",
    summary: "Retrieve an order",
    tags: ["orders"],
    pathParams: ["id"],
  },
  {
    id: "list_customers",
    method: "GET",
    path: "/admin/customers",
    summary: "List customers",
    tags: ["customers"],
    queryParams: ["q", "limit", "offset"],
  },
]

export const useAdminApiCatalog = (filter?: string) => {
  const f = (filter || "").toLowerCase().trim()
  const items = !f
    ? ADMIN_API_CATALOG
    : ADMIN_API_CATALOG.filter((e) =>
        [
          e.id,
          e.summary,
          e.path,
          ...(e.tags || []),
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(f)
      )
  return { items }
}

// Remote catalog powered by OpenAPI -> exposed at /admin/ai/openapi/catalog
export const useRemoteAdminApiCatalog = async (filter?: string) => {
  try {
    const res = (await sdk.client.fetch("/admin/ai/openapi/catalog", { method: "GET" })) as {
      items: AdminEndpoint[]
    }
    const list = res?.items || []
    const f = (filter || "").toLowerCase().trim()
    const items = !f
      ? list
      : list.filter((e) =>
          [e.id, e.summary, e.path, ...(e.tags || [])]
            .filter(Boolean)
            .join(" ")
            .toLowerCase()
            .includes(f)
        )
    return { items, source: "remote" as const }
  } catch (e) {
    // Fallback to static
    const { items } = useAdminApiCatalog(filter)
    return { items, source: "static" as const }
  }
}

export type AdminApiRequest = {
  method: HttpMethod
  path: string // may contain placeholders like {id}
  pathParams?: Record<string, string>
  query?: Record<string, any>
  body?: any
}

function buildPath(path: string, pathParams?: Record<string, string>) {
  if (!pathParams) return path
  let out = path
  for (const [k, v] of Object.entries(pathParams)) {
    out = out.replace(new RegExp(`{${k}}`, "g"), encodeURIComponent(String(v)))
    // Note: \\b (word boundary) needs double escaping in string literal
    out = out.replace(new RegExp(`:${k}\\b`, "g"), encodeURIComponent(String(v)))
  }
  return out
}

export type AdminApiResponse<T = any> = { result: T }

export const useAdminApiExecutor = (
  options?: UseMutationOptions<AdminApiResponse, unknown, AdminApiRequest>
) => {
  return useMutation({
    mutationFn: async (req: AdminApiRequest) => {
      const url = buildPath(req.path, req.pathParams)
      const search = req.query ? `?${new URLSearchParams(Object.entries(req.query).map(([k, v]) => [k, String(v)])).toString()}` : ""

      const method = req.method.toUpperCase() as HttpMethod
      const hasBody = !(method === "GET" || method === "DELETE") && req.body !== undefined

      const init: any = { method }
      if (hasBody) {
        init.body = req.body
      }

      const response = (await sdk.client.fetch(`${url}${search}`, init)) as AdminApiResponse
      return response
    },
    ...options,
  })
}
