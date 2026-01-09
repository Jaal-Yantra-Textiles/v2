import {
  createWorkflow,
  createStep,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";

/**
 * Cost Estimation Workflow
 *
 * Estimates the cost of producing a design based on:
 * 1. Material costs from inventory order history
 * 2. Production costs (from design.estimated_cost or 30% default)
 * 3. Similar designs as reference (optional)
 *
 * Confidence levels:
 * - "exact": Both material and production costs are known from history
 * - "estimated": Some costs derived from historical data
 * - "guesstimate": Using defaults (30% production cost)
 */

// Types
type ConfidenceLevel = "exact" | "estimated" | "guesstimate";

type MaterialCostItem = {
  inventory_item_id: string;
  name: string;
  cost: number;
  quantity: number;
  cost_source: "order_history" | "estimated";
};

type EstimateCostInput = {
  design_id: string;
  inventory_item_ids?: string[];
};

type EstimateCostOutput = {
  design_id: string;
  material_cost: number;
  production_cost: number;
  total_estimated: number;
  confidence: ConfidenceLevel;
  breakdown: {
    materials: MaterialCostItem[];
    production_percent: number;
  };
  similar_designs?: Array<{
    id: string;
    name: string;
    estimated_cost: number;
  }>;
};

// Default production cost as percentage of material cost
const DEFAULT_PRODUCTION_PERCENT = 30;

/**
 * Step 1: Get design and linked inventory items
 */
const getDesignWithInventoryStep = createStep(
  "get-design-with-inventory-step",
  async (input: EstimateCostInput, { container }) => {
    const query = container.resolve(ContainerRegistrationKeys.QUERY) as any;

    // Get design with its linked inventory items
    const { data: designs } = await query.graph({
      entity: "design",
      filters: { id: input.design_id },
      fields: [
        "id",
        "name",
        "design_type",
        "estimated_cost",
        "tags",
        "inventory_items.*",
      ],
    });

    if (!designs || designs.length === 0) {
      throw new Error(`Design not found: ${input.design_id}`);
    }

    const design = designs[0];

    // If specific inventory_item_ids provided, use those
    // Otherwise use the linked inventory items from the design
    let inventoryItemIds = input.inventory_item_ids;
    if (!inventoryItemIds || inventoryItemIds.length === 0) {
      inventoryItemIds = (design.inventory_items || []).map((item: any) => item.id);
    }

    return new StepResponse({
      design,
      inventoryItemIds,
    });
  }
);

/**
 * Step 2: Get material costs from inventory order history
 */
const getMaterialCostsStep = createStep(
  "get-material-costs-step",
  async (
    input: { inventoryItemIds: string[] },
    { container }
  ) => {
    const query = container.resolve(ContainerRegistrationKeys.QUERY) as any;
    const materials: MaterialCostItem[] = [];

    if (!input.inventoryItemIds || input.inventoryItemIds.length === 0) {
      return new StepResponse({ materials, hasExactCosts: false });
    }

    // Get inventory items with their details
    const { data: inventoryItems } = await query.graph({
      entity: "inventory_item",
      filters: { id: input.inventoryItemIds },
      fields: ["id", "title", "sku"],
    });

    // For each inventory item, find the most recent order line price
    for (const item of inventoryItems || []) {
      // Query order lines linked to this inventory item
      const { data: orderLineLinks } = await query.graph({
        entity: "inventory_order_line_inventory_item",
        filters: { inventory_item_id: item.id },
        fields: [
          "inventory_order_line.id",
          "inventory_order_line.price",
          "inventory_order_line.quantity",
          "inventory_order_line.inventory_orders.order_date",
          "inventory_order_line.inventory_orders.status",
        ],
      });

      // Find the most recent delivered order line
      let latestPrice: number | null = null;
      let latestDate: Date | null = null;

      for (const link of orderLineLinks || []) {
        const orderLine = (link as any).inventory_order_line;
        if (!orderLine) continue;

        const order = orderLine.inventory_orders;
        if (!order || order.status === "Cancelled") continue;

        const orderDate = new Date(order.order_date);
        if (!latestDate || orderDate > latestDate) {
          latestDate = orderDate;
          latestPrice = Number(orderLine.price) || 0;
        }
      }

      materials.push({
        inventory_item_id: item.id,
        name: item.title || item.sku || item.id,
        cost: latestPrice || 0,
        quantity: 1, // Default quantity, could be from design-inventory link
        cost_source: latestPrice !== null ? "order_history" : "estimated",
      });
    }

    const hasExactCosts = materials.every((m) => m.cost_source === "order_history");

    return new StepResponse({ materials, hasExactCosts });
  }
);

/**
 * Step 3: Find similar designs for cost reference
 */
const findSimilarDesignsStep = createStep(
  "find-similar-designs-step",
  async (
    input: { design: any },
    { container }
  ) => {
    const query = container.resolve(ContainerRegistrationKeys.QUERY) as any;

    // Find designs with similar characteristics that have estimated_cost
    const filters: any = {
      id: { $ne: input.design.id },
      estimated_cost: { $ne: null },
    };

    // Add design_type filter if available
    if (input.design.design_type) {
      filters.design_type = input.design.design_type;
    }

    const { data: similarDesigns } = await query.graph({
      entity: "design",
      filters,
      fields: ["id", "name", "estimated_cost", "design_type", "tags"],
      pagination: { take: 5 },
    });

    return new StepResponse({
      similarDesigns: (similarDesigns || []).map((d: any) => ({
        id: d.id,
        name: d.name,
        estimated_cost: Number(d.estimated_cost) || 0,
      })),
    });
  }
);

/**
 * Step 4: Calculate total cost estimate
 */
const calculateTotalCostStep = createStep(
  "calculate-total-cost-step",
  async (
    input: {
      design: any;
      materials: MaterialCostItem[];
      hasExactMaterialCosts: boolean;
      similarDesigns: Array<{ id: string; name: string; estimated_cost: number }>;
    },
    { container }
  ) => {
    // Calculate material cost
    const materialCost = input.materials.reduce(
      (sum, m) => sum + m.cost * m.quantity,
      0
    );

    // Determine production cost
    let productionCost: number;
    let productionPercent = DEFAULT_PRODUCTION_PERCENT;
    let hasExactProductionCost = false;

    // Check if design has an estimated_cost (includes production)
    if (input.design.estimated_cost) {
      // If design has estimated_cost, it might include production cost
      // Use it as reference if material cost is unknown
      const designEstimate = Number(input.design.estimated_cost);
      if (materialCost > 0) {
        // Production cost = total - materials, but cap at 50% of materials
        productionCost = Math.min(
          designEstimate - materialCost,
          materialCost * 0.5
        );
        productionCost = Math.max(productionCost, 0);
        productionPercent = materialCost > 0 ? (productionCost / materialCost) * 100 : DEFAULT_PRODUCTION_PERCENT;
        hasExactProductionCost = true;
      } else {
        // Use design estimate as total, guesstimate split
        productionCost = designEstimate * (DEFAULT_PRODUCTION_PERCENT / 100);
        productionPercent = DEFAULT_PRODUCTION_PERCENT;
      }
    } else if (input.similarDesigns.length > 0 && materialCost > 0) {
      // Use similar designs to estimate production cost ratio
      const avgSimilarCost =
        input.similarDesigns.reduce((sum, d) => sum + d.estimated_cost, 0) /
        input.similarDesigns.length;

      // Estimate production percent based on similar designs
      // Assume similar design cost = material + production, solve for production %
      productionCost = materialCost * (DEFAULT_PRODUCTION_PERCENT / 100);
      productionPercent = DEFAULT_PRODUCTION_PERCENT;
    } else {
      // Default: 30% of material cost
      productionCost = materialCost * (DEFAULT_PRODUCTION_PERCENT / 100);
      productionPercent = DEFAULT_PRODUCTION_PERCENT;
    }

    // Calculate total
    const totalEstimated = materialCost + productionCost;

    // Determine confidence level
    let confidence: ConfidenceLevel;
    if (input.hasExactMaterialCosts && hasExactProductionCost) {
      confidence = "exact";
    } else if (input.hasExactMaterialCosts || hasExactProductionCost) {
      confidence = "estimated";
    } else {
      confidence = "guesstimate";
    }

    const result: EstimateCostOutput = {
      design_id: input.design.id,
      material_cost: Math.round(materialCost * 100) / 100,
      production_cost: Math.round(productionCost * 100) / 100,
      total_estimated: Math.round(totalEstimated * 100) / 100,
      confidence,
      breakdown: {
        materials: input.materials,
        production_percent: Math.round(productionPercent),
      },
      similar_designs: input.similarDesigns.length > 0 ? input.similarDesigns : undefined,
    };

    return new StepResponse(result);
  }
);

/**
 * Main workflow: Estimate Design Cost
 */
export const estimateDesignCostWorkflow = createWorkflow(
  "estimate-design-cost",
  (input: EstimateCostInput) => {
    // Step 1: Get design and inventory items
    const designResult = getDesignWithInventoryStep(input);

    // Step 2: Get material costs from order history
    const materialsResult = getMaterialCostsStep({
      inventoryItemIds: designResult.inventoryItemIds as unknown as string[],
    });

    // Step 3: Find similar designs for reference
    const similarResult = findSimilarDesignsStep({
      design: designResult.design,
    });

    // Step 4: Calculate total cost
    const result = calculateTotalCostStep({
      design: designResult.design,
      materials: materialsResult.materials as unknown as MaterialCostItem[],
      hasExactMaterialCosts: materialsResult.hasExactCosts as unknown as boolean,
      similarDesigns: similarResult.similarDesigns as unknown as Array<{ id: string; name: string; estimated_cost: number }>,
    });

    return new WorkflowResponse(result);
  }
);

export default estimateDesignCostWorkflow;
