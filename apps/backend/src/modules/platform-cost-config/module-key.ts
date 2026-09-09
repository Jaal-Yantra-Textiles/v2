/**
 * The module's registration key, on its own.
 *
 * 🔴 Split out of `index.ts` because importing that file pulls in the service
 * and its `model.define(...)`, which is undefined outside a booted runtime. A
 * pricer that reads config would therefore drag the whole module into every
 * unit test importing it — and the failure mode is a suite that fails to RUN,
 * which reads in the totals as neither pass nor fail.
 */
export const PLATFORM_COST_CONFIG_MODULE = "platform_cost_config"
