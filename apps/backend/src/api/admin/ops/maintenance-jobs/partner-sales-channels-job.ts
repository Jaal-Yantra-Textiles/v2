import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import {
  deleteSalesChannelsWorkflow,
  linkSalesChannelsToApiKeyWorkflow,
  updateSalesChannelsWorkflow,
} from "@medusajs/medusa/core-flows"
import { z } from "@medusajs/framework/zod"

import {
  isPartnerSalesChannel,
  partnerChannelMetadata,
  planPartnerChannelCleanup,
} from "../../../../lib/partner-sales-channel"
import { TERMINAL_ORDER_STATUSES } from "../../../../workflows/partners/delete-partner"
import type { MaintenanceChange, MaintenanceJob, MaintenanceJobResult } from "./registry"

/**
 * #2527 — partner sales channels: mark them, then clean up the dead ones.
 *
 * Only a channel stamped `metadata.created_by = "partner_store"` is ever
 * eligible for cleanup. New partner stores are stamped at creation
 * (`create-store-with-defaults`); `mark-partner-sales-channels` stamps the ones
 * that pre-date it. Admin-created channels — "Partner Work Orders", the POS
 * channel — carry no stamp and are never touched. See
 * `lib/partner-sales-channel.ts` for why "no store" is not enough.
 */

/**
 * PURE: channel id → the partner whose store uses it as default. A channel used
 * by two partners' stores is ambiguous and returned separately, never marked.
 */
export function mapPartnerChannels(
  partners: Array<{
    id: string
    stores?: Array<{ default_sales_channel_id?: string | null } | null> | null
  }>
): { byChannel: Map<string, string>; ambiguous: Set<string> } {
  const byChannel = new Map<string, string>()
  const ambiguous = new Set<string>()
  for (const p of partners) {
    for (const s of p?.stores ?? []) {
      const sc = s?.default_sales_channel_id
      if (!sc) continue
      const seen = byChannel.get(sc)
      if (seen && seen !== p.id) ambiguous.add(sc)
      else byChannel.set(sc, p.id)
    }
  }
  for (const sc of ambiguous) byChannel.delete(sc)
  return { byChannel, ambiguous }
}

const markParamsSchema = z.object({
  partner_id: z.string().min(1).optional(),
})

export const markPartnerSalesChannelsJob: MaintenanceJob = {
  id: "mark-partner-sales-channels",
  label: "Mark partner sales channels (so cleanup can tell them from admin channels)",
  description:
    "Stamps metadata.created_by='partner_store' and partner_id on the default sales channel of every partner store (deleted partners included), merging into existing metadata. Only stamped channels are ever eligible for 'Clean up orphaned partner sales channels'; admin-created channels (Partner Work Orders, POS) are never stamped. Skips a channel two partners' stores share. Idempotent. Optionally scope to one partner_id.",
  params: [
    {
      name: "partner_id",
      type: "string",
      required: false,
      description: "Restrict to one partner (default: all partners)",
    },
  ],
  run: async (container, { dry_run, params }): Promise<MaintenanceJobResult> => {
    const parsed = markParamsSchema.safeParse(params)
    if (!parsed.success) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        parsed.error.issues.map((i) => i.message).join("; ")
      )
    }
    const { partner_id } = parsed.data
    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)

    // withDeleted: a deleted partner's store and channel can outlive it, and
    // those are exactly the channels cleanup exists for.
    const { data: partners } = await query.graph({
      entity: "partners",
      fields: ["id", "stores.default_sales_channel_id"],
      ...(partner_id ? { filters: { id: partner_id } } : {}),
      withDeleted: true,
    })
    const { byChannel, ambiguous } = mapPartnerChannels(partners ?? [])

    const changes: MaintenanceChange[] = []
    const errors: Array<{ id: string; message: string }> = []
    for (const sc of ambiguous) {
      errors.push({ id: sc, message: "Default channel of stores of more than one partner — not marked." })
    }

    const channelIds = [...byChannel.keys()]
    const { data: channels } = channelIds.length
      ? await query.graph({
          entity: "sales_channels",
          fields: ["id", "name", "metadata"],
          filters: { id: channelIds },
        })
      : { data: [] }

    let applied = false
    for (const c of (channels ?? []) as any[]) {
      const partnerId = byChannel.get(c.id)!
      const existing = (c.metadata ?? {}) as Record<string, unknown>
      if (isPartnerSalesChannel(c)) {
        if (existing.partner_id !== partnerId) {
          errors.push({
            id: c.id,
            message: `Already marked for partner ${String(existing.partner_id)}, but used by partner ${partnerId}'s store — left as is.`,
          })
        }
        continue
      }
      // Read-then-merge: an update REPLACES the whole metadata blob.
      const next = { ...existing, ...partnerChannelMetadata(partnerId) }
      changes.push({
        entity: "sales_channel",
        id: c.id,
        field: "metadata",
        before: c.metadata ?? null,
        after: next,
        note: `${c.name ?? c.id} is the default channel of partner ${partnerId}'s store`,
      })
      if (!dry_run) {
        try {
          await updateSalesChannelsWorkflow(container).run({
            input: { selector: { id: c.id }, update: { metadata: next } },
          })
          applied = true
        } catch (e: any) {
          errors.push({ id: c.id, message: e?.message ?? String(e) })
        }
      }
    }

    return {
      job_id: "mark-partner-sales-channels",
      dry_run,
      applied,
      summary: `${changes.length} partner channel(s) ${dry_run ? "would be" : "were"} marked; ${errors.length} skipped.`,
      changes,
      ...(errors.length ? { errors } : {}),
    }
  },
}

