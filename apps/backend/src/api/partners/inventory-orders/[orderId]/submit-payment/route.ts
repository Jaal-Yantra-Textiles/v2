import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework";
import { z } from "@medusajs/framework/zod";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { getPartnerFromAuthContext, assertPartnerOwnsInventoryOrder } from "../../../helpers";
import { createPaymentAndLinkWorkflow } from "../../../../../workflows/internal_payments/create-payment-and-link";

const attachmentSchema = z.object({
    file_id: z.string().min(1),
    url: z.string().min(1),
    filename: z.string().optional().nullable(),
    mime_type: z.string().optional().nullable(),
    size: z.number().nonnegative().optional().nullable(),
    metadata: z.record(z.string(), z.any()).nullish(),
});

const requestBodySchema = z.object({
    amount: z.number().gt(0),
    payment_type: z.enum(["Bank", "Cash", "Digital_Wallet"]).optional(),
    payment_date: z.coerce.date().optional(),
    note: z.string().optional(),
    paid_to_id: z.string().optional(),
    // #496 — file attachments (receipts/invoices) persisted to the link table.
    attachments: z.array(attachmentSchema).optional(),
    // #780 H7 — idempotency. A double-submit (network retry, double-click) with
    // the same key returns the original payment instead of creating a duplicate.
    idempotency_key: z.string().min(1).max(255).optional(),
});

export async function POST(
    req: AuthenticatedMedusaRequest,
    res: MedusaResponse
) {
    const orderId = req.params.orderId;

    const validation = requestBodySchema.safeParse(req.body);
    if (!validation.success) {
        return res.status(400).json({
            error: "Invalid request body",
            details: validation.error.issues
        });
    }

    if (!req.auth_context?.actor_id) {
        return res.status(401).json({
            error: "Partner authentication required"
        });
    }

    const partner = await getPartnerFromAuthContext(req.auth_context, req.scope);
    if (!partner) {
        return res.status(401).json({
            error: "Partner authentication required"
        });
    }
    // #778 C1 — ownership guard: this order must belong to the acting partner.
    // Throws NOT_FOUND (→404) otherwise; closes the IDOR.
    await assertPartnerOwnsInventoryOrder(req.scope, orderId, partner.id);

    const { amount, payment_type, payment_date, note, paid_to_id, attachments, idempotency_key } = validation.data;

    // #780 H7 — idempotency replay. If a payment was already recorded against this
    // order with the same key, return it instead of creating a duplicate. The key
    // lives on the (write-once) payment metadata, so re-reading is safe — no
    // mutated-metadata hazard. Scoped to this order's linked payments only.
    if (idempotency_key) {
        const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
        const { data: orders } = await query.graph({
            entity: "inventory_orders",
            fields: ["id", "internal_payments.id", "internal_payments.amount", "internal_payments.status", "internal_payments.payment_type", "internal_payments.payment_date", "internal_payments.metadata"],
            filters: { id: orderId },
        });
        const existingPayments = ((orders?.[0] as any)?.internal_payments ?? []) as any[];
        const arr = Array.isArray(existingPayments) ? existingPayments : [existingPayments];
        const replay = arr.find((p: any) => p?.metadata?.idempotency_key === idempotency_key);
        if (replay) {
            return res.status(200).json({
                message: "Payment already submitted (idempotent replay)",
                payment: replay,
                attachments: [],
                idempotent_replay: true,
            });
        }
    }

    const { result, errors } = await createPaymentAndLinkWorkflow(req.scope).run({
        input: {
            payment: {
                amount,
                status: "Pending",
                payment_type: payment_type || "Cash",
                payment_date: payment_date || new Date(),
                metadata: (note || idempotency_key)
                    ? { ...(note ? { note } : {}), ...(idempotency_key ? { idempotency_key } : {}) }
                    : undefined,
                paid_to_id: paid_to_id || undefined,
            },
            inventoryOrderIds: [orderId],
            attachments: attachments && attachments.length ? attachments : undefined,
        }
    });

    if (errors && errors.length > 0) {
        // #778 H10 — surface the real error; MedusaError types map to 4xx.
        throw errors[0].error
    }

    return res.status(200).json({
        message: "Payment submitted successfully",
        payment: result?.payment,
        attachments: result?.attachments ?? []
    });
}
