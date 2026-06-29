import {
  createWorkflow,
  createStep,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { Modules } from "@medusajs/framework/utils";
import type { IEventBusModuleService } from "@medusajs/types";
import InventoryOrderService from "../../modules/inventory_orders/service";
import { ORDER_INVENTORY_MODULE } from "../../modules/inventory_orders";
import { mirrorUnifiedOrderStatusStep } from "./dual-write-unified-order";

/**
 * Dedicated status-transition event (#771). The MedusaService auto-emits a
 * generic `inventory_orders.inventory-orders.updated` on every write —
 * including metadata-only ones — which is too noisy to trigger partner
 * notification visual flows on. This fires only when the status actually
 * changes, carrying previous → new so a flow can branch/guard cleanly. Every
 * status transition (admin edit, partner start, partner complete) routes
 * through `updateInventoryOrderStep`, so this is the single choke point.
 */
export const INVENTORY_ORDER_STATUS_CHANGED_EVENT =
  "inventory_orders.inventory-order.status-changed";

export type StatusChangedEvent = {
  name: typeof INVENTORY_ORDER_STATUS_CHANGED_EVENT;
  data: { id: string; previous_status: string | null; status: string };
};

/**
 * Pure decision for whether (and what) status-changed event to emit. Emits only
 * when a status change was intended AND the value actually moved. Returns null
 * otherwise (no-op). Kept pure so it's unit-testable without a container. #771
 */
export const buildStatusChangedEvent = (
  id: string,
  previousStatus: string | undefined | null,
  newStatus: string | undefined | null,
  statusIntended: boolean
): StatusChangedEvent | null => {
  if (!statusIntended || !newStatus || newStatus === previousStatus) {
    return null;
  }
  return {
    name: INVENTORY_ORDER_STATUS_CHANGED_EVENT,
    data: { id, previous_status: previousStatus ?? null, status: newStatus },
  };
};

type UpdateInventoryOrderStepInput = {
  id: string;
  update: {
    status?: "Pending" | "Processing" | "Shipped" | "Delivered" | "Cancelled" | "Partial";
    metadata?: Record<string, any>;
    quantity?: number;
    total_price?: number;
    expected_delivery_date?: Date;
    order_date?: Date;
    shipping_address?: Record<string, any>;
    is_sample?: boolean;
    // Cancellation audit columns (#778 C4) — passed straight through to the
    // service update so the cancel workflow can stamp them while reusing the
    // status-changed event + unified-order mirror.
    cancelled_at?: Date | null;
    cancellation_reason?: string | null;
    cancelled_by?: string | null;
  };
};

export const updateInventoryOrderStep = createStep(
  "update-inventory-order-step",
  async (input: UpdateInventoryOrderStepInput, { container }) => {
    const inventoryOrderService: InventoryOrderService = container.resolve(ORDER_INVENTORY_MODULE);

    // Capture the prior status only when a status change is intended, so we can
    // emit a clean status-changed event without an extra read on metadata-only
    // updates. #771
    let previousStatus: string | undefined;
    if (input.update.status !== undefined) {
      try {
        const existing = await inventoryOrderService.retrieveInventoryOrder(input.id, {
          select: ["id", "status"],
        });
        previousStatus = (existing as any)?.status;
      } catch {
        /* best-effort — fall back to emitting without a previous_status */
      }
    }

    const order = await inventoryOrderService.updateInventoryOrders({
      id: input.id,
      ...input.update
    });

    const event = buildStatusChangedEvent(
      input.id,
      previousStatus,
      (order as any)?.status,
      input.update.status !== undefined
    );
    if (event) {
      try {
        const eventBus = container.resolve(Modules.EVENT_BUS) as IEventBusModuleService;
        await eventBus.emit(event);
      } catch {
        /* best-effort — never block the update if event emit fails */
      }
    }

    return new StepResponse(order);
  }
);

type UpdateInventoryOrderWorkflowInput = UpdateInventoryOrderStepInput;

export const updateInventoryOrderWorkflow = createWorkflow(
  "update-inventory-order",
  (input: UpdateInventoryOrderWorkflowInput) => {
    const order = updateInventoryOrderStep(input);
    // #342 — best-effort §5 status mirror onto the unified core order
    mirrorUnifiedOrderStatusStep({ inventoryOrderId: input.id });
    return new WorkflowResponse(order);
  }
);
