import { MedusaService } from "@medusajs/framework/utils"

import TextileAnalysis from "./models/textile-analysis"

/**
 * What a vision model saw in a textile image.
 *
 * The generated CRUD is the whole surface — `createTextileAnalyses`,
 * `listTextileAnalyses`, `updateTextileAnalyses`, and so on. The mapping FROM a
 * raw extractor payload INTO this shape lives in `lib/normalise.ts` as a pure
 * function, deliberately: it is the part with rules in it, and rules that live
 * inside a service are rules that cannot be unit-tested without a container.
 */
class TextileAnalysisService extends MedusaService({ TextileAnalysis }) {}

export default TextileAnalysisService
