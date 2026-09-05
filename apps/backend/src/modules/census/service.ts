import { MedusaService } from "@medusajs/framework/utils"

import { censusReader, type WeaverFilters, type ListOptions } from "./reader"
import CensusUnmaskAudit from "./models/census-unmask-audit"

/**
 * Census module service — a read-only query surface over the P2P public core
 * (no Postgres data model for weavers themselves) PLUS one Postgres table,
 * `census_unmask_audit`, that records admin reveals of a weaver's full PII.
 * It delegates weaver reads to the module-singleton CensusReader that the loader
 * wires to the live Hyperbee. Routes resolve this from the container as `census`.
 */
class CensusModuleService extends MedusaService({
  CensusUnmaskAudit,
}) {
  get connected(): boolean {
    return censusReader.ready
  }

  retrieveWeaver(id: string | number) {
    return censusReader.retrieveWeaver(id)
  }

  listAndCountWeavers(filters: WeaverFilters = {}, options: ListOptions = {}) {
    return censusReader.listAndCountWeavers(filters, options)
  }

  getStats(options: { minCell?: number } = {}) {
    return censusReader.getStats(options)
  }

  /**
   * Resolve a weaver's FULL (unredacted) PII from the encrypted sensitive core
   * via the reader node. Proxy-mode only; fails closed without a proxy + token.
   */
  unmaskWeaver(id: string | number) {
    return censusReader.unmaskWeaver(id)
  }
}

export default CensusModuleService