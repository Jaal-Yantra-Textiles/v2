import {
  createWorkflow,
  createStep,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";

// ─── Types ───────────────────────────────────────────────────────────────────

type ConfidenceLevel = "exact" | "estimated" | "guesstimate";

export type MaterialCostItem = {
  inventory_item_id?: string;
  component_design_id?: string;
  name: string;
  cost: number;
  quantity: number;
  cost_source: "order_history" | "unit_cost" | "component_design" | "consumption_log" | "estimated";
};

type EstimateCostInput = {
  design_id: string;
  inventory_item_ids?: string[];
};

export type EstimateCostOutput = {
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

// Default production overhead as percentage of material cost
const DEFAULT_PRODUCTION_PERCENT = 30;

const round2 = (n: number) => Math.round(n * 100) / 100;

// ─── Pure functions (exported for unit testing) ───────────────────────────────

/**
 * Resolve the cost and source for a single inventory item given its order history.
 */
export function resolveItemCost(
  item: { id: string; title?: string; sku?: string; unit_cost?: number | null },
  orderLineLinks: Array<{
    inventory_order_line?: {
      price?: number;
      inventory_orders?: { order_date?: string; status?: string };
    };
  }>
): Pick<MaterialCostItem, "cost" | "cost_source"> {
  let latestPrice: number | null = null;
  let latestDate: Date | null = null;

  for (const link of orderLineLinks) {
    const orderLine = link.inventory_order_line;
    if (!orderLine) continue;
    const order = orderLine.inventory_orders;
    if (!order || order.status === "Cancelled") continue;
    const orderDate = order.order_date ? new Date(order.order_date) : new Date(0);
    if (!latestDate || orderDate > latestDate) {
      latestDate = orderDate;
      latestPrice = Number(orderLine.price) || 0;
    }
  }

  if (latestPrice !== null && latestPrice > 0) {
    return { cost: latestPrice, cost_source: "order_history" };
  }
  if (item.unit_cost != null && Number(item.unit_cost) > 0) {
    return { cost: Number(item.unit_cost), cost_source: "unit_cost" };
  }
  return { cost: 0, cost_source: "estimated" };
}

/**
 * Core cost calculation — pure function with no I/O.
 * Exported for unit testing.
 */
export function computeCostBreakdown(input: {
  designId: string;
  adminEstimate: number | null;
  materials: MaterialCostItem[];
  hasExactMaterialCosts: boolean;
  similarDesigns: Array<{ id: string; name: string; estimated_cost: number }>;
}): EstimateCostOutput {
  const materialCost = input.materials.reduce((sum, m) => sum + m.cost * m.quantity, 0);
  const { adminEstimate, similarDesigns } = input;

  let productionCost: number;
  let productionPercent: number;
  let productionIsEstimated = true;

  if (adminEstimate != null && adminEstimate > 0 && materialCost > 0) {
    productionCost = Math.max(0, adminEstimate - materialCost);
    productionPercent = (productionCost / materialCost) * 100;
    productionIsEstimated = false; // admin set a concrete estimate
  } else if (adminEstimate != null && adminEstimate > 0 && materialCost === 0) {
    const materialShare = adminEstimate / (1 + DEFAULT_PRODUCTION_PERCENT / 100);
    productionCost = adminEstimate - materialShare;
    productionPercent = DEFAULT_PRODUCTION_PERCENT;
  } else if (similarDesigns.length > 0 && materialCost > 0) {
    const avgSimilarCost =
      similarDesigns.reduce((s, d) => s + d.estimated_cost, 0) / similarDesigns.length;
    const impliedProduction = Math.max(avgSimilarCost - materialCost, materialCost * 0.1);
    productionCost = Math.min(impliedProduction, materialCost * 0.6);
    productionPercent = (productionCost / materialCost) * 100;
  } else {
    productionCost = materialCost * (DEFAULT_PRODUCTION_PERCENT / 100);
    productionPercent = DEFAULT_PRODUCTION_PERCENT;
  }

  const totalEstimated = materialCost + productionCost;

  const hasAnyRealData = input.materials.some(
    (m) =>
      m.cost_source === "order_history" ||
      m.cost_source === "unit_cost" ||
      m.cost_source === "component_design" ||
      m.cost_source === "consumption_log"
  );

  let confidence: ConfidenceLevel;
  if (input.hasExactMaterialCosts && !productionIsEstimated) {
    confidence = "exact";
  } else if (hasAnyRealData || similarDesigns.length > 0 || adminEstimate != null) {
    confidence = "estimated";
  } else {
    confidence = "guesstimate";
  }

  return {
    design_id: input.designId,
    material_cost: round2(materialCost),
    production_cost: round2(productionCost),
    total_estimated: round2(totalEstimated),
    confidence,
    breakdown: {
      materials: input.materials,
      production_percent: Math.round(productionPercent),
    },
    similar_designs: similarDesigns.length > 0 ? similarDesigns : undefined,
  };
}

// ─── Step 1: Get design, linked inventory items, and components ───────────────

const getDesignWithInventoryStep = createStep(
  "get-design-with-inventory-step",
  async (input: EstimateCostInput, { container }) => {
    const query = container.resolve(ContainerRegistrationKeys.QUERY) as any;

    const { data: designs } = await query.graph({
      entity: "design",
      filters: { id: input.design_id },
      fields: [
        "id",
        "name",
        "design_type",
        "estimated_cost",
        "material_cost",
        "production_cost",
        "cost_breakdown",
        "tags",
        "inventory_items.*",
        // Pull component links with the sub-design's cost
        "components.id",
        "components.quantity",
        "components.role",
        "components.component_design.id",
        "components.component_design.name",
        "components.component_design.estimated_cost",
      ],
    });

    if (!designs || designs.length === 0) {
      throw new Error(`Design not found: ${input.design_id}`);
    }

    const design = designs[0];

    // Resolve inventory item IDs: explicit override → linked items
    let inventoryItemIds = input.inventory_item_ids;
    if (!inventoryItemIds || inventoryItemIds.length === 0) {
      inventoryItemIds = (design.inventory_items || []).map((item: any) => item.id);
    }

    // Build planned-quantity map from design-inventory link
    const plannedQuantityMap: Record<string, number> = {};
    try {
      const { data: designInventoryLinks } = await query.graph({
        entity: "design_inventory_item",
        filters: { design_id: input.design_id },
        fields: ["inventory_item_id", "planned_quantity"],
      });
      for (const link of designInventoryLinks || []) {
        if (link.inventory_item_id && link.planned_quantity != null) {
          plannedQuantityMap[link.inventory_item_id] = Number(link.planned_quantity) || 1;
        }
      }
    } catch {
      // Link table may not exist yet — fall back to quantity 1 per item
    }

    // Collect component designs with their costs
    const componentItems: Array<{
      component_design_id: string;
      name: string;
      estimated_cost: number | null;
      quantity: number;
    }> = (design.components || []).map((link: any) => ({
      component_design_id: link.component_design?.id ?? link.component_design_id,
      name: link.component_design?.name ?? link.component_design_id,
      estimated_cost: link.component_design?.estimated_cost != null
        ? Number(link.component_design.estimated_cost)
        : null,
      quantity: link.quantity ?? 1,
    }));

    return new StepResponse({
      design,
      inventoryItemIds,
      plannedQuantityMap,
      componentItems,
    });
  }
);

// ─── Step 2: Get material costs from inventory order history + component costs ─

const getMaterialCostsStep = createStep(
  "get-material-costs-step",
  async (
    input: {
      design_id: string;
      inventoryItemIds: string[];
      plannedQuantityMap: Record<string, number>;
      componentItems: Array<{
        component_design_id: string;
        name: string;
        estimated_cost: number | null;
        quantity: number;
      }>;
    },
    { container }
  ) => {
    const query = container.resolve(ContainerRegistrationKeys.QUERY) as any;
    const consumptionLogService = container.resolve("consumption_log") as any;
    const materials: MaterialCostItem[] = [];
    let allExact = true;

    // ── Inventory item costs ──────────────────────────────────────────────────
    if (input.inventoryItemIds && input.inventoryItemIds.length > 0) {
      const { data: inventoryItems } = await query.graph({
        entity: "inventory_item",
        filters: { id: input.inventoryItemIds },
        fields: ["id", "title", "sku", "unit_cost"],
      });

      for (const item of inventoryItems || []) {
        // Find most recent non-cancelled order line price
        let latestPrice: number | null = null;
        let latestDate: Date | null = null;

        const { data: orderLineLinks } = await query.graph({
          entity: "inventory_order_line_inventory_item",
          filters: { inventory_item_id: item.id },
          fields: [
            "inventory_order_line.id",
            "inventory_order_line.price",
            "inventory_order_line.inventory_orders.order_date",
            "inventory_order_line.inventory_orders.status",
          ],
        });

        for (const link of orderLineLinks || []) {
          const orderLine = (link as any).inventory_order_line;
          if (!orderLine) continue;
          const order = orderLine.inventory_orders;
          if (!order || order.status === "Cancelled") continue;
          const orderDate = order.order_date ? new Date(order.order_date) : new Date(0);
          if (!latestDate || orderDate > latestDate) {
            latestDate = orderDate;
            latestPrice = Number(orderLine.price) || 0;
          }
        }

        let cost: number;
        let cost_source: MaterialCostItem["cost_source"];
        if (latestPrice !== null && latestPrice > 0) {
          cost = latestPrice;
          cost_source = "order_history";
        } else if (item.unit_cost != null && Number(item.unit_cost) > 0) {
          cost = Number(item.unit_cost);
          cost_source = "unit_cost";
          allExact = false;
        } else {
          // Fallback chain: raw material unit_cost → consumption logs → estimated (0)
          let resolvedCost = 0;
          let resolvedSource: MaterialCostItem["cost_source"] = "estimated";

          // Check linked raw material's unit_cost
          try {
            const { data: rmLinks } = await query.graph({
              entity: "inventory_item_raw_materials",
              filters: { inventory_item_id: item.id },
              fields: ["raw_materials.unit_cost"],
            });
            const rmCost = Number(rmLinks?.[0]?.raw_materials?.unit_cost) || 0;
            if (rmCost > 0) {
              resolvedCost = rmCost;
              resolvedSource = "unit_cost";
            }
          } catch {
            // Link may not exist
          }

          // If still no cost, check committed consumption logs for this design + item
          if (resolvedCost <= 0) {
            try {
              const [logs] = await consumptionLogService.listAndCountConsumptionLogs(
                {
                  design_id: input.design_id,
                  inventory_item_id: item.id,
                  is_committed: true,
                },
                { take: 1, order: { consumed_at: "DESC" } }
              );
              const latestLog = logs?.[0];
              if (latestLog?.unit_cost && Number(latestLog.unit_cost) > 0) {
                resolvedCost = Number(latestLog.unit_cost);
                resolvedSource = "consumption_log";
              }
            } catch {
              // Non-fatal
            }
          }

          cost = resolvedCost;
          cost_source = resolvedSource;
          allExact = false;
        }

        const quantity = input.plannedQuantityMap[item.id] ?? 1;
        materials.push({
          inventory_item_id: item.id,
          name: item.title || item.sku || item.id,
          cost,
          quantity,
          cost_source,
        });
      }
    }

    // ── Component design costs ────────────────────────────────────────────────
    // Each bundled sub-design contributes its estimated_cost × quantity
    for (const comp of input.componentItems || []) {
      if (comp.estimated_cost != null && comp.estimated_cost > 0) {
        materials.push({
          component_design_id: comp.component_design_id,
          name: comp.name,
          cost: comp.estimated_cost,
          quantity: comp.quantity,
          cost_source: "component_design",
        });
        // Component costs are always "estimated" unless we recursively resolve them
        allExact = false;
      } else {
        // Component has no cost set — include at 0 so caller knows it exists
        materials.push({
          component_design_id: comp.component_design_id,
          name: comp.name,
          cost: 0,
          quantity: comp.quantity,
          cost_source: "estimated",
        });
        allExact = false;
      }
    }

    return new StepResponse({ materials, hasExactCosts: allExact && materials.length > 0 });
  }
);

// ─── Step 3: Find similar designs for production overhead reference ───────────

const findSimilarDesignsStep = createStep(
  "find-similar-designs-step",
  async (input: { design: any }, { container }) => {
    const query = container.resolve(ContainerRegistrationKeys.QUERY) as any;

    const filters: any = {
      id: { $ne: input.design.id },
      estimated_cost: { $ne: null },
    };
    if (input.design.design_type) {
      filters.design_type = input.design.design_type;
    }

    const { data: similarDesigns } = await query.graph({
      entity: "design",
      filters,
      fields: ["id", "name", "estimated_cost", "design_type"],
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

// ─── Step 4: Calculate total cost estimate ────────────────────────────────────

const calculateTotalCostStep = createStep(
  "calculate-total-cost-step",
  async (input: {
    design: any;
    materials: MaterialCostItem[];
    hasExactMaterialCosts: boolean;
    similarDesigns: Array<{ id: string; name: string; estimated_cost: number }>;
  }) => {
    const design = input.design;

    // If a sample run has already calculated costs, use the stored breakdown
    // This is more accurate than re-estimating from scratch
    const costBreakdown = design.cost_breakdown as any;
    if (
      costBreakdown?.source === "sample_consumption" &&
      design.material_cost != null &&
      design.production_cost != null
    ) {
      const materialCost = Number(design.material_cost) || 0;
      const productionCost = Number(design.production_cost) || 0;
      const serviceCostTotal = Number(costBreakdown.service_cost_total) || 0;
      const totalEstimated = Number(design.estimated_cost) || (materialCost + productionCost);

      return new StepResponse({
        design_id: design.id,
        material_cost: round2(materialCost),
        production_cost: round2(productionCost),
        total_estimated: round2(totalEstimated),
        confidence: "exact" as ConfidenceLevel,
        breakdown: {
          materials: costBreakdown.items || input.materials,
          production_percent: materialCost > 0
            ? Math.round((productionCost / materialCost) * 100)
            : 0,
          service_costs: costBreakdown.service_costs,
          service_cost_total: serviceCostTotal > 0 ? round2(serviceCostTotal) : undefined,
          source: "sample_consumption",
        },
      } as EstimateCostOutput);
    }

    // No sample data — estimate from scratch
    const result = computeCostBreakdown({
      designId: design.id,
      adminEstimate: design.estimated_cost ? Number(design.estimated_cost) : null,
      materials: input.materials,
      hasExactMaterialCosts: input.hasExactMaterialCosts,
      similarDesigns: input.similarDesigns,
    });
    return new StepResponse(result);
  }
);

// ─── Workflow ─────────────────────────────────────────────────────────────────

export const estimateDesignCostWorkflow = createWorkflow(
  "estimate-design-cost",
  (input: EstimateCostInput) => {
    const designResult = getDesignWithInventoryStep(input);

    const materialsResult = getMaterialCostsStep({
      design_id: input.design_id,
      inventoryItemIds: designResult.inventoryItemIds as unknown as string[],
      plannedQuantityMap: designResult.plannedQuantityMap as unknown as Record<string, number>,
      componentItems: designResult.componentItems as unknown as Array<{
        component_design_id: string;
        name: string;
        estimated_cost: number | null;
        quantity: number;
      }>,
    });

    const similarResult = findSimilarDesignsStep({
      design: designResult.design,
    });

    const result = calculateTotalCostStep({
      design: designResult.design,
      materials: materialsResult.materials as unknown as MaterialCostItem[],
      hasExactMaterialCosts: materialsResult.hasExactCosts as unknown as boolean,
      similarDesigns: similarResult.similarDesigns as unknown as Array<{
        id: string;
        name: string;
        estimated_cost: number;
      }>,
    });

    return new WorkflowResponse(result);
  }
);

export default estimateDesignCostWorkflow;
