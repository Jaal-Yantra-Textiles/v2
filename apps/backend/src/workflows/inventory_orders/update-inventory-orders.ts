import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
  transform,
  when,
} from "@medusajs/framework/workflows-sdk";
import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils";
import type { Link } from "@medusajs/modules-sdk";
import type { RemoteQueryFunction, UpdateInventoryLevelInput } from "@medusajs/types";
import { createInventoryLevelsWorkflow, updateInventoryLevelsWorkflow } from "@medusajs/medusa/core-flows";
import { ORDER_INVENTORY_MODULE } from "../../modules/inventory_orders";
import InventoryOrderService from "../../modules/inventory_orders/service";
import { mirrorUnifiedOrderStatusStep } from "./dual-write-unified-order";
import { resolveExistingLevelsStep } from "./partner-complete-inventory-order";
import inventoryOrdersStockLocations from "../../links/inventory-orders-stock-locations";
import {
  evaluateAdminStatusTransition,
  computeAdminDeliveryPosting,
} from "./lib/deliver-helpers";
import type { DeliveredLine } from "./lib/cancel-helpers";
import {
  buildMaterialLookupByInventoryId,
  type MaterialInfo,
} from "../../modules/inventory_orders/lib/create-helpers";


// Types
export type UpdateInventoryOrderLineInput = {
  id?: string; // If present, update; if not, create
  inventory_item_id: string;
  quantity: number;
  price: number;
  remove?: boolean; // If true, remove this orderline
};

export type UpdateInventoryOrderInput = {
  id: string;
  data: Partial<{
    status: string;
    expected_delivery_date: Date;
    order_date: Date;
    total_price: number;
    quantity: number;
    shipping_address: any;
    // ...other updatable fields
  }>;
  order_lines: UpdateInventoryOrderLineInput[];
};

// Step 1: Fetch original order, enforce the status transition, and decide whether
// this update must post stock (#778 M1/C2 — admin marking Delivered).
export const fetchOriginalOrderStep = createStep(
  "fetch-original-inventory-order-step",
  async (input: { id: string; data?: { status?: string } }, { container }) => {
    const inventoryOrderService: InventoryOrderService = container.resolve(ORDER_INVENTORY_MODULE);
    const originalOrder = await inventoryOrderService.retrieveInventoryOrder(input.id, { relations: ["orderlines"] });
    // #778 — validate the requested transition (throws INVALID_DATA on an illegal
    // jump, e.g. Processing→Delivered used to silently bypass stock) and learn
    // whether stock must be posted.
    const { postStock } = evaluateAdminStatusTransition(
      (originalOrder as any).status,
      input.data?.status
    );
    return new StepResponse({ originalOrder, postStock }, originalOrder); // Save original for compensation
  },
  // Compensation: no-op (fetch only)
  async () => {}
);

// Step 2: Update inventory order fields
export const updateInventoryOrderStep = createStep(
  "update-inventory-order-fields-step",
  async (input: { id: string; data: any }, { container }) => {
    const inventoryOrderService: InventoryOrderService = container.resolve(ORDER_INVENTORY_MODULE);
    const updatedOrder = await inventoryOrderService.updateInventoryOrders({
      selector: {
        id: input.id
      },
      data: {
        ...input.data
      }
    });
    return new StepResponse(updatedOrder, null);
  },
  // Compensation: restore original order fields
  async (originalOrder: any, { container }) => {
    const inventoryOrderService: InventoryOrderService = container.resolve(ORDER_INVENTORY_MODULE);
    await inventoryOrderService.updateInventoryOrders({
      selector: {
        id: originalOrder.id
      },
      data: originalOrder
    });
  }
);

