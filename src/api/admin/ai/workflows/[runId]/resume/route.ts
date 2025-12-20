import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { mastra, mastraStorageInit } from "../../../../../../mastra"
import { runStorage } from "../../../../../../mastra/run-storage"
import { generalChatAgent } from "../../../../../../mastra/agents"

/**
 * POST /admin/ai/workflows/:runId/resume
 * 
 * Resume a suspended HITL workflow with user input
 * 
 * Note: Mastra doesn't have getRun() method. We need to either:
 * 1. Store run instances in memory/database
 * 2. Use Mastra's built-in run management
 * 
 * For now, using in-memory storage (production should use Redis/DB)
 */

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
    const { runId } = req.params
    const { step, resumeData } = req.body as { step?: string; resumeData?: any }

    try {
        const storageReady = await mastraStorageInit
        if (!storageReady) {
            return res.status(500).json({
                message: "Mastra storage is not initialized. Snapshots are required for suspend/resume. Set a valid DATABASE_URL/MASTRA_DATABASE_URL.",
            })
        }

        // Retrieve run from storage
        let run = runStorage.get(runId)
        if (!run) {
            const workflow = mastra.getWorkflow("multiStepApiRequestWorkflow")
            run = await workflow.createRunAsync({ runId })
        }

        // Resume the workflow
        const result = await run.resume({
            step: step || "confirm-selection",
            resumeData: {
                ...(resumeData || {}),
                context: {
                    ...((resumeData as any)?.context || {}),
                    auth_headers: {
                        authorization: req.headers.authorization,
                        cookie: req.headers.cookie,
                    },
                },
            },
        })

        // Check if workflow suspended again
        if (result.status === "suspended") {
            const suspendedFirst = (result as any).suspended?.[0]
            const stepId = typeof suspendedFirst === "string" ? suspendedFirst : suspendedFirst?.stepId
            const suspendPayload = stepId ? (result as any).steps?.[stepId]?.suspendPayload : null

            return res.json({
                status: "suspended",
                runId,
                suspendPayload,
                message: "Workflow paused again for user input",
            })
        }

        // Workflow completed - clean up storage
        runStorage.delete(runId)

        const workflowOutput = (result as any)?.result
        const finalData = (workflowOutput as any)?.result ?? workflowOutput

        let reply: string | undefined
        let tip: string | undefined
        try {
            const orders = Array.isArray((finalData as any)?.orders) ? (finalData as any).orders : undefined
            if (orders) {
                try {
                    const total = orders.length
                    const byStatus = new Map<string, number>()
                    const byFulfillment = new Map<string, number>()
                    const byPayment = new Map<string, number>()

                    for (const o of orders) {
                        const s = String(o?.status || "unknown")
                        const f = String(o?.fulfillment_status || "unknown")
                        const p = String(o?.payment_status || "unknown")
                        byStatus.set(s, (byStatus.get(s) || 0) + 1)
                        byFulfillment.set(f, (byFulfillment.get(f) || 0) + 1)
                        byPayment.set(p, (byPayment.get(p) || 0) + 1)
                    }

                    const top = (m: Map<string, number>) => {
                        const entries = Array.from(m.entries()).sort((a, b) => b[1] - a[1])
                        return entries.slice(0, 2).map(([k, v]) => `${v} ${k}`)
                    }

                    tip = [
                        `${total} orders`,
                        ...top(byStatus),
                        ...top(byFulfillment),
                        ...top(byPayment),
                    ].filter(Boolean).join(" • ")
                } catch {
                    tip = undefined
                }

                const compact = orders.slice(0, 25).map((o: any) => {
                    const items = Array.isArray(o?.items) ? o.items.slice(0, 30).map((it: any) => ({
                        title: it?.title || it?.product_title || it?.variant_title || it?.product?.title,
                        quantity: it?.quantity,
                        unit_price: it?.unit_price,
                    })) : []

                    return {
                        id: o?.id,
                        display_id: o?.display_id,
                        status: o?.status,
                        fulfillment_status: o?.fulfillment_status,
                        payment_status: o?.payment_status,
                        created_at: o?.created_at,
                        currency_code: o?.currency_code,
                        total: o?.total,
                        items,
                    }
                })

                const prompt =
                    "Summarize these ecommerce orders for an admin user. " +
                    "Write a long-form but readable summary. Include: total number of orders, " +
                    "each order's display_id (or id), current status/payment/fulfillment status, " +
                    "and a short list of items (title + quantity). " +
                    "If values are missing, skip them. Output plain text, no JSON. " +
                    "End with a section 'Next actions:' containing 3 bullet suggestions for what the admin can do next.\n\n" +
                    JSON.stringify({ count: (finalData as any)?.count, orders: compact }, null, 2)

                const gen = await (generalChatAgent as any).generate(prompt)
                reply = typeof gen?.text === "string" ? gen.text : (typeof gen === "string" ? gen : undefined)
            }
        } catch {
            reply = undefined
        }

        return res.json({
            status: "completed",
            reply,
            tip,
            result: finalData,
            meta: (workflowOutput as any)?.meta,
            error: (workflowOutput as any)?.error,
        })
    } catch (error: any) {
        console.error("[HITL Resume] Error:", error)
        return res.status(500).json({
            message: error?.message || "Workflow resume failed",
        })
    }
}
