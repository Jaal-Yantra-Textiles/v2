import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import type { Link } from "@medusajs/framework/modules-sdk";
import { INTERNAL_PAYMENTS_MODULE } from "../../modules/internal_payments";
import PaymentService from "../../modules/internal_payments/service";

export type DeletePaymentStepInput = {
  id: string;
};

export const deletePaymentStep = createStep(
  "delete-payment-step",
  async (input: DeletePaymentStepInput, { container }) => {
    const service: PaymentService = container.resolve(INTERNAL_PAYMENTS_MODULE);
    const original = await service.retrievePayment(input.id);

    await service.deletePayments(input.id);

    return new StepResponse({ success: true }, original);
  },
  async (original: any, { container }) => {
    const service: PaymentService = container.resolve(INTERNAL_PAYMENTS_MODULE);
    await service.createPayments(original);
  }
);

export type DeletePaymentWorkflowInput = DeletePaymentStepInput;


/**
 * Dismiss every link this payment sits in (#1857).
 *
 * This one is a HARD delete, so the row is gone outright and every link to it points
 * at nothing at all. Prod carries one such row on the partner ledger link — a
 * partner's payment history counting an entry that cannot be opened.
 *
 * `Link.delete` is the CASCADE form — it dismisses link rows across every
 * module that links to this one, so nothing here enumerates them. Naming links
 * one at a time is what let the design workflow look solved while nineteen of
 * its twenty link tables kept leaking. `Link.restore` is the compensation.
 */
const dismissPaymentLinksStep = createStep(
  "dismissPaymentLinksStep",
  async (input: { id: string }, { container }) => {
    const link: Link = container.resolve(ContainerRegistrationKeys.LINK)
    await link.delete({ [INTERNAL_PAYMENTS_MODULE]: { internal_payments_id: input.id } })
    return new StepResponse({ id: input.id }, { id: input.id })
  },
  async (undo: { id: string } | undefined, { container }) => {
    if (!undo?.id) return
    const link: Link = container.resolve(ContainerRegistrationKeys.LINK)
    await link.restore({ [INTERNAL_PAYMENTS_MODULE]: { internal_payments_id: undo.id } }).catch(() => {})
  },
)

export const deletePaymentWorkflow = createWorkflow(
  "delete-payment",
  (input: DeletePaymentWorkflowInput) => {
    const result = deletePaymentStep(input);
    dismissPaymentLinksStep({ id: input.id });
    return new WorkflowResponse(result);
  }
);
