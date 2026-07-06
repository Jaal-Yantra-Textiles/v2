import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import {
  OutlineBodySchema,
  buildPotraceParams,
  svgToDataUrl,
  parseSvgDimensions,
  MOCK_OUTLINE_SVG,
} from "./outline-support"
import { resolveImageBuffer, runPotrace, OutlineEngineError } from "./outline-engine"

/**
 * POST /admin/designs/:id/outline
 *
 * Vectorize a raster flat/cutout into an editable SVG outline (#892) via potrace.
 * This is the deterministic, sewable-spec companion to the exploratory /redesign
 * render: pair it with /segment (feed the mask_url + black_on_white:false) for a
 * clean silhouette regardless of garment color. Returns SVG markup + a data URL;
 * it does not mutate the design.
 *
 * Body: { image_url | image_base64, mode?, threshold?, turd_size?, opt_tolerance?,
 *         black_on_white?, steps?, color?, background? }
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const logger: any = req.scope.resolve(ContainerRegistrationKeys.LOGGER)

  const parsed = OutlineBodySchema.safeParse(req.body)
  if (!parsed.success) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
    )
  }
  const body = parsed.data
  const params = buildPotraceParams(body)

  // In integration tests, skip the raster work but exercise all wiring around it.
  if (process.env.TEST_TYPE) {
    const dims = parseSvgDimensions(MOCK_OUTLINE_SVG)
    return res.status(200).json({
      outline: {
        svg: MOCK_OUTLINE_SVG,
        image_url: svgToDataUrl(MOCK_OUTLINE_SVG),
        mode: body.mode,
        width: dims.width,
        height: dims.height,
      },
    })
  }

  logger.info(
    `[Outline] potrace ${body.mode} on design ${req.params.id} (threshold=${body.threshold}, black_on_white=${body.black_on_white})`
  )

  let svg: string
  try {
    const buffer = await resolveImageBuffer(body)
    svg = await runPotrace(buffer, body.mode, params)
  } catch (err: any) {
    const status = err instanceof OutlineEngineError ? err.status : 502
    const code = err instanceof OutlineEngineError ? err.kind : "provider"
    const message =
      err instanceof OutlineEngineError
        ? err.message
        : `Vectorization failed unexpectedly: ${String(err?.message || err).slice(0, 160)}`
    logger.error(
      `[Outline] failed [${code}] on design ${req.params.id}: ${err?.message || err}`
    )
    // Controlled response so the classified message survives (500s get scrubbed).
    return res.status(status).json({ code, message })
  }

  const dims = parseSvgDimensions(svg)
  logger.info(`[Outline] Success — design ${req.params.id} (${dims.width}×${dims.height})`)
  return res.status(200).json({
    outline: {
      svg,
      image_url: svgToDataUrl(svg),
      mode: body.mode,
      width: dims.width,
      height: dims.height,
    },
  })
}