// Step 3: Update orderlines (add, update, remove, relink)
export const updateOrderLinesStep = createStep(
  "update-inventory-orderlines-step",
  async (input: { order_id: string; order_lines: UpdateInventoryOrderLineInput[] }, { container }) => {
    const inventoryOrderService: InventoryOrderService = container.resolve(ORDER_INVENTORY_MODULE);
    const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as Link;
    // Fetch current orderlines so we can capture the exact prior state of every
    // line we touch — the compensation inverts each operation precisely instead
    // of nuking + recreating all lines (#778 M — the old compensation soft-deleted
    // every line and recreated them with NEW ids, breaking external references).
    const currentOrder = await inventoryOrderService.retrieveInventoryOrder(input.order_id, { relations: ["orderlines"] });
    const currentOrderlines = currentOrder.orderlines || [];
    const byId = new Map<string, any>(currentOrderlines.map((l: any) => [l.id, l]));

    // #817 S2 — resolve color identity for newly-added lines so they're
    // self-describing just like create-path lines. Existing lines keep their
    // item (no relink here), so only new lines need enrichment. Best-effort:
    // a lookup failure leaves the fields null rather than failing the update.
    let materialLookup: Record<string, MaterialInfo> = {};
    try {
      const newItemIds = Array.from(new Set(
        input.order_lines
          .filter((l) => !l.remove && !l.id && l.inventory_item_id)
          .map((l) => l.inventory_item_id)
      ));
      if (newItemIds.length) {
        const query = container.resolve(ContainerRegistrationKeys.QUERY);
        const { data: inventoryItems } = await query.graph({
          entity: "inventory_item",
          fields: ["id", "raw_materials.id", "raw_materials.color", "raw_materials.name"],
          filters: { id: newItemIds },
        });
        materialLookup = buildMaterialLookupByInventoryId(inventoryItems as any);
      }
    } catch (err) {
      console.warn(
        `[update-inventory-order] color-identity denormalization skipped: ${(err as any)?.message || err}`
      );
    }

    const created: Array<{ id: string; inventory_item_id?: string }> = [];
    const updated: Array<{ id: string; prevQuantity: number; prevPrice: any }> = [];
    const removed: Array<{ id: string; inventory_item_id?: string; quantity: number; price: any }> = [];

    // Remove orderlines marked for removal
    for (const line of input.order_lines.filter(l => l.remove && l.id)) {
      const prev = byId.get(line.id!);
      // Soft delete orderline
      await inventoryOrderService.softDeleteOrderLines(line.id!);
      // Dismiss link between orderline and inventory_item
      if (line.inventory_item_id) {
        await remoteLink.dismiss({
          [ORDER_INVENTORY_MODULE]: {
            inventory_order_line_id: line.id!
          },
          [Modules.INVENTORY]: {
            inventory_item_id: line.inventory_item_id
          }
        });
      }
      removed.push({
        id: line.id!,
        inventory_item_id: line.inventory_item_id,
        quantity: prev?.quantity,
        price: prev?.price,
      });
    }
    // Update or create orderlines and manage links
    for (const line of input.order_lines.filter(l => !l.remove)) {
      if (line.id) {
        const prev = byId.get(line.id);
        // Capture prior values before overwriting so compensation restores them in place.
        updated.push({ id: line.id, prevQuantity: prev?.quantity, prevPrice: prev?.price });
        // Update orderline fields
        await inventoryOrderService.updateOrderLines({
          selector: { id: line.id },
          data: {
            quantity: line.quantity,
            price: line.price,
          }
        });
        // If inventory_item_id changed, handle link update (not implemented here, but can be compared with currentOrderlines)
      } else {
        // Create orderline (with denormalized color identity when resolvable).
        const info = materialLookup[line.inventory_item_id];
        const created_line = await inventoryOrderService.createOrderLines({
          inventory_orders_id: input.order_id,
          quantity: line.quantity,
          price: line.price,
          color: info?.color ?? null,
          material_name: info?.material_name ?? null,
          raw_material_id: info?.raw_material_id ?? null,
        });
        // Create link to inventory item
        if (line.inventory_item_id) {
          await remoteLink.create({
            [ORDER_INVENTORY_MODULE]: {
              inventory_order_line_id: created_line.id
            },
            [Modules.INVENTORY]: {
              inventory_item_id: line.inventory_item_id
            },
            data: {
              order_line_id: created_line.id,
              inventory_item_id: line.inventory_item_id
            }
          });
        }
        created.push({ id: created_line.id, inventory_item_id: line.inventory_item_id });
      }
    }
    // Return new state and save the precise per-line ops for compensation
    const updatedOrder = await inventoryOrderService.retrieveInventoryOrder(input.order_id, { relations: ["orderlines"] });
    return new StepResponse(updatedOrder, { created, updated, removed, order_id: input.order_id });
  },
  // Compensation: invert each forward operation precisely (#778 M).
  //   - lines we CREATED → soft-delete them + dismiss their links (only the new ids)
  //   - lines we UPDATED → restore prior quantity/price IN PLACE (stable ids)
  //   - lines we REMOVED → restore them by id + recreate their links (stable ids)
  async (
    compensationData: {
      created: Array<{ id: string; inventory_item_id?: string }>;
      updated: Array<{ id: string; prevQuantity: number; prevPrice: any }>;
      removed: Array<{ id: string; inventory_item_id?: string; quantity: number; price: any }>;
      order_id: string;
    },
    { container }
  ) => {
    const inventoryOrderService: InventoryOrderService = container.resolve(ORDER_INVENTORY_MODULE);
    const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as Link;

    // Undo created lines
    for (const c of compensationData.created || []) {
      await inventoryOrderService.softDeleteOrderLines(c.id);
      if (c.inventory_item_id) {
        await remoteLink.dismiss({
          [ORDER_INVENTORY_MODULE]: { inventory_order_line_id: c.id },
          [Modules.INVENTORY]: { inventory_item_id: c.inventory_item_id },
        });
      }
    }
    // Restore updated lines to their prior values (same ids)
    for (const u of compensationData.updated || []) {
      await inventoryOrderService.updateOrderLines({
        selector: { id: u.id },
        data: { quantity: u.prevQuantity, price: u.prevPrice },
      });
    }
    // Restore removed lines (same ids) + recreate their links
    for (const r of compensationData.removed || []) {
      await inventoryOrderService.restoreOrderLines(r.id);
      if (r.inventory_item_id) {
        await remoteLink.create({
          [ORDER_INVENTORY_MODULE]: { inventory_order_line_id: r.id },
          [Modules.INVENTORY]: { inventory_item_id: r.inventory_item_id },
          data: { order_line_id: r.id, inventory_item_id: r.inventory_item_id },
        });
      }
    }
  }
);

