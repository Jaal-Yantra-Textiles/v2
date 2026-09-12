import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import type { MedusaContainer } from "@medusajs/framework/types"
import { uploadFilesWorkflow } from "@medusajs/medusa/core-flows"

import { FULLFILLED_ORDERS_MODULE } from "../../modules/fullfilled_orders"

/**
 * Store a carrier's proof of delivery against the shipment it belongs to.
 *
 * Delhivery's EPOD webhook pushes a document once a shipment is delivered,
 * either as a base64 blob or as a downloadable URL that EXPIRES AFTER 7 DAYS.
 * A URL is therefore not durable storage — the blob is uploaded to our own file
 * store and the resulting permanent URL is what gets recorded. When Delhivery
 * sends only a link there is nothing to upload, so the link is recorded as-is
 * and flagged `expires` so it is obvious the reference is perishable.
 *
 * An AWB can belong to an inventory shipment or to a core-order fulfillment
 * (the account-level webhook carries both), so both are tried — inventory
 * first, mirroring `/webhooks/shipping/track`.
 *
 * Idempotency: Delhivery re-pushes a POD whenever their audit team uploads a
 * corrected one, so MULTIPLE PODs for one AWB are expected and normal. Each is
 * appended to a `pod_documents` history and the newest becomes `pod`, so a
 * revision never destroys the document it replaced.
 */

export type StoreShipmentPodInput = {
  pod: {
    carrier: string
    awb: string
    pod_base64?: string
    pod_url?: string
    order_ref?: string
    raw?: any
  }
}

export type StoreShipmentPodResult = {
  matched: boolean
  target?: "inventory_shipment" | "fulfillment"
  target_id?: string
  /** The durable URL we recorded (our own, unless Delhivery sent only a link). */
  pod_url?: string
  /** True when the recorded URL is Delhivery's own, and will expire. */
  ephemeral?: boolean
}

/** One recorded proof-of-delivery document. */
export type PodRecord = {
  url: string
  carrier: string
  received_at: string
  ephemeral: boolean
  order_ref?: string
}

/**
 * Append a POD to a metadata blob without losing the ones already there.
 *
 * Pure and exported for unit testing. `pod` always points at the newest
 * document; `pod_documents` keeps the full history, because Delhivery re-pushes
 * a corrected POD for the same AWB and the superseded one is still evidence.
 */
export function appendPodToMetadata(
  metadata: Record<string, any> | null | undefined,
  record: PodRecord
): Record<string, any> {
  const base = metadata && typeof metadata === "object" ? { ...metadata } : {}
  const prior = Array.isArray(base.pod_documents) ? base.pod_documents : []

  // A retry of the very same document must not grow the history.
  const isDuplicate = prior.some(
    (p: any) => p?.url === record.url && p?.carrier === record.carrier
  )

  return {
    ...base,
    pod: record,
    pod_documents: isDuplicate ? prior : [...prior, record],
  }
}

/** Upload a base64 POD to our file store and return its durable URL. */
async function uploadPod(
  container: MedusaContainer,
  awb: string,
  base64: string
): Promise<string | undefined> {
  // Delhivery does not state the document's MIME type. Their POD is a scanned
  // delivery sheet delivered as a PDF in every sample we have; a base64 PNG
  // announces itself with a data-URI prefix, so honour that when present.
  const dataUri = /^data:([^;]+);base64,/i.exec(base64.trim())
  const mimeType = dataUri?.[1] || "application/pdf"
  const content = dataUri ? base64.trim().slice(dataUri[0].length) : base64.trim()
  const ext = mimeType.split("/")[1]?.split("+")[0] || "pdf"

  const { result } = await uploadFilesWorkflow(container as any).run({
    input: {
      files: [
        {
          filename: `pod-${awb}-${Date.now()}.${ext}`,
          mimeType,
          content,
          access: "public",
        },
      ],
    },
  })

  const uploaded = Array.isArray(result)
    ? result
    : Array.isArray((result as any)?.files)
      ? (result as any).files
      : []

  const file = uploaded[0]
  return file?.url || file?.location || file?.key
}

