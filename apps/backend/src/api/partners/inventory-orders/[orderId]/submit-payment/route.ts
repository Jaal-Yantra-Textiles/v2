import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework";
import { z } from "@medusajs/framework/zod";
import { getPartnerFromAuthContext } from "../../../helpers";
import { createPaymentAndLinkWorkflow } from "../../../../../workflows/internal_payments/create-payment-and-link";

const requestBodySchema = z.object({
    amount: z.number().gt(0),
    payment_type: z.enum(["Bank", "Cash", "Digital_Wallet"]).optional(),
    payment_date: z.coerce.date().optional(),
    note: z.string().optional(),
    paid_to_id: z.string().optional(),
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
            details: validation.error.errors
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

    const { amount, payment_type, payment_date, note, paid_to_id } = validation.data;

    const { result, errors } = await createPaymentAndLinkWorkflow(req.scope).run({
        input: {
            payment: {
                amount,
                status: "Pending",
                payment_type: payment_type || "Cash",
                payment_date: payment_date || new Date(),
                metadata: note ? { note } : undefined,
                paid_to_id: paid_to_id || undefined,
            },
            inventoryOrderIds: [orderId],
        }
    });

    if (errors && errors.length > 0) {
        return res.status(500).json({
            error: "Failed to submit payment",
            details: errors
        });
    }

    return res.status(200).json({
        message: "Payment submitted successfully",
        payment: result?.payment
    });
}
