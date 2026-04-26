# Design Partner Filter & Saved View Enablement

## Goal
Allow the admin Designs table to filter directly by partner (e.g., "List designs by a certain partner") and persist those filters inside saved views so they can be recalled later.

## Current Progress
1. **Link definition updated** (`src/links/design-partners-link.ts`)
   - Added `filterable: ["id", "name"]` to the partner side of the link definition.
   - Keeps existing extra link columns intact.

2. **Feature flag enabled** (`medusa-config.ts`)
   - `view_configrations` flag (Medusa typo) turned on so view configuration endpoints are available for saving table states.

## Next Steps
1. **Run migrations/index sync**
   - `yarn medusa db:migrate` (or your project equivalent) to ensure the index engine ingests partner records with the new filterable fields on startup.

2. **Backend filtering**
   - Update the admin `/admin/designs` route (and `useDesigns` hook) to accept a `partner_id` filter.
   - When `partner_id` is present, use `query.index({ entity: "design", fields: ["*", "partners.*"], filters: { partners: { id: partnerId } } })` so filtering happens inside the index engine.

3. **Admin UI controls**
   - Add a partner selector to the Designs table filters. Recommend autocomplete backed by a lightweight partners list endpoint.
   - Wire the selected partner into the query params and saved view configuration payloads.

4. **Saved view UX**
   - Reuse the existing view-configuration components from `apps/partner-ui` or implement a simplified `SaveViewDialog/ViewSelector` for the admin Designs table.
   - Ensure the configuration payload stores `filters.partner_id` so saved views can restore the partner filter.

## Testing Checklist
- ✅ Index link shows `[Index engine] syncing entity 'LinkDesignDesignPartnerPartner'` in logs after restart.
- ✅ GET `/admin/designs?partner_id=partner_123` only returns designs linked to that partner.
- ✅ Saved view restores all filters, including `partner_id`.
- ✅ Feature flag remains enabled in `medusa-config.ts` for future deployments.
