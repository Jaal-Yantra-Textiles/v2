# V1 Partner-Design Workflow — Removal Plan & Improvements

> Captured 2026-06-07 while fixing the cancelled-assignment desync bug
> (design `01KE6E3NY88RB64J6D1CCT0E0C`). Maps the legacy "v1" partner-design
> task workflow so we can retire it now that "v2" production runs are the
> system of record. This is a **plan**, not executed work — see the
> phased order at the bottom.

## TL;DR

There are **two parallel partner-work systems**:

- **v1** — partner work modelled as **tasks** titled `partner-design-start`,
  `partner-design-redo`, `partner-design-finish`, `partner-design-completed`
  (+ redo children `…-redo-log/-apply/-verify`), driven by async workflow
  gates (`await-design-*`). Status lives in `design.metadata.partner_*`.
- **v2** — the `production_runs` module (`prod_run_*`, statuses
  `sent_to_partner → accepted → in_progress → finished → completed/cancelled`).

The partner-UI has **already cut over to v2** for the work surface
(`DesignProductionSection`), but v1 is still wired on the **admin assignment
path**, in the **status-derivation fallback**, and (critically) the v2
"send to production" path **still creates the v1 task checklist**. So v1
can't be deleted wholesale yet — it needs a phased retirement.

## The cancelled-assignment bug this came from (fixed)

`design.metadata.partner_assignment_cancelled_at` is set on cancel and was
**never cleared on re-assignment**, while the v2 production-run endpoints
ignore it. A design cancelled in March then got a new run that completed
in June, but still reported `partner_status: "cancelled"`. Fixed in
`fix/partner-cancel-desync`:
- `approveProductionRunWorkflow` clears the marker on (re)assignment.
- the `/partners/designs[/:id]` derivation treats the marker as superseded
  by any non-cancelled run created **after** the cancel timestamp.
This is itself a symptom of the v1/v2 split — removing v1 removes the
class of bug.

## Code map (what is v1)

### A. v1 task creation (workflows)
- `src/workflows/designs/send-to-partner.ts` — `sendDesignToPartnerWorkflow`
  creates the 4 main tasks + redo children + the `await-design-*` gates.
- `src/workflows/designs/complete-partner-design.ts` — completes/cancels the
  v1 tasks + signals the gates.
- `src/workflows/designs/design-steps.ts` — `setDesignStepSuccess/Failed`
  gate-signalling infra (looks up workflow `transaction_id` from tasks).
- `src/workflows/designs/create-tasks-from-templates.ts` — generic task
  creation used by the above.

### B. v1 partner API endpoints (`src/api/partners/designs/[designId]/`)
- `start/`, `finish/`, `redo/`, `refinish/`, `complete/` — each completes a
  v1 task, writes `metadata.partner_*`, and signals a gate.

### C. v1 admin endpoint
- `src/api/admin/designs/[id]/send-to-partner/route.ts` — v1 assignment
  (still invokes `sendDesignToPartnerWorkflow`).
- `src/api/admin/designs/[id]/cancel-partner-assignment/route.ts` — cancels
  v1 tasks/transaction + sets `partner_assignment_cancelled_at`.

### D. Status derivation / fallback (dual-source — the bridge)
- `src/api/partners/designs/[designId]/route.ts` — v2 runs primary, v1-task
  fallback (`!resolvedFromRun && !wasCancelled`).
- `src/api/partners/designs/route.ts` (list) — same dual-source shape.

### E. `design.metadata.partner_*` fields
`partner_status`, `partner_phase`, `partner_started_at`,
`partner_finished_at`, `partner_completed_at`,
`partner_assignment_cancelled_at`, `partner_assignment_cancelled_partner_id`
— written by B/C, read by D + admin/partner UI.

### F. partner-ui
- **Dead code (safe to delete):** `design-actions-section.tsx` (the v1
  start/finish/redo buttons) — **not mounted** anywhere; `design-detail.tsx`
  uses `DesignProductionSection` (v2).
- v1 mutation hooks in `hooks/api/partner-designs.tsx`:
  `useStartPartnerDesign`, `useFinishPartnerDesign`, `useRedoPartnerDesign`,
  `useRefinishPartnerDesign` (+ the `partner_*` fields on
  `PartnerDesignPartnerInfo`).

### G. admin-ui bridge
- `src/admin/components/designs/design-partner-section.tsx` — `hasV1Assignment()`
  mutual-exclusion logic + the "cancel v1 assignment" affordance.

### H. tests
- `designs-partner-workflow.spec.ts`, `send-to-partner-complete-workflow.spec.ts`,
  `cancel-workflows.spec.ts`, `design-consumption-logs.spec.ts` (v1 titles),
  `production-run-partner-status.spec.ts` (v2→v1 fallback bridge).

## The one thing that blocks a clean delete

`sendDesignToPartnerWorkflow` (v1) **still produces the partner's task
checklist** that the v2 run lifecycle completes. Confirmed on the prod
design: the v2 run completing also drove `partner-design-*` tasks to
`completed`. So before deleting v1 task creation, v2 must own the
partner-facing task list itself (production-run tasks already exist via
`production-run-prod_run_*` task templates — the checklist needs to move
fully onto those).

## Phased removal plan

**Phase 0 — land the desync fix (this PR `fix/partner-cancel-desync`).**
Stops the immediate bleakage; no v1 removal yet.

