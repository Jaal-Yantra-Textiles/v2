import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import type { RemoteQueryFunction } from "@medusajs/types"
import type { Link } from "@medusajs/modules-sdk"
import { GOOGLE_MERCHANT_MODULE } from "../../../modules/google_merchant"
import type GoogleMerchantService from "../../../modules/google_merchant/service"
import productGoogleMerchantLink from "../../../links/product-google-merchant-link"

const LINK_ENTRY = productGoogleMerchantLink.entryPoint

export type CommitImportMapping = {
  offer_id: string
  product_id: string
  google_name?: string
  source_data_source?: string | null
}

export type CommitImportInput = {
  account_id: string
  mappings: CommitImportMapping[]
}

export type CommitImportOutput = {
  account_id: string
  linked: number
  refreshed: number
  skipped: number
  errors: Array<{ offer_id: string; product_id: string; reason: string }>
}

export const commitImportMappingsStep = createStep(
  "commit-import-mappings-step",
  async (input: CommitImportInput, { container }) => {
    const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as Link
    const query = container.resolve(ContainerRegistrationKeys.QUERY) as Omit<RemoteQueryFunction, symbol>
    const service = container.resolve(GOOGLE_MERCHANT_MODULE) as GoogleMerchantService

    const [account] = await service.listGoogleMerchantAccounts(
      { id: input.account_id },
      { take: 1 }
    )
    const ourDataSource = (account?.api_config as any)?.data_source_name as string | undefined

    const { data: existingLinks } = await query.graph({
      entity: LINK_ENTRY,
      fields: ["product_id", "google_merchant_account_id"],
      filters: { google_merchant_account_id: input.account_id } as any,
    } as any)
    const linkedProductIds = new Set(
      ((existingLinks || []) as Array<{ product_id: string }>).map((l) => l.product_id)
    )

    let linked = 0
    let refreshed = 0
    let skipped = 0
    const errors: Array<{ offer_id: string; product_id: string; reason: string }> = []

    const uniqueMappings = new Map<string, CommitImportMapping>()
    for (const m of input.mappings || []) {
      if (!m.offer_id || !m.product_id) continue
      uniqueMappings.set(`${m.product_id}:${m.offer_id}`, m)
    }

    for (const m of uniqueMappings.values()) {
      const sourceDs = m.source_data_source ?? null
      const isSameSource = !!sourceDs && !!ourDataSource && sourceDs === ourDataSource
      const alreadyLinked = linkedProductIds.has(m.product_id)

      const definition = {
        [Modules.PRODUCT]: { product_id: m.product_id },
        [GOOGLE_MERCHANT_MODULE]: { google_merchant_account_id: input.account_id },
      }
      const data = {
        sync_status: "synced",
        google_product_id: m.offer_id,
        google_product_name: m.google_name || null,
        last_synced_at: new Date(),
        sync_error: null,
        metadata: {
          imported: true,
          imported_at: new Date().toISOString(),
          source_data_source: sourceDs,
          externally_managed: !!sourceDs && !!ourDataSource && !isSameSource,
          manual_mapping: true,
        },
      }

      try {
        if (alreadyLinked) {
          await remoteLink.dismiss([definition])
          await remoteLink.create([{ ...definition, data }])
          refreshed++
        } else {
          await remoteLink.create([{ ...definition, data }])
          linked++
        }
      } catch (err: any) {
        errors.push({
          offer_id: m.offer_id,
          product_id: m.product_id,
          reason: err?.message || "link write failed",
        })
      }
    }

    skipped = (input.mappings?.length || 0) - uniqueMappings.size

    return new StepResponse<CommitImportOutput>({
      account_id: input.account_id,
      linked,
      refreshed,
      skipped,
      errors,
    })
  }
)
