import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { classifyProductTaxClassWorkflow } from "../workflows/tax/classify-product-tax-class"

/**
 * Subscriber: product.{created,updated} → classify-product-tax-class
 *
 * Keeps the JYT-managed tax-class product_type assignment in sync
 * with the product's current max INR variant price. See
 * `apps/docs/notes/TAX_NOTES.md` + the workflow file for context.
 *
 * Why both events: `product.created` covers the initial classify;
 * `product.updated` covers admin edits to title/variants. Price
 * changes flow through `product.updated` in Medusa 2.x because
 * variant/price mutations bubble a product event.
 *
 * The workflow is idempotent + safe to run on any product (it skips
 * products with partner-assigned types), so we don't need to
 * pre-filter event payloads here.
 */
export default async function classifyProductTaxClassHandler({
  event,
  container,
}: SubscriberArgs<{ id: string }>) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const productId = event.data?.id
  if (!productId) return

  try {
    const { result } = await classifyProductTaxClassWorkflow(container).run({
      input: { product_id: productId },
    })
    if (result.decision === "assigned" || result.decision === "cleared") {
      logger.info(
        `[classify-product-tax-class] ${event.name} product=${productId} → ${result.decision} (${result.reason})`
      )
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : JSON.stringify(err)
    logger.error(
      `[classify-product-tax-class] ${event.name} product=${productId} threw: ${message}`
    )
  }
}

export const config: SubscriberConfig = {
  event: ["product.created", "product.updated"],
}
