import { censusReader, type WeaverFilters, type ListOptions } from "./reader"

/**
 * Census module service — a thin, read-only query surface over the P2P public
 * core (no Postgres, no data model). It delegates to the module-singleton
 * CensusReader that the loader wires to the live Hyperbee. Routes resolve this
 * from the container as `census` and call these methods like any module service.
 */
class CensusModuleService {
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
}

export default CensusModuleService
