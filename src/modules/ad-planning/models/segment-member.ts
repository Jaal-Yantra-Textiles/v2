import { model } from "@medusajs/framework/utils"
import CustomerSegment from "./customer-segment"

/**
 * SegmentMember
 *
 * Junction table linking persons to segments.
 * Tracks when and why a person was added to a segment.
 */
const SegmentMember = model.define("SegmentMember", {
  id: model.id().primaryKey(),

  // Links
  segment: model.belongsTo(() => CustomerSegment, { mappedBy: "members" }),
  person_id: model.text(), // Links to Person module

  // Membership details
  added_at: model.dateTime(),
  added_reason: model.enum([
    "rule_match",   // Matched segment criteria
    "manual",       // Manually added
    "import"        // Imported from external source
  ]).default("rule_match"),

  // Score at time of addition (for scoring-based segments)
  score_at_addition: model.float().nullable(),

  // Metadata
  metadata: model.json().nullable(),
})
.indexes([
  {
    on: ["person_id"],
    name: "idx_segment_member_person",
  },
])

export default SegmentMember
