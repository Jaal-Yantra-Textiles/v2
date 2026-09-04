import {
  createWorkflow,
  createStep,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { Modules, MedusaError, ContainerRegistrationKeys } from "@medusajs/framework/utils";
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
  // #780 H7 — optional compare-and-set precondition. When set, the row is
  // updated only if its current status still equals this value (single atomic
  // UPDATE ... WHERE status = expected). A 0-row result means a concurrent
  // request already moved the order on → we throw CONFLICT instead of silently
  // re-applying the transition. Closes the start route's read-Pending→write-
  // Processing TOCTOU. Omitted by every other caller → unconditional update.
  expectedCurrentStatus?: "Pending" | "Processing" | "Ready for Delivery" | "Shipped" | "Delivered" | "Cancelled" | "Partial";
  update: {
    status?: "Pending" | "Processing" | "Ready for Delivery" | "Shipped" | "Delivered" | "Cancelled" | "Partial";
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
    // #780 H7c — the partner-assignment claim. Cancelling an order releases it
    // so the order can legitimately be sent to a partner again.
    partner_assignment_id?: string | null;
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

    let order: any;
    if (input.expectedCurrentStatus !== undefined) {
      // #780 H7 — compare-and-set on the transition.
      //
      // 🔴 This is raw SQL on purpose, and it must stay that way. The original
      // version of this guard used
      //   updateInventoryOrders({ selector: { id, status: expected }, data })
      // and its comment claimed that was atomic. It is not: the service reads
      // the matching rows and then writes them, so two concurrent callers with
      // the same selector BOTH match and BOTH write. Probed directly against
      // the local DB — two racing claims returned 1 row and 1 row, where an
      // atomic CAS returns 1 and 0. A single `UPDATE ... WHERE status =
      // <expected>` is serialized by Postgres row locking, so the loser's
      // predicate re-evaluates after the winner commits and it updates nothing.
      if (input.update.status === undefined) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          "expectedCurrentStatus requires a status change — the status write is the gate."
        );
      }

      const pg = container.resolve(ContainerRegistrationKeys.PG_CONNECTION) as any;
      const gated = await pg.raw(
        `update inventory_orders
            set status = ?, updated_at = now()
          where id = ?
            and status = ?
            and deleted_at is null
         returning id`,
        [input.update.status, input.id, input.expectedCurrentStatus]
      );
      if ((gated?.rows ?? []).length === 0) {
        throw new MedusaError(
          MedusaError.Types.CONFLICT,
          `Inventory order ${input.id} is no longer in "${input.expectedCurrentStatus}" state (already updated by a concurrent request)`
        );
      }

      // The transition is now owned by this caller. Apply the remaining fields
      // through the service so serialisation and the returned shape are
      // unchanged; re-writing the same status is a no-op.
      order = await inventoryOrderService.updateInventoryOrders({
        id: input.id,
        ...input.update,
      });
    } else {
      order = await inventoryOrderService.updateInventoryOrders({
        id: input.id,
        ...input.update
      });
    }

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