const cleanupParamsSchema = z.object({
  channel_id: z.string().min(1).optional(),
})

export const cleanupOrphanedPartnerSalesChannelsJob: MaintenanceJob = {
  id: "cleanup-orphaned-partner-sales-channels",
  label: "Clean up orphaned partner sales channels",
  description:
    "Soft-deletes PARTNER-created sales channels (metadata.created_by='partner_store') that no live store uses any more, after unlinking their publishable keys. Admin-created channels are never considered. Skips a channel with orders still in flight. Run 'Mark partner sales channels' first. Optionally scope to one channel_id.",
  params: [
    {
      name: "channel_id",
      type: "string",
      required: false,
      description: "Restrict to one sales channel (default: all marked channels)",
    },
  ],
  run: async (container, { dry_run, params }): Promise<MaintenanceJobResult> => {
    const parsed = cleanupParamsSchema.safeParse(params)
    if (!parsed.success) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        parsed.error.issues.map((i) => i.message).join("; ")
      )
    }
    const { channel_id } = parsed.data
    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)

    const { data: channels } = await query.graph({
      entity: "sales_channels",
      fields: ["id", "name", "metadata"],
      ...(channel_id ? { filters: { id: channel_id } } : {}),
    })
    const marked = ((channels ?? []) as any[]).filter(isPartnerSalesChannel)

    // Live stores only: a soft-deleted store's channel is what we are after.
    const { data: stores } = await query.graph({
      entity: "stores",
      fields: ["id", "default_sales_channel_id"],
    })
    const liveStoreChannelIds = ((stores ?? []) as any[])
      .map((s) => s?.default_sales_channel_id)
      .filter(Boolean)

    const candidateIds = marked
      .map((c) => c.id)
      .filter((id) => !liveStoreChannelIds.includes(id))
    const liveOrders: Record<string, string[]> = {}
    if (candidateIds.length) {
      const { data: orders } = await query.graph({
        entity: "order",
        fields: ["id", "status", "sales_channel_id"],
        filters: { sales_channel_id: candidateIds },
      })
      for (const o of (orders ?? []) as any[]) {
        if (!o?.id || TERMINAL_ORDER_STATUSES.has(o?.status)) continue
        ;(liveOrders[o.sales_channel_id] ??= []).push(o.id)
      }
    }

    const plan = planPartnerChannelCleanup({
      channels: marked,
      live_store_channel_ids: liveStoreChannelIds,
      live_order_ids_by_channel: liveOrders,
    })

    const errors: Array<{ id: string; message: string }> = plan.skipped.map(
      (s) => ({ id: s.id, message: `${s.name ?? s.id}: ${s.reason}` })
    )
    const changes: MaintenanceChange[] = plan.delete.map((c) => ({
      entity: "sales_channel",
      id: c.id,
      field: "deleted_at",
      before: null,
      after: "soft-deleted",
      note: `${c.name ?? c.id} was created for partner ${c.partner_id ?? "?"}'s store, and no live store uses it`,
    }))

    let applied = false
    if (!dry_run && plan.delete.length) {
      const { data: keys } = await query.graph({
        entity: "api_keys",
        fields: ["id", "sales_channels.id"],
        filters: { type: "publishable" },
      })
      for (const c of plan.delete) {
        try {
          // Keys first: a key left pointing at a deleted channel expands to
          // `sales_channels: [null]` (the 2026-08-21 outage).
          for (const k of (keys ?? []) as any[]) {
            const linked = ((k?.sales_channels ?? []) as any[]).some((sc) => sc?.id === c.id)
            if (!linked) continue
            await linkSalesChannelsToApiKeyWorkflow(container).run({
              input: { id: k.id, add: [], remove: [c.id] },
            })
          }
          await deleteSalesChannelsWorkflow(container).run({ input: { ids: [c.id] } })
          applied = true
        } catch (e: any) {
          errors.push({ id: c.id, message: e?.message ?? String(e) })
        }
      }
    }

    return {
      job_id: "cleanup-orphaned-partner-sales-channels",
      dry_run,
      applied,
      summary: `${plan.delete.length} orphaned partner channel(s) ${dry_run ? "would be" : "were"} soft-deleted; ${plan.skipped.length} skipped. Admin-created channels are never considered.`,
      changes,
      ...(errors.length ? { errors } : {}),
    }
  },
}
