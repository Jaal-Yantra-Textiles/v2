import { model } from "@medusajs/framework/utils"

/**
 * What a partner can actually make, as evidenced by something they showed us.
 *
 * Sourcing a design means asking several partners what is on their loom right
 * now, and they answer with photographs. Until this existed those photographs
 * landed in a WhatsApp inbox, attached to nothing: unfindable six months later
 * when exactly that fabric is wanted again, so the same question was asked of
 * the same partner more than once.
 *
 * A sample row deliberately OUTLIVES the inquiry that produced it. That is the
 * whole point — the inquiry is an event, this is the library it deposits into.
 * A partner's capabilities are not a property of one brief.
 *
 * Photographs are `media_file` rows (the media module already stores, tags and
 * folders them); this row carries the textile facts and points at them.
 */
const PartnerCapabilitySample = model.define("partner_capability_sample", {
  id: model.id({ prefix: "pcap" }).primaryKey(),

  partner_id: model.text().searchable(),

  /** What this is, in the partner's own words ("kani twill, off-white"). */
  title: model.text().searchable(),

  /**
   * Typed columns rather than a metadata blob because these are exactly the
   * fields the library is SEARCHED by — "who can do kani in pashmina?" — and
   * metadata is replaced wholesale on update (feedback_no_critical_data_in_metadata).
   */
  technique: model.text().searchable().nullable(),
  material: model.text().searchable().nullable(),

  /** media_file ids. */
  media_file_ids: model.json().nullable(),

  notes: model.text().nullable(),

  /**
   * How it reached us. Kept because the channels have different reliability:
   * an `admin` row is someone typing up a conversation from memory, a `wizard`
   * row is the partner's own structured answer, and telling them apart later is
   * the difference between evidence and hearsay.
   */
  source: model
    .enum(["wizard", "assistant", "whatsapp", "admin"])
    .default("admin"),

  /**
   * When the partner actually had this on the loom — NOT `created_at`. A photo
   * typed up three weeks after it was taken describes a capability that may
   * already be gone; the library is only trustworthy if it says how stale it is.
   */
  captured_at: model.dateTime(),

  metadata: model.json().nullable(),
}).indexes([
  { on: ["partner_id"], name: "idx_partner_capability_sample_partner" },
])

export default PartnerCapabilitySample
