import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";

interface StorePartnersQuery {
  limit?: string;
  offset?: string;
  q?: string;
  status?: string;
}

/**
 * GET /store/custom/partners
 * 
 * Lists partners available for production.
 * Customers can see and select partners for their custom designs.
 */
export async function GET(
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> {
  try {
    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
    const params = req.query as StorePartnersQuery;
    const limit = Number(params.limit ?? 20);
    const offset = Number(params.offset ?? 0);

    // Query partners - only show active/verified partners to customers
    const { data: partners } = await query.graph({
      entity: "partner",
      filters: {
        status: (params.status || "active") as any,
        is_verified: true,
      },
      fields: [
        "id",
        "name",
        "company_name",
        "handle",
        "logo_url",
        "description",
        "type",
        "specializations",
        "metadata",
      ],
    });

    const allPartners = partners || [];
    const total = allPartners.length;
    
    // Apply search filter if provided
    let filteredPartners = allPartners;
    if (params.q) {
      const searchTerm = params.q.toLowerCase();
      filteredPartners = allPartners.filter((p: any) => 
        p.name?.toLowerCase().includes(searchTerm) ||
        p.company_name?.toLowerCase().includes(searchTerm) ||
        p.description?.toLowerCase().includes(searchTerm)
      );
    }

    // Paginate
    const paginated = filteredPartners.slice(offset, offset + limit);

    res.status(200).json({
      partners: paginated,
      count: filteredPartners.length,
      offset,
      limit,
    });
  } catch (error) {
    console.error("[Store] Error fetching partners:", error);
    res.status(500).json({
      message: "Failed to fetch partners",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
