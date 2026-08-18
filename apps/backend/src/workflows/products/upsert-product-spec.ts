import {
  createWorkflow,
  createStep,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import {
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
} from "@medusajs/framework/utils"
import { PRODUCT_SPEC_MODULE } from "../../modules/product-spec"
import { validateWeaveParams } from "../../modules/product-spec/weaving-techniques"
import { normalizeHex, normalizeKey } from "../../modules/product-spec/normalize"

export type ProductSpecColorInput = {
  name: string
  hex_code?: string | null
  usage_notes?: string | null
  order?: number
  available?: boolean
}

export type ProductSpecFieldInput = {
  key: string
  label?: string | null
  value?: string | null
  order?: number
}

export type ProductSpecInput = {
  weave_technique?: string | null
  weave_label?: string | null
  params?: Record<string, number> | null
  finishes?: string[] | null
  notes?: string | null
  accepting_custom_orders?: boolean
  custom_order_lead_time_days?: number | null
  /** Full replacement of the palette when present; omit to leave it alone. */
  colors?: ProductSpecColorInput[]
  /** Full replacement of the custom fields when present; omit to leave alone. */
  fields?: ProductSpecFieldInput[]
}

export type UpsertProductSpecInput = {
  product_id: string
  data: ProductSpecInput
}

type UpsertCompensation = {
  created: boolean
  id: string
  product_id?: string
  prev?: Record<string, unknown>
  prevColors?: any[]
  prevFields?: any[]
  replacedColors: boolean
  replacedFields: boolean
}

/**
 * Upsert a product's spec, its palette and its custom fields, and ensure the
 * product ↔ spec link exists (#1342).
 *
 * Validation lives here rather than in the route because it is a business rule,
 * not a request-shape rule: whether 900 GSM is a typo depends on the technique
 * that was chosen, which only this layer knows.
 *
 * Palette and fields are REPLACED wholesale when supplied. Diffing them by id
 * would be kinder to concurrent editors, but a partner spec has exactly one
 * editor, and a replace cannot leave a colour the partner deleted alive because
 * its row failed to match.
 */
const upsertProductSpecStep = createStep(
  "upsert-product-spec",
  async (input: UpsertProductSpecInput, { container }) => {
    const service: any = container.resolve(PRODUCT_SPEC_MODULE)
    const link: any = container.resolve(ContainerRegistrationKeys.LINK)

    const { colors, fields, ...specData } = input.data

    // Parameters are only meaningful against a technique. Validating here means
    // a spec can never be stored claiming 8000 GSM because a UI let it through.
    if (specData.params && Object.keys(specData.params).length) {
      const technique = specData.weave_technique
      if (!technique) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          "Weave parameters were given without a weave technique — pick a technique first."
        )
      }
      const problems = validateWeaveParams(technique, specData.params)
      if (problems.length) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          `Weave parameters are out of range: ${problems.join("; ")}`
        )
      }
    }

    const existing = await service.findByProduct(input.product_id)

    let spec: any
    let compensation: UpsertCompensation

    if (existing) {
      spec = await service.updateProductSpecs({ id: existing.id, ...specData })
      compensation = {
        created: false,
        id: existing.id,
        prev: {
          weave_technique: existing.weave_technique,
          weave_label: existing.weave_label,
          params: existing.params,
          finishes: existing.finishes,
          notes: existing.notes,
          accepting_custom_orders: existing.accepting_custom_orders,
          custom_order_lead_time_days: existing.custom_order_lead_time_days,
        },
        prevColors: existing.colors ?? [],
        prevFields: existing.fields ?? [],
        replacedColors: !!colors,
        replacedFields: !!fields,
      }
    } else {
      spec = await service.createProductSpecs({
        product_id: input.product_id,
        ...specData,
      })
      compensation = {
        created: true,
        id: spec.id,
        product_id: input.product_id,
        replacedColors: !!colors,
        replacedFields: !!fields,
      }
    }

    if (colors) {
      const stale = (existing?.colors ?? []).map((c: any) => c.id)
      if (stale.length) await service.deleteProductSpecColors(stale)
      if (colors.length) {
        await service.createProductSpecColors(
          colors.map((c, i) => ({
            name: c.name.trim(),
            hex_code: normalizeHex(c.hex_code),
            usage_notes: c.usage_notes ?? null,
            order: c.order ?? i,
            available: c.available ?? true,
            spec_id: spec.id,
          }))
        )
      }
    }

    if (fields) {
      const stale = (existing?.fields ?? []).map((f: any) => f.id)
      if (stale.length) await service.deleteProductSpecFields(stale)
      if (fields.length) {
        await service.createProductSpecFields(
          fields.map((f, i) => ({
            key: normalizeKey(f.key),
            label: f.label ?? f.key.trim(),
            value: f.value ?? null,
            order: f.order ?? i,
            spec_id: spec.id,
          }))
        )
      }
    }

    // Ensure the link on BOTH paths (idempotent). Creating it only on first
    // write is what left artisan-detail rows readable by their own module but
    // invisible to query.graph, so the storefront silently dropped them (#859).
    await link.create({
      [Modules.PRODUCT]: { product_id: input.product_id },
      [PRODUCT_SPEC_MODULE]: { product_spec_id: spec.id },
    })

    const saved = await service.findByProduct(input.product_id)
    return new StepResponse(saved, compensation)
  },
  async (compensation: UpsertCompensation | undefined, { container }) => {
    if (!compensation) return
    const service: any = container.resolve(PRODUCT_SPEC_MODULE)
    const link: any = container.resolve(ContainerRegistrationKeys.LINK)

    if (compensation.created) {
      await link
        .dismiss({
          [Modules.PRODUCT]: { product_id: compensation.product_id },
          [PRODUCT_SPEC_MODULE]: { product_spec_id: compensation.id },
        })
        .catch(() => {})
      // Children go with the parent — deleting the spec alone would leave
      // orphan colour/field rows pointing at an id that no longer exists.
      const spec = await service
        .retrieveProductSpec(compensation.id, { relations: ["colors", "fields"] })
        .catch(() => null)
      const colorIds = (spec?.colors ?? []).map((c: any) => c.id)
      const fieldIds = (spec?.fields ?? []).map((f: any) => f.id)
      if (colorIds.length) await service.deleteProductSpecColors(colorIds)
      if (fieldIds.length) await service.deleteProductSpecFields(fieldIds)
      await service.deleteProductSpecs(compensation.id)
      return
    }

    await service.updateProductSpecs({
      id: compensation.id,
      ...(compensation.prev ?? {}),
    })

    // Restore the palette / fields only if this run replaced them.
    if (compensation.replacedColors) {
      const current = await service.listProductSpecColors({
        spec_id: compensation.id,
      })
      const ids = (current ?? []).map((c: any) => c.id)
      if (ids.length) await service.deleteProductSpecColors(ids)
      if (compensation.prevColors?.length) {
        await service.createProductSpecColors(
          compensation.prevColors.map((c: any) => ({
            name: c.name,
            hex_code: c.hex_code,
            usage_notes: c.usage_notes,
            order: c.order,
            available: c.available,
            spec_id: compensation.id,
          }))
        )
      }
    }

    if (compensation.replacedFields) {
      const current = await service.listProductSpecFields({
        spec_id: compensation.id,
      })
      const ids = (current ?? []).map((f: any) => f.id)
      if (ids.length) await service.deleteProductSpecFields(ids)
      if (compensation.prevFields?.length) {
        await service.createProductSpecFields(
          compensation.prevFields.map((f: any) => ({
            key: f.key,
            label: f.label,
            value: f.value,
            order: f.order,
            spec_id: compensation.id,
          }))
        )
      }
    }
  }
)

export const upsertProductSpecWorkflow = createWorkflow(
  "upsert-product-spec",
  (input: UpsertProductSpecInput) => {
    const spec = upsertProductSpecStep(input)
    return new WorkflowResponse(spec)
  }
)
