/**
 * @file Store API route for listing production partners
 * @description Provides endpoints for customers to browse and search available partners for custom designs
 * @module API/Store/Partners
 */

/**
 * @typedef {Object} StorePartnersQuery
 * @property {string} [limit=20] - Number of partners to return (default: 20)
 * @property {string} [offset=0] - Pagination offset (default: 0)
 * @property {string} [q] - Search term to filter partners by name, company name, or description
 * @property {string} [status=active] - Filter partners by status (active/inactive)
 */

/**
 * @typedef {Object} Partner
 * @property {string} id - Unique identifier for the partner
 * @property {string} name - Partner's display name
 * @property {string} company_name - Partner's company name
 * @property {string} handle - Partner's unique handle/username
 * @property {string} logo_url - URL to partner's logo image
 * @property {string} description - Detailed description of partner's services
 * @property {string} type - Type of partner (e.g., "manufacturer", "designer")
 * @property {string[]} specializations - Array of partner specializations
 * @property {Object} metadata - Additional partner metadata
 */

/**
 * @typedef {Object} PartnersListResponse
 * @property {Partner[]} partners - Array of partner objects
 * @property {number} count - Total number of partners matching filters
 * @property {number} offset - Current pagination offset
 * @property {number} limit - Current pagination limit
 */

/**
 * List available production partners
 * @route GET /store/custom/partners
 * @group Partner - Operations related to production partners
 * @param {string} [limit=20] - Number of partners to return
 * @param {string} [offset=0] - Pagination offset
 * @param {string} [q] - Search term for filtering partners
 * @param {string} [status=active] - Filter by partner status
 * @returns {PartnersListResponse} 200 - Paginated list of partners with filtering
 * @throws {MedusaError} 500 - Internal server error when fetching partners
 *
 * @example request
 * GET /store/custom/partners?limit=10&offset=0&q=apparel&status=active
 *
 * @example response 200
 * {
 *   "partners": [
 *     {
 *       "id": "partner_01H5Z7X9Q5J6K8M3N2P4R6S8",
 *       "name": "Jane Doe Designs",
 *       "company_name": "JDD Apparel Inc.",
 *       "handle": "janedoe",
 *       "logo_url": "https://example.com/logos/janedoe.png",
 *       "description": "Specializing in custom apparel design and production with 10+ years experience",
 *       "type": "designer",
 *       "specializations": ["apparel", "sustainable", "custom-print"],
 *       "metadata": {
 *         "years_experience": 12,
 *         "min_order": 50
 *       }
 *     },
 *     {
 *       "id": "partner_01H5Z7X9Q5J6K8M3N2P4R6S9",
 *       "name": "Acme Manufacturing",
 *       "company_name": "Acme Textiles Ltd.",
 *       "handle": "acme_manufacturing",
 *       "logo_url": "https://example.com/logos/acme.png",
 *       "description": "Large-scale textile manufacturing with global distribution",
 *       "type": "manufacturer",
 *       "specializations": ["bulk-production", "textiles", "global-shipping"],
 *       "metadata": {
 *         "production_capacity": 10000,
 *         "locations": ["US", "EU", "Asia"]
 *       }
 *     }
 *   ],
 *   "count": 2,
 *   "offset": 0,
 *   "limit": 10
 * }
 *
 * @example request with search
 * GET /store/custom/partners?q=sustainable
 *
 * @example response 200 (empty search)
 * {
 *   "partners": [],
 *   "count": 0,
 *   "offset": 0,
 *   "limit": 20
 * }
 */
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
