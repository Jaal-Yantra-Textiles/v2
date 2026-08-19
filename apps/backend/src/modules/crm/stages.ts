/**
 * The CRM deal pipeline vocabulary. THE single source of truth.
 *
 * This file deliberately has NO imports. It is consumed by four things that
 * cannot all share a heavier dependency:
 *
 *   1. `dal/crm-contracts.ts`      — the Hyperbee contract (Medusa-free)
 *   2. `node/server.ts`            — via the contract, bundled into the
 *                                    standalone CRM node with esbuild
 *   3. the admin API validators    — zod, server-side
 *   4. the admin dashboard         — Vite-bundled for the BROWSER
 *
 * (4) is why the constants live here rather than in the contract: importing the
 * contract would pull `@jytextiles/mikrohyperbee` — corestore, hyperbee and the
 * native hypercore stack behind it — into a browser bundle.
 *
 * Shaped for textiles rather than generic SaaS. `sampling` is the decisive
 * stage in this business (a swatch or sample has physically gone out) and was
 * invisible in the previous list; `quoted` replaces `proposal` because what
 * gets sent is a price for a quantity, not a document.
 *
 * ⚠️ This enum is enforced in TWO processes. Medusa validates on the way in,
 * and the standalone CRM node re-validates against its own bundled copy.
 * Changing it therefore requires REBUILDING AND REDEPLOYING the node bundle
 * (modules/crm/node/deploy/README.md) — until that happens the node rejects any
 * new value with a 422 naming the old enum, and the write fails at the proxy
 * rather than at the validator. Verified by probe, not assumed.
 */

export const CRM_OPPORTUNITY_STAGES = [
  "prospecting",
  "sampling",
  "quoted",
  "negotiation",
  "won",
  "lost",
] as const;

export type CrmOpportunityStage = (typeof CRM_OPPORTUNITY_STAGES)[number];

export const CRM_OPPORTUNITY_DEFAULT_STAGE: CrmOpportunityStage = "prospecting";

/** Stages that end the deal. Used to keep won/lost out of open-pipeline value. */
export const CRM_OPPORTUNITY_CLOSED_STAGES: readonly CrmOpportunityStage[] = [
  "won",
  "lost",
];

/** Display label per stage. */
export const CRM_STAGE_LABELS: Record<CrmOpportunityStage, string> = {
  prospecting: "Prospecting",
  sampling: "Sampling",
  quoted: "Quoted",
  negotiation: "Negotiation",
  won: "Won",
  lost: "Lost",
};

/** What each stage actually means, so the board is self-explaining. */
export const CRM_STAGE_HINTS: Record<CrmOpportunityStage, string> = {
  prospecting: "Qualified, not yet sent anything",
  sampling: "Swatch or sample has gone out",
  quoted: "Price and quantity sent",
  negotiation: "Terms being agreed",
  won: "Closed — order placed",
  lost: "Closed — no deal",
};

export const isClosedStage = (s: string): boolean =>
  (CRM_OPPORTUNITY_CLOSED_STAGES as readonly string[]).includes(s);
