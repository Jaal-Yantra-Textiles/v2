import { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import type { RemoteQueryFunction } from "@medusajs/types"
import { FORMS_MODULE } from "../../../../../../../modules/forms"

const toPropertySchema = (field: any) => {
  const type = field?.type || "text"

  switch (type) {
    case "number":
      return {
        type: "number",
        title: field.label,
        description: field.help_text || undefined,
      }

    case "checkbox":
      return {
        type: "boolean",
        title: field.label,
        description: field.help_text || undefined,
      }

    case "email":
      return {
        type: "string",
        format: "email",
        title: field.label,
        description: field.help_text || undefined,
      }

    case "url":
      return {
        type: "string",
        format: "uri",
        title: field.label,
        description: field.help_text || undefined,
      }

    case "date":
      return {
        type: "string",
        format: "date",
        title: field.label,
        description: field.help_text || undefined,
      }

    case "phone":
      return {
        type: "string",
        title: field.label,
        description: field.help_text || undefined,
      }

    case "select":
    case "radio": {
      const choices = field?.options?.choices
      const enumValues = Array.isArray(choices)
        ? choices.map((c: any) => (typeof c === "string" ? c : c?.value)).filter(Boolean)
        : []

      return {
        type: "string",
        title: field.label,
        description: field.help_text || undefined,
        ...(enumValues.length ? { enum: enumValues } : {}),
      }
    }

    case "textarea":
    case "text":
    default:
      return {
        type: "string",
        title: field.label,
        description: field.help_text || undefined,
      }
  }
}

const toUiSchema = (field: any) => {
  const type = field?.type || "text"
  const ui: Record<string, any> = {}

  if (type === "textarea") {
    ui["ui:widget"] = "textarea"
  }

  if (type === "select") {
    ui["ui:widget"] = "select"
  }

  if (field?.placeholder) {
    ui["ui:placeholder"] = field.placeholder
  }

  return ui
}

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { domain, handle } = req.params

  const query = req.scope.resolve(FORMS_MODULE)

  const forms = await query.listForms({
      domain,
      handle,
      status: "published",
    },
    { relations: ['fields'] }
  )

  if (!forms?.length) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Form '${handle}' not found for domain '${domain}'`
    )
  }

  const form = forms[0]
  const fields = (form.fields || []) as any[]

  const ordered = [...fields].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))

  const properties: Record<string, any> = {}
  const uiSchema: Record<string, any> = {}
  const required: string[] = []

  for (const f of ordered) {
    if (!f?.name) {
      continue
    }

    properties[f.name] = toPropertySchema(f)
    uiSchema[f.name] = toUiSchema(f)

    if (f.required) {
      required.push(f.name)
    }
  }

  const schema = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    title: form.title,
    description: form.description || undefined,
    properties,
    ...(required.length ? { required } : {}),
    additionalProperties: false,
  }

  res.status(200).json({
    form: {
      id: form.id,
      handle: form.handle,
      title: form.title,
      description: form.description,
      submit_label: form.submit_label,
      success_message: form.success_message,
      settings: form.settings,
    },
    schema,
    ui_schema: uiSchema,
    meta: {
      version: 1,
      ordered_fields: ordered.map((f) => ({
        id: f.id,
        name: f.name,
        label: f.label,
        type: f.type,
        required: !!f.required,
        order: f.order ?? 0,
      })),
    },
  })
}
