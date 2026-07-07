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
  cost_source: "order_history" | "unit_cost" | "component_design" | "consumption_log" | "estimated" | "default";
  /** Per-material commission (line cost × platform_fee_percent). Set when a fee applies. */
  commission?: number;
};

type EstimateCostInput = {
  design_id: string;
  inventory_item_ids?: string[];
  /**
   * Partner-entered production cost per finished unit. When provided it is the
   * authoritative production figure — it overrides every derived estimate
   * (including the DEFAULT_PRODUCTION_PERCENT fallback). Partner recalc route.
   */
  production_cost_override?: number | null;
  /**
   * JYT platform commission as a percentage of material cost. Opt-in per
   * caller — defaults to 0 so store/admin/draft-order flows are unaffected;
   * only the partner recalc route passes DEFAULT_PLATFORM_FEE_PERCENT.
   */
  platform_fee_percent?: number;
  /**
   * Fallback per-unit cost for a material with no resolved cost. Opt-in per
   * caller — defaults to 0 (off) so store/admin/draft-order flows are
   * unaffected; the partner recalc route passes DEFAULT_MATERIAL_COST.
   */
  default_material_cost?: number;
};

export type EstimateCostOutput = {
  design_id: string;
  material_cost: number;
  production_cost: number;
  /** JYT platform commission (materialCost × platform_fee_percent). 0 when opted out. */
  platform_fee: number;
  total_estimated: number;
  confidence: ConfidenceLevel;
  breakdown: {
    materials: MaterialCostItem[];
    production_percent: number;
    platform_fee_percent: number;
  };
  similar_designs?: Array<{
    id: string;
    name: string;
    estimated_cost: number;
  }>;
};

// Default production overhead as percentage of material cost
const DEFAULT_PRODUCTION_PERCENT = 30;

// Default JYT platform commission on partner production work, as a percentage
// of material cost. Only applied when a caller opts in (partner recalc route).
export const DEFAULT_PLATFORM_FEE_PERCENT = 10;

