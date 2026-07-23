import { z } from "@medusajs/framework/zod"

/**
 * Validators for the partner LayoutComposer persistence routes (#338).
 *
 * The body shape mirrors the composer's `LayoutPreference` exactly (see
 * apps/investor-ui/.../layout-composer/types.ts): a per-widget map of
 * placement/visibility overrides under `configuration.widgets`, plus the
 * `is_default` scope flag the composer sends from `setPreference`.
 */

// Per-widget override — matches WidgetPreference { hidden?, section?, order? }.
const widgetPreferenceSchema = z
  .object({
    hidden: z.boolean().optional(),
    section: z.string().optional(),
    order: z.number().optional(),
  })
  .strict()

export const setLayoutConfigurationSchema = z
  .object({
    // false → the partner's personal override; true → the partner-wide default
    // ("save for everyone" within the partner). Defaults to personal.
    is_default: z.boolean().optional().default(false),
    configuration: z.object({
      widgets: z.record(z.string(), widgetPreferenceSchema).default({}),
    }),
  })
  .strict()

export type SetLayoutConfigurationInput = z.infer<
  typeof setLayoutConfigurationSchema
>
