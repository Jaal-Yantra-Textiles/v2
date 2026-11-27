/**
 * CJS stand-in for `@tanstack/react-table` — used in Jest tests only.
 *
 * Why this exists:
 *   Medusa 2.23 brings @tanstack/react-table v9, which ships ONLY as ESM
 *   ("type": "module"). @medusajs/ui 4.x's CJS build does
 *   `require("@tanstack/react-table")` at import time, so any admin component
 *   spec that imports @medusajs/ui fails to LOAD with "Must use import to load
 *   ES Module" — Jest 29's ESM check throws before any transform runs (same
 *   trap as tokenx, see tokenx.cjs).
 *
 *   No unit spec renders a table: the admin specs render sections to static
 *   markup and only pull react-table in transitively. So this is an inert
 *   stub, not a port. @medusajs/ui calls some exports (e.g. `tableFeatures`)
 *   at MODULE LOAD, so nothing may throw; every export is a callable that
 *   returns another inert callable. A spec that genuinely renders a DataTable
 *   will get no rows: give it a real port of react-table first.
 *
 * Production isn't affected — the admin is bundled by Vite, which handles ESM.
 */

// Callable, property-access-safe, and never throws: any call or property
// read returns another inert value, so module-load code in @medusajs/ui runs.
const inert = () =>
  new Proxy(function () {}, {
    get(_t, prop) {
      if (prop === Symbol.toPrimitive) return () => ""
      if (typeof prop === "symbol" || prop === "then") return undefined
      return inert()
    },
    apply() {
      return inert()
    },
  })

module.exports = new Proxy(
  { __esModule: true },
  {
    get(target, prop) {
      if (prop in target) return target[prop]
      if (typeof prop === "symbol" || prop === "then") return undefined
      return inert()
    },
  }
)