// Step 4: Load the delivery context (orderlines + their inventory items/locations +
// the order's destination + prior deliveries) needed to post stock when an admin
// marks an order Delivered (#778 C2 admin-half). Reused on every update; the
// computed levels are empty for non-delivery edits so nothing is posted.
export const loadDeliveryContextStep = createStep(
  "load-inventory-order-delivery-context-step",
  async (input: { id: string }, { container }) => {
    const query = container.resolve(ContainerRegistrationKeys.QUERY) as Omit<RemoteQueryFunction, symbol>;
    const { data } = await query.graph({
      entity: "inventory_orders",
      filters: { id: input.id },
      fields: [
        "id",
        "status",
        "metadata",
        "orderlines.id",
        "orderlines.quantity",
        "orderlines.inventory_items.id",
        "orderlines.inventory_items.stock_locations.id",
      ],
    });
    const order = (data?.[0] as any) || {};

    // Resolve the DESTINATION (to_location) explicitly via the order↔stock-location
    // link's `to_location` flag — the order links BOTH a from- and a to-location to
    // the same relation, so a positional `[0]` could resolve to the wrong warehouse.
    let destLocationId: string | null = null;
    try {
      const { data: locLinks } = await query.graph({
        entity: inventoryOrdersStockLocations.entryPoint,
        filters: { inventory_orders_id: input.id },
        fields: ["stock_location_id", "to_location", "from_location"],
      });
      const links = (locLinks || []) as any[];
      const toLink = links.find((l) => l?.to_location);
      destLocationId =
        toLink?.stock_location_id ||
        links.find((l) => !l?.from_location)?.stock_location_id ||
        null;
    } catch {
      /* fall back to the item's own linked location in the helper */
    }
    const alreadyDelivered = (order.metadata?.partner_delivered_lines || []) as DeliveredLine[];
    return new StepResponse({
      orderlines: order.orderlines || [],
      alreadyDelivered,
      destLocationId,
    });
  }
);

// Step 5: Append the admin-delivered line records to metadata.partner_delivered_lines
// so a later cancel reverses the full posted stock (#778 C2/C4). Reads-then-merges
// to avoid clobbering the rest of the metadata blob.
export const appendDeliveredLinesStep = createStep(
  "append-admin-delivered-lines-step",
  async (input: { id: string; records: DeliveredLine[] }, { container }) => {
    const inventoryOrderService: InventoryOrderService = container.resolve(ORDER_INVENTORY_MODULE);
    const order = await inventoryOrderService.retrieveInventoryOrder(input.id, { select: ["id", "metadata"] });
    const meta = ((order as any)?.metadata || {}) as Record<string, any>;
    const prev = Array.isArray(meta.partner_delivered_lines) ? meta.partner_delivered_lines : [];
    await inventoryOrderService.updateInventoryOrders({
      id: input.id,
      metadata: { ...meta, partner_delivered_lines: [...prev, ...input.records] },
    });
    return new StepResponse({ appended: input.records.length }, { id: input.id, metadata: meta });
  },
  // Compensation: restore the prior metadata blob.
  async (comp: { id: string; metadata: Record<string, any> } | undefined, { container }) => {
    if (!comp) return;
    const inventoryOrderService: InventoryOrderService = container.resolve(ORDER_INVENTORY_MODULE);
    await inventoryOrderService.updateInventoryOrders({ id: comp.id, metadata: comp.metadata });
  }
);

