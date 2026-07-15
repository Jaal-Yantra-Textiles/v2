import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";

import { CENSUS_MODULE } from "../../../../modules/census";
import type CensusModuleService from "../../../../modules/census/service";
import {
  extractName,
  hashAadhaar,
  nameSimilarity,
} from "./lib";
import type { VerifyWeaverInput } from "./validators";

// Name confidence at/above which the name factor is considered a match.
const NAME_MATCH_THRESHOLD = 0.6;

/**
 * POST /web/census/verify  (#1038) — public (/web/* is CORS-only, no key).
 *
 * Verify a weaver against the census PUBLIC core by census_id, optionally
 * confirming name (fuzzy) and accepting an Aadhaar (hashed for audit).
 *
 * IMPORTANT scope note: the public core is masked/PII-free and carries no
 * Aadhaar, so `aadhaar_matched` is null here — true Aadhaar+Name matching needs
 * the encrypted sensitive-core index (issue #1038). This endpoint is the working
 * first cut (census_id + name) with the Aadhaar path wired for when that lands.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const census = req.scope.resolve(CENSUS_MODULE) as CensusModuleService;

  if (!census.connected) {
    return res.status(503).json({
      message: "census reader not connected yet — try again shortly",
    });
  }

  const { census_id, name, aadhaar } = req.validatedBody as VerifyWeaverInput;

  const weaver = await census.retrieveWeaver(census_id);
  if (!weaver) {
    return res.json({
      verified: false,
      reason: "not_found",
      census_id,
      // Still record that an Aadhaar was submitted (hashed) for audit, never raw.
      ...(aadhaar ? { aadhaar_hash_prefix: hashAadhaar(aadhaar).slice(0, 12) } : {}),
    });
  }

  // ── name factor (optional) ──
  let name_confidence: number | null = null;
  let name_matched: boolean | null = null;
  if (name) {
    const recName = extractName(weaver);
    if (recName) {
      name_confidence = Number(nameSimilarity(name, recName).toFixed(3));
      name_matched = name_confidence >= NAME_MATCH_THRESHOLD;
    } else {
      name_matched = null; // record has no comparable name field
    }
  }

  // ── aadhaar factor (accepted + hashed, but not matchable on the public core) ──
  let aadhaar_matched: boolean | null = null;
  let aadhaar_hash_prefix: string | undefined;
  if (aadhaar) {
    const hash = hashAadhaar(aadhaar);
    aadhaar_hash_prefix = hash.slice(0, 12);
    const recHash = (weaver as Record<string, any>).aadhaar_hash;
    aadhaar_matched = recHash ? recHash === hash : null; // null → not on public core
  }

  // Overall verdict: found by census_id AND (no name given OR name matched).
  const verified = name_matched === false ? false : true;

  res.json({
    verified,
    census_id,
    factors: {
      census_id: true,
      name_matched,
      name_confidence,
      aadhaar_matched, // null = Aadhaar not available on the public core (#1038 tail)
    },
    ...(aadhaar_hash_prefix ? { aadhaar_hash_prefix } : {}),
    weaver, // masked, PII-free public record
  });
};