export async function storeShipmentPod(
  container: MedusaContainer,
  input: StoreShipmentPodInput
): Promise<StoreShipmentPodResult> {
  const logger: any = container.resolve(ContainerRegistrationKeys.LOGGER)
  const pod = input.pod

  const awb = String(pod.awb || "").trim()
  if (!awb) return { matched: false }
  if (!pod.pod_base64 && !pod.pod_url) {
    logger.info(`[EPOD Webhook] AWB ${awb}: push carried no document — ignored`)
    return { matched: false }
  }

  // Resolve the durable URL first, so we don't mutate a shipment and then fail
  // to have anything to point it at.
  let url = pod.pod_url
  let ephemeral = true
  if (pod.pod_base64) {
    try {
      const uploaded = await uploadPod(container, awb, pod.pod_base64)
      if (uploaded) {
        url = uploaded
        ephemeral = false
      }
    } catch (e: any) {
      logger.error(
        `[EPOD Webhook] AWB ${awb}: upload failed (${e?.message}) — falling back to the carrier link`
      )
    }
  }

  if (!url) {
    logger.error(`[EPOD Webhook] AWB ${awb}: no usable POD URL after upload`)
    return { matched: false }
  }

  const record: PodRecord = {
    url,
    carrier: pod.carrier || "delhivery",
    received_at: new Date().toISOString(),
    ephemeral,
    order_ref: pod.order_ref,
  }

  // 1. Inventory shipment (raw-material/partner inbound), matched on the
  //    `awb` column — same lookup the tracking webhook uses.
  const fulfilledOrders: any = container.resolve(FULLFILLED_ORDERS_MODULE)
  const shipments = await fulfilledOrders.listInventoryShipments({ awb })
  const shipment = (Array.isArray(shipments) ? shipments : [shipments]).filter(
    Boolean
  )[0]

  if (shipment) {
    await fulfilledOrders.updateInventoryShipments({
      id: shipment.id,
      metadata: appendPodToMetadata(shipment.metadata, record),
    })
    logger.info(
      `[EPOD Webhook] AWB ${awb}: POD stored on inventory shipment ${shipment.id}`
    )
    return {
      matched: true,
      target: "inventory_shipment",
      target_id: shipment.id,
      pod_url: url,
      ephemeral,
    }
  }

  // 2. Core-order fulfillment, matched on the label's tracking number (the
  //    only place a retail AWB is queryable).
  const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
  const fulfillmentModule: any = container.resolve(Modules.FULFILLMENT)

  const { data: fulfillments = [] } = await query.graph({
    entity: "fulfillment",
    fields: ["id", "metadata", "labels.tracking_number"],
    filters: { labels: { tracking_number: awb } },
  })

  const fulfillment = (fulfillments || []).find((f: any) =>
    (f?.labels || []).some((l: any) => l?.tracking_number === awb)
  )

  if (!fulfillment) {
    logger.info(
      `[EPOD Webhook] AWB ${awb} matched no inventory shipment or core fulfillment — ignored`
    )
    return { matched: false }
  }

  await fulfillmentModule.updateFulfillment(fulfillment.id, {
    metadata: appendPodToMetadata(fulfillment.metadata, record),
  })
  logger.info(
    `[EPOD Webhook] AWB ${awb}: POD stored on fulfillment ${fulfillment.id}`
  )

  return {
    matched: true,
    target: "fulfillment",
    target_id: fulfillment.id,
    pod_url: url,
    ephemeral,
  }
}

const storeShipmentPodStep = createStep(
  "store-shipment-pod",
  async (input: StoreShipmentPodInput, { container }) => {
    const result = await storeShipmentPod(container, input)
    return new StepResponse(result)
  }
)

export const storeShipmentPodWorkflow = createWorkflow(
  "store-shipment-pod",
  (input: StoreShipmentPodInput) => {
    const result = storeShipmentPodStep(input)
    return new WorkflowResponse(result)
  }
)