export const updateInventoryOrderWorkflow = createWorkflow(
  {
    name: "update-inventory-order-workflow",
    store: true
  },
  (input: UpdateInventoryOrderInput) => {
    const original = fetchOriginalOrderStep({ id: input.id, data: input.data });
    const updatedOrder = updateInventoryOrderStep({ id: input.id, data: input.data });
    const updatedOrderlines = updateOrderLinesStep({ order_id: input.id, order_lines: input.order_lines });

    // #778 C2 admin-half — when this update delivers the order, post the remaining
    // stock per line (ordered − already delivered) to the destination location,
    // mirroring the partner-complete posting. Sequenced after the field/line
    // updates so the metadata merge sees the latest order state.
    const postStock = transform({ original }, ({ original }) => Boolean((original as any)?.postStock));
    // Depend on both prior updates so the delivery context + metadata merge see the
    // latest order state (and never clobber a metadata write from the field update).
    const readyId = transform({ updatedOrder, updatedOrderlines, input }, ({ input }) => input.id);
    const deliveryCtx = loadDeliveryContextStep({ id: readyId as unknown as string });

    const computed = transform(
      { deliveryCtx, postStock },
      ({ deliveryCtx, postStock }) =>
        postStock
          ? computeAdminDeliveryPosting(
              (deliveryCtx as any).orderlines,
              (deliveryCtx as any).alreadyDelivered,
              (deliveryCtx as any).destLocationId
            )
          : { levels: [], deliveredRecords: [] }
    );
    const levels = transform({ computed }, ({ computed }) => (computed as any).levels);
    const deliveredRecords = transform({ computed }, ({ computed }) => (computed as any).deliveredRecords);

    const resolved = resolveExistingLevelsStep({ levels: levels as any }) as any;
    const existing = transform({ resolved }, ({ resolved }) => (resolved?.existing || []));

    // (item, location) pairs with no existing level need creating first.
    const missing = transform<{ existing: any[]; levels: any[] }, any[]>(
      { existing, levels },
      ({ existing, levels }) => {
        const exArr = (existing as any[]) || [];
        const lvlArr = (levels as any[]) || [];
        return lvlArr.filter((l: any) =>
          !exArr.some((ex: any) => ex.inventory_item_id === l.inventory_item_id && ex.location_id === l.location_id)
        );
      }
    );
    const createInputs = transform({ missing }, ({ missing }) =>
      ((missing as any[]) || []).map((m: any) => ({
        inventory_item_id: String(m.inventory_item_id),
        location_id: String(m.location_id),
        stocked_quantity: Number(m.stocked_quantity || 0),
        incoming_quantity: 0,
      }))
    );
    const hasCreates = transform({ createInputs }, ({ createInputs }) => Array.isArray(createInputs) && (createInputs as any[]).length > 0);
    when(hasCreates, (b) => Boolean(b)).then(() => {
      createInventoryLevelsWorkflow.runAsStep({
        input: { inventory_levels: createInputs as unknown as any[] },
      });
    });

    const updates = transform<{ existing: any[]; levels: any[] }, UpdateInventoryLevelInput[]>(
      { existing, levels },
      ({ existing, levels }) => {
        const lvlArr = (levels as any[]) || [];
        const exArr = (existing as any[]) || [];
        return exArr.map((ex: any) => {
          const found = lvlArr.find(
            (l: any) => l.inventory_item_id === ex.inventory_item_id && l.location_id === ex.location_id
          );
          const add = Number(found?.stocked_quantity || 0);
          return {
            id: String(ex.id),
            inventory_item_id: String(ex.inventory_item_id),
            location_id: String(ex.location_id),
            stocked_quantity: Number(ex.stocked_quantity || 0) + add,
          };
        });
      }
    );
    const hasUpdates = transform({ updates }, ({ updates }) => Array.isArray(updates) && (updates as any[]).length > 0);
    when(hasUpdates, (b) => Boolean(b)).then(() => {
      updateInventoryLevelsWorkflow.runAsStep({ input: { updates: updates as unknown as UpdateInventoryLevelInput[] } });
    });

    const shouldRecord = transform({ deliveredRecords }, ({ deliveredRecords }) => Array.isArray(deliveredRecords) && (deliveredRecords as any[]).length > 0);
    when(shouldRecord, (b) => Boolean(b)).then(() => {
      appendDeliveredLinesStep({ id: input.id, records: deliveredRecords as unknown as DeliveredLine[] });
    });

    // #342 — best-effort §5 status mirror onto the unified core order
    mirrorUnifiedOrderStatusStep({ inventoryOrderId: input.id });
    return new WorkflowResponse({ order: updatedOrder, orderlines: updatedOrderlines });
  },
);

export default updateInventoryOrderWorkflow;