// Fallback per-material cost (INR) when a BOM material has no resolved price
// (no order history, no unit_cost, no consumption log). Only applied when a
// caller opts in (partner recalc route) via default_material_cost.
export const DEFAULT_MATERIAL_COST = 600;

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
  /**
   * Per-unit production cost taken from the latest completed production run
   * (the partner's actual submitted cost). When present it wins over any
   * derived figure — an actual cost is more authoritative than an estimate
   * residual. #456
   */
  actualProductionCost?: number | null;
  /**
   * Partner-entered production cost per finished unit. Highest precedence — a
   * value the partner typed is authoritative, so it beats even a completed
   * run's actual cost. A value of 0 is respected (explicitly "no production
   * cost"); only null/undefined falls through to the derived waterfall.
   */
  productionCostOverride?: number | null;
  /** JYT platform commission as a percentage of material cost. Default 0. */
  platformFeePercent?: number;
  /** Fallback per-unit cost for a material with no resolved cost. Default 0 (off). */
  defaultMaterialCost?: number;
}): EstimateCostOutput {
  const { adminEstimate, similarDesigns } = input;
  const platformFeePercent = input.platformFeePercent ?? 0;
  const defaultMaterialCost = input.defaultMaterialCost ?? 0;

  // Resolve each BOM material: fall back to defaultMaterialCost when it has no
  // resolved price, and attach the per-material commission (its share of the
  // platform fee). The resolved list — not the raw input — drives material cost
  // and the persisted breakdown.
  const materials: MaterialCostItem[] = input.materials.map((m) => {
    const useDefault = (!m.cost || m.cost <= 0) && defaultMaterialCost > 0;
    const cost = useDefault ? defaultMaterialCost : m.cost;
    const cost_source = useDefault ? "default" : m.cost_source;
    const commission = round2(cost * m.quantity * (platformFeePercent / 100));
    return { ...m, cost, cost_source, commission };
  });
  const materialCost = materials.reduce((sum, m) => sum + m.cost * m.quantity, 0);

  let productionCost: number;
  let productionPercent: number;
  let productionIsEstimated = true;

  if (input.productionCostOverride != null && input.productionCostOverride >= 0) {
    // Partner typed their production cost — authoritative, wins over everything.
    productionCost = input.productionCostOverride;
    productionPercent = materialCost > 0 ? (productionCost / materialCost) * 100 : 0;
    productionIsEstimated = false;
  } else if (input.actualProductionCost != null && input.actualProductionCost > 0) {
    // A real, partner-submitted production cost from a completed run wins.
    productionCost = input.actualProductionCost;
    productionPercent = materialCost > 0 ? (productionCost / materialCost) * 100 : 0;
    productionIsEstimated = false;
  } else if (adminEstimate != null && adminEstimate > 0 && materialCost > 0) {
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

  // JYT platform commission — the sum of the per-material commissions (each is
  // that line's share of the fee), which equals materialCost × fee%.
  const platformFee = round2(
    materials.reduce((sum, m) => sum + (m.commission ?? 0), 0)
  );
  const totalEstimated = materialCost + productionCost + platformFee;

  const hasAnyRealData = materials.some(
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
    platform_fee: platformFee,
    total_estimated: round2(totalEstimated),
    confidence,
    breakdown: {
      materials,
      production_percent: Math.round(productionPercent),
      platform_fee_percent: platformFeePercent,
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
    let inventoryItemIds = input.inventory_item_ids
      ? [...input.inventory_item_ids]
      : (design.inventory_items || []).map((item: any) => item.id);

    // Build quantity map: start with planned quantities, then override
    // with actual consumed quantities from committed consumption logs.
    // Actual usage from production always trumps planned estimates.
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

    // Override with actual consumption from committed logs
    try {
      const consumptionLogService = container.resolve("consumption_log") as any;
      const [committedLogs] = await consumptionLogService.listAndCountConsumptionLogs(
        { design_id: input.design_id, is_committed: true },
        { take: 500 }
      );
      if (committedLogs?.length) {
        // Sum consumed quantity per inventory item across all committed logs
        const actualQuantityMap: Record<string, number> = {};
        for (const log of committedLogs) {
          if (!log.inventory_item_id) continue;
          actualQuantityMap[log.inventory_item_id] =
            (actualQuantityMap[log.inventory_item_id] || 0) + Number(log.quantity);
        }
        // Override planned with actual where we have consumption data
        for (const [itemId, qty] of Object.entries(actualQuantityMap)) {
          if (qty > 0) {
            plannedQuantityMap[itemId] = qty;
          }
        }
        // Also add any consumed items not in the planned list
        for (const itemId of Object.keys(actualQuantityMap)) {
          if (!inventoryItemIds.includes(itemId) && actualQuantityMap[itemId] > 0) {
            inventoryItemIds.push(itemId);
          }
        }
      }
    } catch {
      // Non-fatal — consumption log module may not be available
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

// ─── Step 3b: Resolve actual production cost from the latest completed run ─────
// The partner's submitted cost on a completed (non-sample) run is the most
// authoritative production-cost signal — prefer it over any derived estimate.
// partner_cost_estimate is stored raw + paired with cost_type, so a "total"
// is divided back to a per-unit figure (the estimate works per finished unit).
const getActualProductionCostStep = createStep(
  "get-actual-production-cost-step",
  async (input: { design_id: string }, { container }) => {
    let perUnit: number | null = null;
    try {
      // Resolve by registration key (string) to avoid importing the module
      // entrypoint into this file — its pure functions are unit-tested without
      // a Medusa runtime, and the module import would pull in model.define().
      const service = container.resolve("production_runs") as any;
      const runs = await service.listProductionRuns(
        { design_id: input.design_id, status: "completed" },
        { order: { completed_at: "DESC" }, take: 50 }
      );
      for (const r of runs || []) {
        if (r.run_type === "sample") continue;
        const est = Number(r.partner_cost_estimate);
        if (!est || est <= 0) continue;
        const qty = Number(r.produced_quantity) || Number(r.quantity) || 1;
        perUnit = r.cost_type === "per_unit" ? est : qty > 0 ? est / qty : est;
        break;
      }
    } catch {
      // Non-fatal — production runs module may be unavailable or none exist.
    }
    return new StepResponse({ actualProductionCostPerUnit: perUnit });
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
    actualProductionCostPerUnit?: number | null;
    productionCostOverride?: number | null;
    platformFeePercent?: number;
    defaultMaterialCost?: number;
  }) => {
    const design = input.design;
    const platformFeePercent = input.platformFeePercent ?? 0;
    const hasOverride =
      input.productionCostOverride != null && input.productionCostOverride >= 0;

    // If a sample run has already calculated costs, use the stored breakdown —
    // it's more accurate than re-estimating. Skipped when the partner supplied
    // an explicit override (a typed value is authoritative even over samples).
    const costBreakdown = design.cost_breakdown as any;
    if (
      !hasOverride &&
      costBreakdown?.source === "sample_consumption" &&
      design.material_cost != null &&
      design.production_cost != null
    ) {
      const materialCost = Number(design.material_cost) || 0;
      const productionCost = Number(design.production_cost) || 0;
      const serviceCostTotal = Number(costBreakdown.service_cost_total) || 0;
      // Platform fee is charged on material cost (opt-in per caller).
      const platformFee = round2(materialCost * (platformFeePercent / 100));
      const baseTotal =
        Number(design.estimated_cost) || (materialCost + productionCost);
      const totalEstimated = baseTotal + platformFee;

      return new StepResponse({
        design_id: design.id,
        material_cost: round2(materialCost),
        production_cost: round2(productionCost),
        platform_fee: platformFee,
        total_estimated: round2(totalEstimated),
        confidence: "exact" as ConfidenceLevel,
        breakdown: {
          materials: costBreakdown.items || input.materials,
          production_percent: materialCost > 0
            ? Math.round((productionCost / materialCost) * 100)
            : 0,
          platform_fee_percent: platformFeePercent,
          service_costs: costBreakdown.service_costs,
          service_cost_total: serviceCostTotal > 0 ? round2(serviceCostTotal) : undefined,
          source: "sample_consumption",
        },
      } as EstimateCostOutput);
    }

    // No sample data (or a partner override) — estimate from scratch.
    const result = computeCostBreakdown({
      designId: design.id,
      adminEstimate: design.estimated_cost ? Number(design.estimated_cost) : null,
      materials: input.materials,
      hasExactMaterialCosts: input.hasExactMaterialCosts,
      similarDesigns: input.similarDesigns,
      actualProductionCost: input.actualProductionCostPerUnit ?? null,
      productionCostOverride: input.productionCostOverride ?? null,
      platformFeePercent,
      defaultMaterialCost: input.defaultMaterialCost ?? 0,
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

    const actualCostResult = getActualProductionCostStep({
      design_id: input.design_id,
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
      actualProductionCostPerUnit:
        actualCostResult.actualProductionCostPerUnit as unknown as number | null,
      productionCostOverride:
        input.production_cost_override as unknown as number | null,
      platformFeePercent: input.platform_fee_percent as unknown as number,
      defaultMaterialCost: input.default_material_cost as unknown as number,
    });

    return new WorkflowResponse(result);
  }
);

export default estimateDesignCostWorkflow;