**Phase 1 — delete confirmed dead code (low risk).**
- Remove `partner-ui/.../design-actions-section.tsx` (unmounted).
- Remove the unused v1 mutation hooks if no remaining importers
  (`useStart/Finish/Redo/RefinishPartnerDesign`) — grep first.
- No API/behaviour change.

**Phase 2 — make v2 own the partner checklist.**
- Ensure the production-run task templates fully cover what partners need
  (start/work/finish/redo). Stop `sendDesignToPartnerWorkflow` from being
  the source of the checklist; the v2 send/approve path creates the tasks.
- Keep the v1 task **titles** only if the partner-ui still reads them;
  otherwise migrate the UI to read run tasks.

**Phase 3 — collapse the status derivation to v2-only.**
- ✅ **DONE 2026-06-10** (after the Phase 5 backfill ran in prod). Removed
  the v1-task fallback + cancel-marker reads from both `/partners/designs`
  routes (`route.ts` list + `[designId]/route.ts` detail). `partner_status`
  now derives **purely from production runs**; a run-less design is
  "incoming". Also dropped the now-unused `design.tasks.*` fetch from the
  detail route's link query. Verified: partner-status specs green
  (production-run-partner-status, -design-status, -sample-status,
  partner-cancel-reassign-desync).
- ✅ `cancel-partner-assignment` already cancels the partner's active
  run(s) (the cancel = a cancelled run). `partner_assignment_cancelled_at`
  is no longer read anywhere in the partner derivations; the
  cancel-partner-assignment workflow still *writes* it (harmless legacy
  breadcrumb) — can be dropped in Phase 4.

**Phase 4 — retire v1 endpoints + workflows.**
- ✅ **DONE 2026-06-10.** Preconditions verified first: partner-ui had no
  remaining navigation to the v1 routes (`design-start`/`design-complete`
  were mounted but orphaned since the action section was deleted), the
  admin batch send drawer + `useSendDesignToPartner` hook had no mounts,
  and nothing in the v2 path creates or completes v1-titled tasks.
- Deleted: `partners/designs/[id]/{start,finish,redo,refinish,complete}`
  routes + their middleware entries; admin `send-to-partner` route +
  validator; workflows `send-to-partner.ts`, `complete-partner-design.ts`,
  `design-steps.ts` (gate infra). `create-tasks-from-templates.ts` stays —
  it serves admin design/inventory-order task creation.
- `cancel-partner-assignment` workflow stripped to v2-only: cancel the
  partner's active runs (+ open tasks) and optionally unlink. The marker
  write + v1 task/transaction cancellation are gone; the response no
  longer carries `transaction_id`.
- `approve-production-run` dropped `clearDesignCancelMarkerStep` — nothing
  writes the marker anymore (prod was backfilled clean in Phase 5).
- Admin UI: deleted `batch-send-to-partner-drawer.tsx` (unmounted) +
  `useSendDesignToPartner`; `design-partner-section.tsx` lost
  `hasV1Assignment`/marker reads — the Cancel affordance now shows for a
  partner with an **active run** and cancels via the same endpoint.
- partner-ui: deleted `design-start`/`design-complete` routes + route-map
  entries + the 5 v1 mutation hooks.
- Specs: deleted `designs-partner-workflow.spec.ts` (v1-only); reworked
  `cancel-workflows.spec.ts` onto the v2 surface (assignment-cancel
  cancels runs; visibility checks via runs); `design-consumption-logs.spec.ts`
  now links partner↔design directly instead of the v1 send ceremony.
  `send-to-partner-complete-workflow.spec.ts` + `send-to-partner-error-cases.spec.ts`
  are the **inventory-orders** feature — untouched.
- Note: Phase 2 turned out to be moot — the v2 send path never created
  the v1 checklist in current code; only the (now deleted) v1 admin
  route did.

**Phase 5 — data cleanup (one-off).**
- ✅ **Cancelled designs migrated:** `src/scripts/backfill-cancelled-design-runs.ts`
  — for every design carrying `partner_assignment_cancelled_at`, creates a
  terminal `cancelled` production run for the cancelled partner when none
  exists, then clears the marker. After this, status derives purely from
  runs for all designs (5 marked designs in prod as of 2026-06-08: 4
  marker-only + 1 run-backed). Run via
  `DRY_RUN=1 ./deploy/aws/scripts/run-backfill.sh backfill-cancelled-design-runs`
  then without DRY_RUN. Idempotent. Once run in prod, the marker +
  v1-task fallback in the `/partners/designs` derivations can be removed.
- Remaining: optionally strip the other `metadata.partner_*` keys and
  archive historical `partner-design-*` tasks.

## Suggested improvements (independent of removal)

1. **Single source of truth for partner work status** — `partner_status`
   should derive only from `production_runs`; never from metadata flags.
   (Phase 3 delivers this.)
2. **Run cancellation is the cancel** — there should be no separate
   "assignment cancelled" marker divorced from run state. Cancelling work =
   cancelling the run.
3. **Guard the v2 partner endpoints on run state** — `/partners/production-runs/[id]/{accept,start,finish,complete}` should reject transitions on a
   cancelled/terminal run with a clear error (defence-in-depth; today they
   rely on the workflow's status check only).
4. **One partner-work UI** — finish consolidating onto `DesignProductionSection`;
   delete the dead v1 action UI.
5. **Typed run-status state machine** — encode allowed transitions in one
   place (module/service) instead of re-deriving `can*` flags in each route
   + UI.
